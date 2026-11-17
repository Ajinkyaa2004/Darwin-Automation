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
const WEEK_OFFS = [4, 5]; // Thursday, Friday (IST)

// Hours (IST) in which each action is allowed, so a badly delayed run can't
// clock you in at night or out in the afternoon.
const WINDOWS = { in: [12, 20], out: [21, 24] };

function istNow() {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => f.find((p) => p.type === t).value;
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    hour: Number(get("hour")),
  };
}

function done(result, code = 0) {
  console.log(JSON.stringify(result, null, 2));
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
    if (WEEK_OFFS.includes(now.day)) done({ ok: true, skipped: "week off", ist: now });
    const [from, to] = WINDOWS[action];
    if (now.hour < from || now.hour >= to) done({ ok: true, skipped: "outside time window", ist: now });
  }

  // Saved "trusted device" state from save-session.js (gzip + base64).
  let storageState;
  if (process.env.DARWINBOX_STATE) {
    try {
      storageState = JSON.parse(zlib.gunzipSync(Buffer.from(process.env.DARWINBOX_STATE.trim(), "base64")).toString());
    } catch (e) {
      done({ ok: false, error: "DARWINBOX_STATE is not valid; re-run save-session.js" }, 1);
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      timezoneId: "Asia/Kolkata", locale: "en-IN", viewport: { width: 420, height: 900 },
      storageState,
    });
    const page = await ctx.newPage();
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

      // 1) Darwinbox keeps the last OTP active and only emails when it sends a
      //    new one. Use a new email if one arrives, else the latest from 24h.
      let otp = await latestOtp(sinceMs - 20000, 20000);
      if (otp && await submit(otp, "new email")) return;
      if (!otp) {
        otp = await latestOtp(sinceMs - 24 * 3600000, 0);
        if (otp && await submit(otp, "latest active OTP")) return;
      }

      // 2) That didn't work: press "Resend OTP" (allowed after 30s) and use the new email.
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
      await page.waitForURL(/\/ms\/db\/home|otpauth/, { timeout: 45000 });
      if (/otpauth/.test(page.url())) await handleOtp(otpSince);
    }

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
    done({ ok: false, error: String(err && err.message || err) }, 1);
  } finally {
    await browser.close().catch(() => {});
  }
})();
