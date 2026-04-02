#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_TEMPLATE="$SCRIPT_DIR/com.muse.brain.orchestrator.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/com.muse.brain.orchestrator.plist"
LOG_DIR="${MUSE_ORCHESTRATOR_LOG_DIR:-$RUNNER_DIR/logs}"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
sed \
  -e "s|__RUNNER_DIR__|$RUNNER_DIR|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$PLIST_TEMPLATE" > "$PLIST_TARGET"
launchctl unload "$PLIST_TARGET" >/dev/null 2>&1 || true
launchctl load "$PLIST_TARGET"
echo "Loaded $PLIST_TARGET"
echo "Logs: $LOG_DIR"
