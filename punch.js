// Darwinbox auto clock-in / clock-out, run by GitHub Actions.
// Usage: node punch.js in|out
//
// Env (GitHub repo secrets / variables):
//   DARWINBOX_USER   employee id
//   DARWINBOX_PASS   password (repo secret, set by you)
//   DRY_RUN=1        log in and report state, never click
//   FORCE=1          ignore week-off and time-window guards (manual runs only)

const { chromium } = require("playwright");
const zlib = require("zlib");
const fs = require("fs");
const { latestOtp } = require("./otp");

const LOGIN_URL = "https://hudl.darwinbox.in/user/login?continue=%2Fms%2Fdb%2Fhome";
// Your week offs and shift times live in schedule.json (the only file to edit).
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SCHEDULE = JSON.parse(fs.readFileSync(require("path").join(__dirname, "schedule.json"), "utf8"));
const WEEK_OFFS = SCHEDULE.weekOffs.map((d) => DAYS.indexOf(d.slice(0, 3)));
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
// Each action is only allowed from 30 min before to 3 h after its time, so a
// badly delayed run can't clock you in at night or out in the afternoon.
const WINDOWS = {
  in: [toMin(SCHEDULE.clockIn) - 30, toMin(SCHEDULE.clockIn) + 180],
  out: [toMin(SCHEDULE.clockOut) - 30, toMin(SCHEDULE.clockOut) + 180],
};
function inWindow(min, [from, to]) {   // works across midnight
  const d = (x) => ((x % 1440) + 1440) % 1440;
  return d(min - from) <= d(to - from);
}

function istNow() {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => f.find((p) => p.type === t).value;
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}


// Encrypted copy of the session cookies, carried between runs via the Actions cache.
const crypto = require("crypto");
const STATE_FILE = "state/state.bin";
function stateKey() { return crypto.createHash("sha256").update("dbx-state:" + (process.env.DARWINBOX_PASS || "")).digest(); }
function saveCarried(state) {
  try {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", stateKey(), iv);
    const data = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(state))), c.final()]);
    fs.mkdirSync("state", { recursive: true });
    fs.writeFileSync(STATE_FILE, Buffer.concat([iv, c.getAuthTag(), data]));
  } catch (_) {}
}
function loadCarried() {
  try {
    const b = fs.readFileSync(STATE_FILE);
    const d = crypto.createDecipheriv("aes-256-gcm", stateKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()])).toString());
  } catch (_) { return null; }
}

// In Mac mode Chrome must be closed properly so it saves the cookies, so
// done() unwinds to the finally block instead of exiting on the spot.
class DoneSignal { constructor(code) { this.code = code; } }
function done(result, code = 0) {
  console.log(JSON.stringify(result, null, 2));
  if (globalThis.__ctx) throw new DoneSignal(code);
  process.exit(code);
}

(async () => {
  const action = (process.argv[2] || "").toLowerCase();
  if (action !== "in" && action !== "out") done({ ok: false, error: "usage: node punch.js in|out" }, 2);
  if (!process.env.DARWINBOX_USER || !process.env.DARWINBOX_PASS) {
    done({ ok: false, error: "DARWINBOX_USER / DARWINBOX_PASS not set" }, 2);
  }

  const dryRun = process.env.DRY_RUN === "1";
  const force = process.env.FORCE === "1";
  const now = istNow();
  if (!force) {
    const min = now.hour * 60 + now.minute;
    // A clock-out just after midnight belongs to the previous day's shift.
    const shiftDay = action === "out" && min < toMin(SCHEDULE.clockIn) - 30 && toMin(SCHEDULE.clockOut) + 180 > 1440
      ? (now.day + 6) % 7 : now.day;
    if (WEEK_OFFS.includes(shiftDay)) done({ ok: true, skipped: "week off", ist: now });
    if (!inWindow(min, WINDOWS[action])) done({ ok: true, skipped: "outside time window", ist: now });
  }

  // Saved "trusted device" cookies. Prefer the copy the last run saved
  // (state.bin, kept in the Actions cache, encrypted), else the secret from save-session.js.
  let storageState = loadCarried();
  if (storageState) console.log(JSON.stringify({ session: "carried forward from last run" }));
  if (!storageState && process.env.DARWINBOX_STATE) {
    try {
      storageState = JSON.parse(zlib.gunzipSync(Buffer.from(process.env.DARWINBOX_STATE.trim(), "base64")).toString());
    } catch (e) {
      done({ ok: false, error: "DARWINBOX_STATE is not valid; re-run save-session.js" }, 1);
    }
  }

  // Mac version (MAC_PROFILE=1): use the persistent Chrome profile Darwinbox remembers.
  const macMode = process.env.MAC_PROFILE === "1";
  const browser = macMode ? null : await chromium.launch({ headless: true });
  try {
    const ctx = macMode
      ? await require("./mac/browser").openProfile(chromium, { headless: true })
      : await browser.newContext({
          timezoneId: "Asia/Kolkata", locale: "en-IN", viewport: { width: 420, height: 900 },
          storageState,
        });
    globalThis.__ctx = ctx;
    const page = macMode ? (ctx.pages()[0] || await ctx.newPage()) : await ctx.newPage();
    page.setDefaultTimeout(30000);

    // Darwinbox sends an OTP when it doesn't recognise the device. Outlook forwards
    // that email to Gmail; read the code from there and enter it.
    async function handleOtp(sinceMs) {
      fs.mkdirSync("debug", { recursive: true });
      await page.waitForLoadState("networkidle").catch(() => {});
      const pageAt = Date.now();
      await page.screenshot({ path: "debug/otp-page.png", fullPage: true }).catch(() => {});
      const box = page.locator("input#otp, input[name=otp]").first();
      if (!(await box.count())) throw new Error("OTP page has no OTP box (page changed?)");

      const submit = async (otp, how) => {
        console.log(JSON.stringify({ otp: how, emailAt: otp.at }));
        await box.fill(otp.code);
        await page.locator("input[type=submit], button[type=submit]").first().click();
        await page.waitForURL(/\/ms\/db\/home/, { timeout: 20000 }).catch(() => {});
        return /\/ms\/db\/home/.test(page.url());
      };

      // 1) Use a new OTP email if one arrives. (No guessing with old codes:
      //    wrong attempts are limited and could lock the account.)
      let otp = await latestOtp(sinceMs - 20000, 25000);
      if (otp && await submit(otp, "new email")) return;

      // 2) No email: press "Resend OTP" (allowed after 30s) and use the new email.
      await page.waitForTimeout(Math.max(0, 33000 - (Date.now() - pageAt)));
      const resend = page.locator("a, button, span, div, input").filter({ hasText: /^\s*resend(\s+otp)?\s*$/i }).first();
      const resendBtn = (await resend.count()) ? resend : page.locator("input[value*=esend i]").first();
      if (!(await resendBtn.count())) {
        await page.screenshot({ path: "debug/no-resend.png", fullPage: true }).catch(() => {});
        throw new Error("OTP was not accepted and no Resend OTP button was found");
      }
      const resendAt = Date.now();
      await resendBtn.click();
      otp = await latestOtp(resendAt - 5000, 120000);
      if (!otp) throw new Error("Clicked Resend OTP but no new OTP email reached Gmail within 2 minutes");
      if (await submit(otp, "resent OTP")) return;
      await page.screenshot({ path: "debug/after-otp.png", fullPage: true }).catch(() => {});
      throw new Error("Entered the resent OTP but did not reach the dashboard");
    }

    let otpSince = Date.now();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    if (/otpauth/.test(page.url())) await handleOtp(otpSince);
    if (!/\/ms\/db\/home/.test(page.url())) {
      await page.getByPlaceholder(/email|emp/i).first().fill(process.env.DARWINBOX_USER);
      await page.getByPlaceholder(/password/i).first().fill(process.env.DARWINBOX_PASS);
      otpSince = Date.now();
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/ms\/db\/home|otpauth/, { timeout: 45000 }).catch(async (e) => {
        // Log what the page shows (labels and messages only) so failures are diagnosable.
        const info = await page.evaluate(() => {
          const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const txt = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 120);
          const pick = (sel) => [...document.querySelectorAll(sel)].filter(vis).map(txt).filter((s) => s && !/@|dhumal|ajinkya|\d{5}/i.test(s));
          return {
            url: location.pathname + location.search,
            title: document.title,
            messages: pick(".error, .alert, .toast, [role=alert], .help-block, .invalid-feedback, .text-danger, .errorMsg, .err, small, label, p, h1, h2, h3, h4").slice(0, 25),
            buttons: pick("button, input[type=submit], a.btn").slice(0, 15),
            inputs: [...document.querySelectorAll("input")].filter(vis).map((i) => ({ type: i.type, name: i.name, placeholder: i.placeholder })),
            iframes: [...document.querySelectorAll("iframe")].map((f) => (f.src || "").slice(0, 80)),
          };
        }).catch(() => ({}));
        console.log(JSON.stringify({ stuckAfterSignIn: info }, null, 1));
        throw e;
      });
      if (/otpauth/.test(page.url())) await handleOtp(otpSince);
    }

    // Keep Darwinbox's latest cookies for the next run, like a browser would.
    if (!macMode) saveCarried(await ctx.storageState());

    // 2) Read the clock card
    const btn = page.getByRole("button", { name: /^\s*clock\s*(in|out)\s*$/i }).first();
    await btn.waitFor({ state: "visible", timeout: 45000 });
    await page.waitForTimeout(2000); // let the card finish loading its state
    const label = (await btn.innerText()).trim().toLowerCase().replace(/\s+/g, "");

    // Once you've clocked in today, the card shows your first-in time (e.g. "14:05").
    const card = await page.evaluate(() => document.body.innerText);
    const m = card.match(/\d{2}:\d{2}:\d{2}\s+(\d{2}:\d{2})(?:\s+(\d{2}:\d{2}))?\s+Shift:/);
    const firstIn = m ? m[1] : null;
    const lastOut = m && m[2] ? m[2] : null;

    const state = { action, label, firstIn, lastOut, dryRun, ist: now };

    // 3) Decide — never click unless the state is exactly what we expect
    let reason = null;
    if (action === "in") {
      if (label !== "clockin") reason = `button says ${label} (already clocked in)`;
      else if (firstIn) reason = `already clocked in today at ${firstIn}`;
    } else if (label !== "clockout") {
      reason = `button says ${label} (not clocked in, or already clocked out)`;
    }
    if (reason) done({ ok: true, clicked: false, reason, ...state });
    if (dryRun) done({ ok: true, clicked: false, reason: "dry run", wouldClick: true, ...state });

    // 4) Click once, confirm from Darwinbox's own response
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/attendance/attendance/log"), { timeout: 30000 }),
      btn.click(),
    ]);
    let body = {};
    try { body = await resp.json(); } catch (_) {}
    const ok = resp.ok() && body.status === "success";
    done({ ok, clicked: true, message: body.message, ...state }, ok ? 0 : 1);
  } catch (err) {
    if (err instanceof DoneSignal) throw err;
    done({ ok: false, error: String(err && err.message || err) }, 1);
  } finally {
    if (browser) await browser.close().catch(() => {});
    else await globalThis.__ctx?.close().catch(() => {});
  }
})().then(() => process.exit(0), (e) => process.exit(e instanceof DoneSignal ? e.code : 1));
