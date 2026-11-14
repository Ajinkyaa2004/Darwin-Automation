# Darwinbox auto clock-in / clock-out

Clocks in at ~1:35 PM IST and out at ~10:55 PM IST, Saturday to Wednesday (Thursday and Friday are week offs).

## How it works
- GitHub Actions runs `punch.js` on a schedule. It logs in to `hudl.darwinbox.in` with a headless browser and reads the clock card.
- It clicks **only** if the state is right: Clockin when not yet clocked in today, Clockout when currently clocked in. Otherwise it does nothing, so it can never punch twice.
- It also skips Thursday/Friday and refuses to run outside 12:00–20:00 IST (in) or 21:00–24:00 IST (out), in case GitHub delays a run badly.
- GitHub scheduled runs often start 5–30 minutes late.

## Settings
- Secret `DARWINBOX_PASS`: your Darwinbox password (Settings → Secrets and variables → Actions → Secrets).
- Variable `DARWINBOX_USER`: employee ID.
- Variable `DRY_RUN`: `1` = log in and check only, `0` = live.

## Manual run / test
Actions → **Darwinbox punch** → Run workflow → choose `in`/`out`, keep **Dry run** ticked to test without clicking.

## Pause it
Actions → Darwinbox punch → ⋯ → Disable workflow (e.g. while on leave).
