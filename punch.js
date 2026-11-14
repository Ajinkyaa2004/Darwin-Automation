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
    const otpError = { ok: false, error: "Darwinbox asked for an OTP: saved device is no longer trusted. Re-run save-session.js on your Mac and update the DARWINBOX_STATE secret." };

    // 1) Log in (skipped if the saved session is still logged in)
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    if (/otpauth/.test(page.url())) done(otpError, 1);
    if (!/\/ms\/db\/home/.test(page.url())) {
      await page.getByPlaceholder(/email|emp/i).first().fill(process.env.DARWINBOX_USER);
      await page.getByPlaceholder(/password/i).first().fill(process.env.DARWINBOX_PASS);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/ms\/db\/home|otpauth/, { timeout: 45000 });
      if (/otpauth/.test(page.url())) done(otpError, 1);
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
