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

# Times and week offs come from schedule.json. The Mac runs 5 min after the
# GitHub run (as a backup) and wakes itself 2 min before that.
eval "$(cd "$DIR" && node -e '
const s=require("./schedule.json"), D=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], L="UMTWRFS";
const off=s.weekOffs.map(d=>D.indexOf(d.slice(0,3)));
const at=(t,add)=>{let [h,m]=t.split(":").map(Number);let x=(h*60+m+add+1440)%1440;return [Math.floor(x/60),x%60]};
const [ih,im]=at(s.clockIn,5),[oh,om]=at(s.clockOut,5),[wh,wm]=at(s.clockIn,3);
const days=[0,1,2,3,4,5,6].filter(d=>!off.includes(d));
const p=n=>String(n).padStart(2,"0");
console.log(`IN_H=${ih} IN_M=${im} OUT_H=${oh} OUT_M=${om} WAKE=${p(wh)}:${p(wm)}:00 DAYS="${days.join(" ")}" WAKEDAYS=${days.map(d=>L[d]).join("")} OUTDAYS="${days.map(d=>(oh*60+om)<(ih*60+im)?(d+1)%7:d).join(" ")}"`);
')"
echo "3/4  Scheduling (from schedule.json): clock in $IN_H:$(printf %02d $IN_M), clock out $OUT_H:$(printf %02d $OUT_M), on days $DAYS (0=Sun)..."
make_plist () {  # label action hour minute days
  cat > "$HOME/Library/LaunchAgents/$1.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/mac/run.sh</string><string>$2</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><array>
$(for d in $5; do echo "    <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>$3</integer><key>Minute</key><integer>$4</integer></dict>"; done)
  </array>
  <key>StandardOutPath</key><string>$HOME/.darwinbox/launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.darwinbox/launchd.log</string>
</dict></plist>
PL
  launchctl unload "$HOME/Library/LaunchAgents/$1.plist" 2>/dev/null || true
  launchctl load "$HOME/Library/LaunchAgents/$1.plist"
}
make_plist com.darwinbox.clockin in "$IN_H" "$IN_M" "$DAYS"
make_plist com.darwinbox.clockout out "$OUT_H" "$OUT_M" "$OUTDAYS"

echo "4/4  Waking the Mac before clock-in (needs your Mac login password)..."
sudo pmset repeat wakeorpoweron SMTWU 13:38:00
echo
echo "Installed. (First time only: run  node mac/login.js  and sign in, tick Remember me.)"
