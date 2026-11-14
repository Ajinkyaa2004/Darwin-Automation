// Run ONCE on your own Mac:  node save-session.js
// Opens a real browser window. You log in to Darwinbox yourself (and type the
// OTP if asked). When the dashboard loads, this saves the "trusted device"
// login state, compressed, to darwinbox-state.txt and copies it to the clipboard.
// Paste it into the GitHub secret DARWINBOX_STATE. Never commit that file.

const { chromium } = require("playwright");
const fs = require("fs");
const zlib = require("zlib");
const { execSync } = require("child_process");

const LOGIN_URL = "https://hudl.darwinbox.in/user/login?continue=%2Fms%2Fdb%2Fhome";
const OUT = "darwinbox-state.txt";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    timezoneId: "Asia/Kolkata", locale: "en-IN", viewport: { width: 420, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL);

  console.log("\n>> Log in in the browser window (and enter the OTP if asked).");
  console.log(">> If you see a 'remember this device' / 'trust device' option, tick it.");
  console.log(">> Waiting up to 5 minutes for the dashboard...\n");

  await page.waitForURL(/\/ms\/db\/home/, { timeout: 5 * 60 * 1000 });
  await page.waitForTimeout(5000); // let it set all cookies

  const state = await ctx.storageState();
  const packed = zlib.gzipSync(JSON.stringify(state)).toString("base64");
  fs.writeFileSync(OUT, packed);
  await browser.close();

  let copied = false;
  try { execSync("pbcopy", { input: packed }); copied = true; } catch (_) {}

  console.log(`Saved ${OUT} (${packed.length} characters).`);
  console.log(copied
    ? "It's on your clipboard. Paste it as the GitHub secret DARWINBOX_STATE."
    : `Open ${OUT}, copy everything, and paste it as the GitHub secret DARWINBOX_STATE.`);
  console.log("Then delete the file:  rm " + OUT);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
