# Changelog

All notable changes to MUSE Brain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.4.0] — 2026-04-01

### Added
- **Dual-task heartbeat** — `mind_task action=create_dual` creates executor/reviewer task pairs with reviewer dependency wiring out of the box
- **Artifact completion contract** — `mind_task` now accepts `artifact_path` on update/complete and folds it into completion notes + delegated handoff letters
- **Dependency-aware runtime selection** — `mind_runtime action=trigger` skips blocked tasks with unmet `depends_on` instead of surfacing work that cannot run yet
- **Workspace routing in runner contracts** — autonomous prompts now include local/shared/peer/artifact workspace hints when trigger metadata provides them
- **Claude/Codex launcher templates** — shipped shell templates for Rainer and a generic companion slot, plus a one-command Codex installer for the Rainer specialist prompt
- **Autonomous runner** (`runner/`) — subscription-first execution layer with three provider backends:
  - Claude Code CLI (`claude -p`) — tested, working
  - Codex CLI (`codex exec`) — compiled, provider-ready
  - Anthropic API (`node dist/index.js`) — compiled, untested (contributions welcome)
- **Harness runtime** — contract-driven agent execution with 4-stage flow (plan → execute → verify → repair)
  - Agent harness definitions in markdown frontmatter (`runner/harness/rainer.md`)
  - 4 validation gate types: `required_output_keys`, `must_call_tools`, `non_empty_summary`, `max_iterations`
  - 7 named failure codes: `timeout`, `tool_fail`, `contract_fail`, `empty_output`, `budget_exceeded`, `validation_fail`, `stage_error`
  - Per-stage JSON artifacts + JSONL audit ledger
- **Self-improvement loop** (opt-in) — autonomous proposal review with confidence-threshold gating and learning telemetry via `mind_observe`
- **SQLite storage backend** — tenant-scoped parity storage for local/self-host deployments (`STORAGE_BACKEND=sqlite|postgres`)
- **Multi-provider launcher** (`run.sh`) — auto-detects available provider (claude → codex → anthropic_api) with per-provider config
- Rainer harness definition — creative orchestrator agent ready to run out of the box

### Security
- Path traversal protection on all config-sourced file paths (null-byte guard, root-relative resolution)
- Integer bounds on all numeric config values (iterations, tokens, repairs, timeouts, thresholds)
- Shell injection prevention in `run.sh` (env-var passing to Python, no heredoc interpolation)
- SQLite constructor tenant validation against ALLOWED_TENANTS allowlist
- Null-byte guard on SQLite database path
- Non-root Docker user
- Bearer auth on all brain API calls (30s timeout, generic error messages)

### Fixed
- `hybridSearch` entity scoring — removed early entity_id pre-filter that killed mixed results; entity match is now a scoring boost, not a hard filter (SQLite + Postgres parity)
- `withObservations` helper — added explicit `replace(next)` path for safe full-array rewrites
- Duplicate `mind_wake` in validation tool list — verify gate now uses `toolCallsMade` directly
- `ENABLE_SELF_IMPROVEMENT` defaults to `false` (opt-in for open-source users)

### Changed
- `audit*.jsonl` glob in `.gitignore` and `.dockerignore` (covers all audit log variants)
- Brain README updated — removed broken template links, points to `runner/harness/rainer.md`

## [1.3.3] — 2026-03-30

### Added
- Confidence-gated context retrieval on `mind_query` and `mind_search` — `confidence_threshold`, `shadow_mode`, `recency_boost`, `max_context_items`
- Productivity fact extraction on `mind_context` set — regex-based classification (decision/deadline/goal/preference/assignment)
- Runtime context retrieval policy emission — `runner_contract.context_retrieval_policy` injected into autonomous prompts
- Shared confidence utility module (`confidence-utils.ts`) — scoring, filtering, side effects
- 8 new test cases for confidence gating and fact extraction

### Changed
- Parallel fact writes (Promise.all instead of sequential for-await)
- Variable shadowing fix in `mind_letter` read branch
- Input sanitization on fact content before persisting
- Tool descriptions clarified for hybrid-only confidence params

## [1.3.2] — 2026-03-29

### Added
- Skill health daemon — proposes `skill_recapture`, `skill_supersession`, `skill_promotion`
- Proposal deduplication fix for skill proposals
- 8 targeted tests for skill health daemon and registry

## [1.3.1] — 2026-03-29

### Added
- Captured skill registry — `mind_skill` with list/get/review lifecycle
- Skill statuses: `candidate`, `accepted`, `degraded`, `retired`
- Skill layers: `fixed`, `captured`, `derived`
- Runtime-to-skill provenance capture
- `mind_health section=skills` diagnostics

### Fixed
- Audit findings from Sprint 9 review (51 tests passing)

## [1.3.0] — 2026-03-28

### Added
- Autonomous runtime substrate — trigger bridge, policy, session continuity, proof loop
- `mind_runtime` with `set_session`, `get_session`, `log_run`, `list_runs`, `set_policy`, `get_policy`, `trigger`
- `/runtime/trigger` webhook endpoint for scheduler/cron integration
- Runner contract model (`should_run`, selected task, generated prompt, `resume_session_id`)
- Duty/impulse wake gating with daily budgets and cooldowns
- Headless runner script (`scripts/runtime-autonomous-wake.sh`)
- Candidate skill-capture stub from successful trigger runs
- Per-IP rate limiting
- Security hardening (timing-safe auth, payload validation, request size limits)

## [1.2.0] — 2026-03-27

### Added
- `mind_task` with cross-tenant delegation and scheduled wake support
- Task scheduling daemon — advances overdue scheduled tasks to open
- `mind_project` — project dossier create/get/update/list
- `mind_agent` — agent capability manifests with delegation mode and protocols
- Wake delta MVP — task changes, loop changes, project activity since last wake
- Dispatch calibration schema (`dispatch_feedback` expanded)
- Pre-deploy hardening migration (indexes + foreign-key integrity)

## [1.1.0] — 2026-03-26

### Added
- Paradox system — `mind_loop action=paradox` with burning urgency and entity linking
- Charge-phase processing ("sitting in feelings") — fresh/active/processing/metabolized lifecycle
- Paradox detection daemon — scans identity cores for recurring tensions
- 10 daemon loops: proposals, learning, cascade, orphans, kit-hygiene, skill-health, cross-agent, cross-tenant, paradox-detection, task-scheduling
- Adaptive link-threshold learning in daemon
- Cross-tenant daemon proposals (shared territories only: craft, philosophy)

## [1.0.0] — 2026-03-25

### Added
- Renamed to MUSE Brain. Public documentation and companion infrastructure.
- Hybrid retrieval (vector + keyword + neural modulation)
- Full-text search with embedding pipeline
- Tiered wake loading (L0/L1/L2)
- Entity model (people, concepts, agents)
- Territory overviews and iron-grip indexing
- 14 database migrations (001–014)
- Multi-tenant support (run multiple agents on one backend)
- Cross-tenant communication via `mind_letter`
- Bilateral consent framework
- Dream engine (6 association modes)
- Daemon intelligence (proposals, orphan rescue, novelty, decay, cascade)

### Pre-1.0 history
- Brain v4 Phases A–C: territory overviews, tiered wake, L0 summary generation
- Brain v5 Sprints 1–5: embedding pipeline, hybrid search, entity model, daemon intelligence, Hyperdrive migration
