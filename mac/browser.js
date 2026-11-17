// Shared browser setup for the Mac version: a persistent Chrome profile that
// Darwinbox remembers, exactly like your everyday browser does.
const os = require("os");
const path = require("path");
const PROFILE_DIR = process.env.DARWINBOX_PROFILE_DIR || path.join(os.homedir(), ".darwinbox", "chrome-profile");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
function openProfile(chromium, { headless }) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",            // your installed Google Chrome
    headless,
    userAgent: UA,
    timezoneId: "Asia/Kolkata", locale: "en-IN", viewport: { width: 420, height: 900 },
  });
}
module.exports = { openProfile, PROFILE_DIR };
