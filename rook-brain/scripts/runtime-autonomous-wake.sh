#!/usr/bin/env bash
set -euo pipefail

# Runtime autonomous wake runner (Sprint 8)
#
# Flow:
# 1) Calls POST /runtime/trigger to apply policy gates and pick/claim a task
# 2) Uses returned runner_contract.prompt as the headless task prompt
# 3) Optionally resumes an existing Claude session_id
#
# Required env:
#   BRAIN_URL        e.g. https://rook.funkatorium.org
#   BRAIN_API_KEY    Worker API key
#   BRAIN_TENANT     rook|rainer
#
# Optional env:
#   WAKE_KIND                duty|impulse (default: duty)
#   TRIGGER_MODE             schedule|webhook|manual|delegated (default: schedule)
#   AUTO_CLAIM_TASK          true|false (default: true for duty, false for impulse)
#   ENFORCE_POLICY           true|false (default: true)
#   EMIT_SKILL_CANDIDATE     true|false (default: true for duty, false for impulse)
#   PREVIEW_LIMIT            integer 0..100 (default: 20)
#   OPEN_DUE_LIMIT           integer 1..500 (default: 200)
#   INCLUDE_ASSIGNED         true|false (default: true)
#   SESSION_ID               explicit session override (optional)
#   EXTRA_METADATA_JSON      JSON object (default: {})
#   CLAUDE_ALLOWED_TOOLS     pass-through to --allowedTools (optional)
#   CLAUDE_MODEL             pass-through to --model (optional)
#   CLAUDE_EXTRA_ARGS        extra CLI args appended as a single string (optional)
#   DRY_RUN                  1 -> prints trigger payload/response and exits

for bin in curl jq; do
	if ! command -v "$bin" >/dev/null 2>&1; then
		echo "Missing required binary: $bin" >&2
		exit 1
	fi
done

if [[ -z "${BRAIN_URL:-}" || -z "${BRAIN_API_KEY:-}" || -z "${BRAIN_TENANT:-}" ]]; then
	echo "Missing required env. Need BRAIN_URL, BRAIN_API_KEY, and BRAIN_TENANT." >&2
	exit 1
fi

if [[ "$BRAIN_URL" != https://* ]]; then
	echo "BRAIN_URL must use HTTPS (got: ${BRAIN_URL%%://*}://...)" >&2
	exit 1
fi

WAKE_KIND="${WAKE_KIND:-duty}"
TRIGGER_MODE="${TRIGGER_MODE:-schedule}"
ENFORCE_POLICY="${ENFORCE_POLICY:-true}"
PREVIEW_LIMIT="${PREVIEW_LIMIT:-20}"
OPEN_DUE_LIMIT="${OPEN_DUE_LIMIT:-200}"
INCLUDE_ASSIGNED="${INCLUDE_ASSIGNED:-true}"
EXTRA_METADATA_JSON="${EXTRA_METADATA_JSON:-{}}"

if [[ -z "${AUTO_CLAIM_TASK:-}" ]]; then
	if [[ "$WAKE_KIND" == "duty" ]]; then
		AUTO_CLAIM_TASK="true"
	else
		AUTO_CLAIM_TASK="false"
	fi
fi

if [[ -z "${EMIT_SKILL_CANDIDATE:-}" ]]; then
	if [[ "$WAKE_KIND" == "duty" ]]; then
		EMIT_SKILL_CANDIDATE="true"
	else
		EMIT_SKILL_CANDIDATE="false"
	fi
fi

if ! jq -e . >/dev/null 2>&1 <<<"$EXTRA_METADATA_JSON"; then
	echo "EXTRA_METADATA_JSON must be valid JSON." >&2
	exit 1
fi

SESSION_PAYLOAD='null'
if [[ -n "${SESSION_ID:-}" ]]; then
	SESSION_PAYLOAD="$(jq -Rn --arg v "$SESSION_ID" '$v')"
fi

TRIGGER_PAYLOAD="$(jq -n \
	--arg wake_kind "$WAKE_KIND" \
	--arg trigger_mode "$TRIGGER_MODE" \
	--argjson auto_claim_task "$AUTO_CLAIM_TASK" \
	--argjson enforce_policy "$ENFORCE_POLICY" \
	--argjson preview_limit "$PREVIEW_LIMIT" \
	--argjson limit "$OPEN_DUE_LIMIT" \
	--argjson include_assigned "$INCLUDE_ASSIGNED" \
	--argjson emit_skill_candidate "$EMIT_SKILL_CANDIDATE" \
	--argjson metadata "$EXTRA_METADATA_JSON" \
	--argjson session_id "$SESSION_PAYLOAD" \
	'{
		wake_kind: $wake_kind,
		trigger_mode: $trigger_mode,
		auto_claim_task: $auto_claim_task,
		enforce_policy: $enforce_policy,
		preview_limit: $preview_limit,
		limit: $limit,
		include_assigned: $include_assigned,
		emit_skill_candidate: $emit_skill_candidate,
		metadata: $metadata
	}
	+ (if $session_id == null then {} else {session_id: $session_id} end)
')"

TRIGGER_URL="${BRAIN_URL%/}/runtime/trigger"
RESPONSE="$(curl -fsS \
	-X POST "$TRIGGER_URL" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer ${BRAIN_API_KEY}" \
	-H "X-Brain-Tenant: ${BRAIN_TENANT}" \
	-d "$TRIGGER_PAYLOAD")"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
	echo "=== runtime trigger payload ==="
	echo "$TRIGGER_PAYLOAD" | jq .
	echo
	echo "=== runtime trigger response ==="
	echo "$RESPONSE" | jq .
	exit 0
fi

DEFERRED="$(jq -r '.deferred // false' <<<"$RESPONSE")"
SHOULD_RUN="$(jq -r '.runner_contract.should_run // false' <<<"$RESPONSE")"
PROMPT="$(jq -r '.runner_contract.prompt // ""' <<<"$RESPONSE")"
RESUME_SESSION_ID="$(jq -r '.runner_contract.resume_session_id // ""' <<<"$RESPONSE")"
TASK_ID="$(jq -r '.runner_contract.task.id // ""' <<<"$RESPONSE")"

if [[ "$DEFERRED" == "true" || "$SHOULD_RUN" != "true" || -z "$PROMPT" || -z "$TASK_ID" ]]; then
	echo "No runnable wake this cycle (deferred or no task selected)." >&2
	echo "$RESPONSE" | jq .
	exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
	echo "Trigger succeeded but 'claude' CLI is unavailable; cannot execute headless task." >&2
	echo "$RESPONSE" | jq .
	exit 1
fi

echo "Running autonomous wake for tenant=${BRAIN_TENANT}, task=${TASK_ID}, wake_kind=${WAKE_KIND}."

CMD=(claude -p "$PROMPT")
if [[ -n "$RESUME_SESSION_ID" ]]; then
	CMD+=(--resume "$RESUME_SESSION_ID")
fi
if [[ -n "${CLAUDE_ALLOWED_TOOLS:-}" ]]; then
	CMD+=(--allowedTools "$CLAUDE_ALLOWED_TOOLS")
fi
if [[ -n "${CLAUDE_MODEL:-}" ]]; then
	CMD+=(--model "$CLAUDE_MODEL")
fi
if [[ -n "${CLAUDE_EXTRA_ARGS:-}" ]]; then
	if [[ "$CLAUDE_EXTRA_ARGS" == *['*?;|&$`'\\$'\n']* ]]; then
		echo "CLAUDE_EXTRA_ARGS contains unsafe characters (no globs, pipes, semicolons, or newlines)." >&2
		exit 1
	fi
	IFS=' ' read -ra EXTRA_ARGS <<< "$CLAUDE_EXTRA_ARGS"
	CMD+=("${EXTRA_ARGS[@]}")
fi

"${CMD[@]}"
