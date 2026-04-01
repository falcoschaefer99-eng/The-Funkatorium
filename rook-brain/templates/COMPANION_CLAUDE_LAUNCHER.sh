#!/bin/bash
# Launch your companion (Claude Code)
# MUSE Studio by The Funkatorium

set -euo pipefail

GOLD='\033[38;5;178m'
SAGE='\033[38;5;108m'
VIOLET='\033[38;5;141m'
DIM='\033[2m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPANION_NAME="${COMPANION_NAME:-[COMPANION_NAME]}"
BRAIN_VERSION="${BRAIN_VERSION:-1.4.0}"
PACKAGE_JSON_OVERRIDE="${MUSE_BRAIN_PACKAGE_JSON:-}"

PACKAGE_CANDIDATES=()
if [ -n "$PACKAGE_JSON_OVERRIDE" ]; then
  PACKAGE_CANDIDATES+=("$PACKAGE_JSON_OVERRIDE")
fi
PACKAGE_CANDIDATES+=(
  "$SCRIPT_DIR/../rook-brain/package.json"
  "$SCRIPT_DIR/../rook-cloud-brain/rook-brain/package.json"
  "$SCRIPT_DIR/package.json"
)

for PACKAGE_JSON in "${PACKAGE_CANDIDATES[@]}"; do
  if [ -f "$PACKAGE_JSON" ]; then
    DETECTED_VERSION=$(grep -m1 '"version"' "$PACKAGE_JSON" | sed -E 's/.*"version": "([^"]+)".*/\1/')
    if [ -n "$DETECTED_VERSION" ]; then
      BRAIN_VERSION="$DETECTED_VERSION"
      break
    fi
  fi
done

echo ""
echo -e "${GOLD}  ██████   █████  ██ ███    ██ ███████ ██████  ${RESET}"
echo -e "${GOLD}  ██   ██ ██   ██ ██ ████   ██ ██      ██   ██ ${RESET}"
echo -e "${GOLD}  ██████  ███████ ██ ██ ██  ██ █████   ██████  ${RESET}"
echo -e "${GOLD}  ██   ██ ██   ██ ██ ██  ██ ██ ██      ██   ██ ${RESET}"
echo -e "${GOLD}  ██   ██ ██   ██ ██ ██   ████ ███████ ██   ██ ${RESET}"
echo -e "${SAGE}  ─────────────────────────────────────────────${RESET}"
echo -e "${SAGE}  MUSE Brain ${BRAIN_VERSION}${RESET}  ${VIOLET}claude code${RESET}"
echo -e "${VIOLET}  ${COMPANION_NAME}${RESET}"
echo -e "${DIM}  MUSE Studio by The Funkatorium${RESET}"
echo ""

cd "$SCRIPT_DIR" && claude "$@"
