// Run ONCE (and again only if Darwinbox ever asks for an OTP):
//   node mac/login.js
// Opens Chrome with the automation's own profile. Sign in, tick "Remember me",
// enter the OTP if asked. When the dashboard loads it closes by itself.
const { chromium } = require("playwright");
const { openProfile, PROFILE_DIR } = require("./browser");
(async () => {
  const ctx = await openProfile(chromium, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto("https://hudl.darwinbox.in/user/login?continue=%2Fms%2Fdb%2Fhome");
  console.log("\n>> Sign in in the Chrome window, tick 'Remember me', enter the OTP if asked.");
  console.log(">> Waiting up to 5 minutes for the dashboard...\n");
  await page.waitForURL(/\/ms\/db\/home/, { timeout: 5 * 60 * 1000 });
  await page.waitForTimeout(5000);
  await ctx.close();
  console.log("Done. Darwinbox now remembers this profile:", PROFILE_DIR);
})().catch((e) => { console.error(e.message); process.exit(1); });
