#!/bin/bash
# Install Rainer as a Codex prompt command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/../templates/RAINER.md"
TARGET_DIR="$HOME/.codex/prompts"
TARGET="$TARGET_DIR/rainer.md"

mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET"

echo "Installed Rainer Codex prompt to: $TARGET"
echo "Invoke inside Codex with: /prompts:rainer"
