#!/bin/bash
for l in com.darwinbox.clockin com.darwinbox.clockout; do
  launchctl unload "$HOME/Library/LaunchAgents/$l.plist" 2>/dev/null
  rm -f "$HOME/Library/LaunchAgents/$l.plist"
done
sudo pmset repeat cancel
echo "Removed. Your saved login is still in ~/.darwinbox (delete that folder to remove it)."
