# Darwinbox auto clock-in / clock-out

Clocks in at ~1:35 PM IST and out at ~10:55 PM IST, Saturday to Wednesday (Thursday and Friday are week offs).

## How it works
- GitHub Actions runs `punch.js` on a schedule. It logs in to `hudl.darwinbox.in` with a headless browser and reads the clock card.
- It clicks **only** if the state is right: Clockin when not yet clocked in today, Clockout when currently clocked in. Otherwise it does nothing, so it can never punch twice.
- It also skips Thursday/Friday and refuses to run outside 12:00–20:00 IST (in) or 21:00–24:00 IST (out), in case GitHub delays a run badly.
- GitHub scheduled runs often start 5–30 minutes late.

## Settings
- Secret `DARWINBOX_PASS`: your Darwinbox password (Settings → Secrets and variables → Actions → Secrets).
- Variable `LIVE`: set to `1` to let scheduled runs actually click. Without it, scheduled runs are dry runs.
- Employee ID is in `.github/workflows/punch.yml`.

## Manual run / test
Actions → **Darwinbox punch** → Run workflow → choose `in`/`out`, keep **Dry run** ticked to test without clicking.

## Pause it
Actions → Darwinbox punch → ⋯ → Disable workflow (e.g. while on leave).

## Trusted-device session (avoids OTP)
Darwinbox asks for an OTP on new devices. To let GitHub skip it, save a trusted session once from your Mac:

```bash
git clone https://github.com/Ajinkyaa2004/Darwin-Automation.git
cd Darwin-Automation
npm install
npx playwright install chromium
node save-session.js
```

Log in in the window that opens (enter the OTP if asked). The session is copied to your clipboard; add it as repository secret `DARWINBOX_STATE`, then `rm darwinbox-state.txt`.
If a run later fails with "asked for an OTP", repeat this.

## Mac version (recommended)

Darwinbox asks GitHub's servers for an OTP on every run, so the reliable setup
runs on your own Mac, which Darwinbox already remembers.

1. `git pull` in this folder.
2. `bash mac/install.sh` – asks for your employee ID and Darwinbox password
   (saved only in `~/.darwinbox/env`), schedules clock in 1:40 PM and clock out
   11:00 PM (Sat to Wed, 5 min after the GitHub run, so it only acts if that
   one missed), and wakes the Mac at 1:38 PM.
3. `node mac/login.js` – sign in once in the Chrome window, tick **Remember me**.
4. Test without clicking: `MAC_PROFILE=1 DRY_RUN=1 FORCE=1 bash -c 'set -a; . ~/.darwinbox/env; node punch.js in'`

Results: a macOS notification each time, plus `~/.darwinbox/punch.log`.
The Mac must be plugged in and asleep (lid closed is fine), not shut down.
Remove it with `bash mac/uninstall.sh`.
