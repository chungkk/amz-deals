#!/usr/bin/env bash
# Install or update macOS LaunchAgent to run scripts/push-cron.sh every 30 minutes (1800s).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="biz.halle.amz-deals-push"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_FILE="$HOME/Library/Logs/amz-deals-push.log"
INTERVAL_SEC="${PUSH_INTERVAL_SEC:-1800}"
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"

chmod +x "$PROJECT_DIR/scripts/push-cron.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/push-cron.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>${INTERVAL_SEC}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed LaunchAgent: $PLIST (every ${INTERVAL_SEC}s)"
echo "Log file: $LOG_FILE"
echo "Run immediately: launchctl kickstart -k gui/$(id -u)/${LABEL}"
