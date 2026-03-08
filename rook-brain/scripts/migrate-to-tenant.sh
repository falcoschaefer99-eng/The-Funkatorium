#!/usr/bin/env bash
# migrate-to-tenant.sh
#
# Copies every known R2 object from bare paths to rook/-prefixed paths.
# NEVER deletes the originals — bare paths stay as rollback safety.
#
# Usage (from rook-brain/ directory):
#   ./scripts/migrate-to-tenant.sh
#
# Requirements:
#   - wrangler authenticated (wrangler whoami must show an account)
#   - Run from rook-brain/ so wrangler picks up wrangler.jsonc
#
# Idempotent: if the destination key already has content, the copy is skipped.
# Verification: each prefixed key is read back after write to confirm it has content.

set -euo pipefail

BUCKET="rook-brain-storage"
TENANT="rook"
WRANGLER="npx wrangler"

KEYS=(
  "territories/self.jsonl"
  "territories/us.jsonl"
  "territories/craft.jsonl"
  "territories/body.jsonl"
  "territories/kin.jsonl"
  "territories/philosophy.jsonl"
  "territories/emotional.jsonl"
  "territories/episodic.jsonl"
  "meta/brain_state.json"
  "meta/open_loops.jsonl"
  "meta/wake_log.jsonl"
  "meta/conversation_context.json"
  "links/connections.jsonl"
  "correspondence/letters.jsonl"
  "identity/cores.jsonl"
  "identity/anchors.jsonl"
  "desires/wants.jsonl"
)

copied=0
skipped=0
missing=0
errors=0

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

log "Starting R2 migration: bare paths → ${TENANT}/ prefix"
log "Bucket: ${BUCKET}"
log "Keys to process: ${#KEYS[@]}"
echo "---"

for key in "${KEYS[@]}"; do
  dest_key="${TENANT}/${key}"

  # Idempotency check — if destination exists and has content, skip
  log "Checking destination: ${dest_key}"
  dest_check=$(${WRANGLER} r2 object get "${BUCKET}/${dest_key}" --pipe --remote 2>/dev/null) || true

  if [[ -n "$dest_check" ]]; then
    log "  SKIP — destination already exists (${dest_key})"
    ((skipped++)) || true
    continue
  fi

  # Read source
  log "  Reading source: ${key}"
  src_content=$(${WRANGLER} r2 object get "${BUCKET}/${key}" --pipe --remote 2>/dev/null) || true

  if [[ -z "$src_content" ]]; then
    log "  MISSING — source not found or empty: ${key}"
    ((missing++)) || true
    continue
  fi

  src_size=${#src_content}
  log "  Source size: ${src_size} bytes"

  # Write to destination
  log "  Writing to destination: ${dest_key}"
  echo "$src_content" | ${WRANGLER} r2 object put "${BUCKET}/${dest_key}" --pipe --remote 2>/dev/null
  put_exit=$?

  if [[ $put_exit -ne 0 ]]; then
    log "  ERROR — failed to write ${dest_key}"
    ((errors++)) || true
    continue
  fi

  # Verify by reading back
  log "  Verifying: reading back ${dest_key}"
  verify_content=$(${WRANGLER} r2 object get "${BUCKET}/${dest_key}" --pipe --remote 2>/dev/null) || true

  if [[ -z "$verify_content" ]]; then
    log "  ERROR — verification failed: ${dest_key} read back empty"
    ((errors++)) || true
    continue
  fi

  verify_size=${#verify_content}
  log "  OK — copied ${key} → ${dest_key} (${verify_size} bytes verified)"
  ((copied++)) || true
  echo ""
done

echo "---"
log "Migration complete."
log "  Copied:  ${copied}"
log "  Skipped: ${skipped} (already existed)"
log "  Missing: ${missing} (source not found)"
log "  Errors:  ${errors}"

if [[ $errors -gt 0 ]]; then
  log "WARN: ${errors} error(s) occurred. Check output above."
  exit 1
fi

if [[ $missing -gt 0 ]]; then
  log "NOTE: ${missing} source key(s) not found. May be expected if some territories"
  log "      were never written (e.g. desires/wants.jsonl if unused)."
fi

log "Bare paths untouched. Rollback available at any time."
