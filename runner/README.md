# MUSE Brain Runner

Autonomous execution layer for MUSE Brain.

The runner consumes the brain's runtime contract — task selection, dependency gating, workspace routing hints, and artifact handoff expectations — and turns that into an actual execution loop.

This runner now supports **subscription-first execution** across both ecosystems:
- **Claude Code** (`claude -p`)
- **Codex CLI** (`codex exec`)

And keeps an optional API lane:
- **Anthropic SDK** (`node dist/index.js`)

---

## Modes

## 1) Unified CLI runner (`./run.sh`) — recommended default

`run.sh` selects a provider via `RUNNER_PROVIDER`:

- `auto` (default): `claude` → `codex` → `anthropic_api`
- `claude`: force Claude Code CLI
- `codex`: force Codex CLI
- `anthropic_api`: delegate to Node API runner

### Provider selection behavior (`RUNNER_PROVIDER=auto`)

1. If `claude auth status` says logged in → use `claude`
2. Else if `codex login status` says logged in → use `codex`
3. Else if `ANTHROPIC_API_KEY` is set (non-placeholder) → use `anthropic_api`
4. Else fail with actionable login/key guidance

---

## 2) API runner (`npm start` / `npm run daemon`)

Uses Anthropic SDK directly and talks to brain MCP over HTTP.

```bash
npm start       # single run
npm run daemon  # node-cron loop
```

Best for servers, CI, containerized deployments.

## 3) Mac orchestrator (`node dist/index.js --orchestrator`)

This is the new Mac-only autonomous companion loop.

It:
- loads `runner/config/tenants.json`
- evaluates due nightly dream, duty, personal, and impulse wakes
- drains duty wakes in repeated passes for same-cycle baton handoff
- executes providers in the tenant workspace
- writes audit lines and local artifacts
- can notify via Telegram directly

Run manually:

```bash
npm run build
./run-orchestrator.sh
```

Launchd assets:

- `runner/launchd/com.muse.brain.orchestrator.plist`
- `runner/launchd/install-orchestrator.sh`
- `runner/launchd/uninstall-orchestrator.sh`

---

## Setup

### A) Subscription-first (no API key required)

#### Claude provider
```bash
claude auth login
```

#### Codex provider
```bash
codex login
```

Then run:
```bash
cd runner
./run.sh
```

### B) Optional API fallback

Copy env template:
```bash
cp .env.example .env
```

Fill at minimum:
- `ANTHROPIC_API_KEY`
- `BRAIN_API_KEY`

Build + run:
```bash
npm install
npm run build
npm start
```

---

## Environment Variables

### `run.sh` provider controls

| Variable | Default | Description |
|---|---|---|
| `RUNNER_PROVIDER` | `auto` | Provider selector (`auto`, `claude`, `codex`, `anthropic_api`) |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Claude model for `claude` provider |
| `CODEX_MODEL` | `gpt-5.4` | Model for `codex` provider |
| `CODEX_SANDBOX` | `read-only` | Sandbox mode passed to `codex exec` (safer default) |
| `CODEX_PROFILE` | _(empty)_ | Optional `codex exec --profile` |
| `MAX_TURNS` | `12` | Max turns for Claude CLI mode |
| `AUDIT_PATH` | `./audit.jsonl` | JSONL audit log path |
| `SYSTEM_PROMPT_PATH` | `./system-prompt.txt` | Custom system prompt file |
| `TENANT_ID` | `rook` | Brain tenant id |
| `WORKSPACE_PATH` | `./` | Working directory for provider execution |
| `RUNNER_PROMPT_FILE` | _(empty)_ | Prompt file override for orchestrator/provider-executor mode |
| `RUNNER_RESULT_PATH` | _(empty)_ | JSON result payload path for orchestrator/provider-executor mode |
| `ALLOW_ARTIFACT_WRITES` | `false` | Enables writable Codex sandbox for artifact-producing wakes |

### API mode controls (`node dist/index.js`)

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(required for API mode)_ | Anthropic API key |
| `BRAIN_URL` | `https://rook.funkatorium.org/mcp` | Brain MCP endpoint |
| `BRAIN_API_KEY` | _(required)_ | Brain auth token |
| `MODEL` | `claude-sonnet-4-20250514` | Anthropic model |
| `MAX_ITERATIONS` | `25` | Tool-call loop cap |
| `MAX_TOKENS` | `4096` | Token cap per model call |
| `MAX_REPAIRS` | `1` | Max repair attempts after failed verify gate |
| `STAGE_TIMEOUT_MS` | `120000` | Per-stage timeout (ms) |
| `ENABLE_SELF_IMPROVEMENT` | `false` | Enable proposal auto-review + telemetry loop (opt-in) |
| `PROPOSAL_REVIEW_LIMIT` | `10` | Max pending proposals reviewed per run |
| `PROPOSAL_ACCEPT_THRESHOLD` | `0.85` | Confidence threshold for auto-accept (else reject) |
| `SCHEDULE` | `0 6,12,18 * * *` | Cron schedule for daemon mode |
| `HARNESS_AGENT_PATH` | `./harness/rainer.md` | Agent markdown with `harness_contract` in frontmatter |
| `ARTIFACT_DIR` | `./artifacts` | Stage artifact + ledger output directory |
| `TENANT_CONFIG_PATH` | `./config/tenants.json` | Mac orchestrator tenant config |
| `ORCHESTRATOR_STATE_PATH` | `./state/orchestrator-state.json` | Local state for due-slot/impulse bookkeeping |
| `ORCHESTRATOR_TIMEZONE` | `Europe/Berlin` | Orchestrator timezone fallback |
| `ORCHESTRATOR_SLOT_GRACE_MINUTES` | `10` | Allowed lateness window for slot-based wakes |
| `ORCHESTRATOR_MAX_DUTY_PASSES` | `8` | Max same-cycle baton/drain passes |
| `TELEGRAM_BOT_TOKEN` | _(optional)_ | Telegram bot token for direct local notifications |
| `TELEGRAM_CHAT_ID` | _(optional)_ | Telegram chat id for direct local notifications |

---

## How the duty cycle works

Each wake follows an explicit harness stage flow:
1. `plan`
2. `execute`
3. `verify` (validation gates)
4. `repair` (optional, bounded by `MAX_REPAIRS`)

Every stage writes a JSON artifact, and `artifact-ledger.jsonl` records the run trail. When the brain provides workspace routing hints and the executing agent produces a deliverable, the completion path should be written back through `mind_task complete` using `artifact_path` so review and notification flows can find the file again.

After successful stage verification, S3 self-improvement runs:
1. `mind_propose(action=list)` loads pending proposals
2. Proposal loop auto-reviews each pending item (`accepted`/`rejected`) by confidence threshold
3. `mind_observe` writes learning telemetry for the run

`system-prompt.txt` holds the protocol. Keep the log/close discipline intact.

---

## Audit trail

Each run writes JSONL:

```json
{
  "timestamp": "2026-03-31T16:00:00Z",
  "duration_ms": 42000,
  "turns": 9,
  "cost_usd": 0.21,
  "model": "claude-sonnet-4-20250514",
  "tenant": "rook",
  "provider": "claude",
  "status": "completed",
  "failure_code": null,
  "stage_artifacts": ["./artifacts/run_x.plan.json", "..."],
  "self_improvement": {"enabled": true, "pending": 3, "reviewed": 3, "accepted": 2, "rejected": 1},
  "summary": "Advanced revenue project burning loop"
}
```

For Codex CLI runs, `turns`/`cost_usd` are currently recorded as `0` (Codex output does not provide normalized turn/cost fields in this script path).

---

## Scheduling

### Cron with unified runner

```cron
0 6,12,18 * * * /path/to/runner/run.sh
```

### API daemon schedule

Set `SCHEDULE` in `.env`, then:

```bash
npm run daemon
```

---

## Docker

Current Dockerfile defaults to API mode (`node dist/index.js`):

```bash
docker build -t muse-brain-runner .
docker run --env-file .env -v $(pwd)/logs:/app/logs muse-brain-runner
```

If you want subscription-first behavior in containers, run `./run.sh` via an external scheduler on a host where CLI auth is already established.

## First AFK proof

Canonical first unattended test:

- Rook drafts: `/Users/falco/Documents/MUSE/duty/revenue-proposal.md`
- Rainer reviews the same artifact via baton pass

Reference dossier:

- `runner/docs/AFK_TEST_REVENUE_PROPOSAL.md`
