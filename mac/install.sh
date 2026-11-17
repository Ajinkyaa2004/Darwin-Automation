#!/bin/bash
# One-time setup of the Mac version.  Run from the repo folder:  bash mac/install.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$HOME/.darwinbox" "$HOME/Library/LaunchAgents"
chmod +x "$DIR/mac/run.sh"

echo "1/4  Installing packages..."
(cd "$DIR" && npm install --silent)

echo "2/4  Saving your Darwinbox login (stored only on this Mac, in ~/.darwinbox/env)"
if [ ! -f "$HOME/.darwinbox/env" ]; then
  read -r -p "     Employee ID: " EMP
  read -r -s -p "     Darwinbox password (hidden): " PASS; echo
  umask 077
  printf 'DARWINBOX_USER=%q\nDARWINBOX_PASS=%q\n' "$EMP" "$PASS" > "$HOME/.darwinbox/env"
else
  echo "     (already saved; delete ~/.darwinbox/env to change it)"
fi

echo "3/4  Scheduling clock in 1:35 PM and clock out 10:55 PM, Sat to Wed..."
make_plist () {  # label action hour minute
  cat > "$HOME/Library/LaunchAgents/$1.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/mac/run.sh</string><string>$2</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><array>
$(for d in 6 0 1 2 3; do echo "    <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>$3</integer><key>Minute</key><integer>$4</integer></dict>"; done)
  </array>
  <key>StandardOutPath</key><string>$HOME/.darwinbox/launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.darwinbox/launchd.log</string>
</dict></plist>
PL
  launchctl unload "$HOME/Library/LaunchAgents/$1.plist" 2>/dev/null || true
  launchctl load "$HOME/Library/LaunchAgents/$1.plist"
}
make_plist com.darwinbox.clockin in 13 35
make_plist com.darwinbox.clockout out 22 55

echo "4/4  Waking the Mac before clock-in (needs your Mac login password)..."
sudo pmset repeat wakeorpoweron SMTWU 13:33:00
echo
echo "Installed. Next: run  node mac/login.js  once and sign in (tick Remember me)."
