# Changelog

All notable changes to MUSE Brain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

---

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
