#!/bin/bash
# Called by launchd at clock-in / clock-out time:  mac/run.sh in|out
ACTION="$1"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/.darwinbox/punch.log"
mkdir -p "$HOME/.darwinbox"
set -a; source "$HOME/.darwinbox/env"; set +a
export MAC_PROFILE=1

# Give Wi-Fi a moment after the Mac wakes up.
for i in $(seq 1 30); do
  curl -s -o /dev/null -m 5 https://hudl.darwinbox.in && break
  sleep 5
done

cd "$DIR"
OUT=$(node punch.js "$ACTION" 2>&1)
CODE=$?
{ echo "=== $(date '+%Y-%m-%d %H:%M:%S') $ACTION (exit $CODE)"; echo "$OUT"; } >> "$LOG"

# macOS notification with the result
if echo "$OUT" | grep -q '"clicked": true' && [ $CODE -eq 0 ]; then
  MSG="Darwinbox: clocked $ACTION ✅"
elif echo "$OUT" | grep -q '"skipped"\|"reason"'; then
  MSG="Darwinbox: no click needed ($ACTION)"
else
  MSG="Darwinbox: clock $ACTION FAILED, punch manually ⚠️"
fi
osascript -e "display notification \"$MSG\" with title \"Darwin-Automation\"" 2>/dev/null
exit $CODE
