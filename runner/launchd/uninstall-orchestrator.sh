#!/usr/bin/env bash
set -euo pipefail

PLIST_TARGET="$HOME/Library/LaunchAgents/com.muse.brain.orchestrator.plist"

launchctl unload "$PLIST_TARGET" >/dev/null 2>&1 || true
rm -f "$PLIST_TARGET"
echo "Unloaded and removed $PLIST_TARGET"
