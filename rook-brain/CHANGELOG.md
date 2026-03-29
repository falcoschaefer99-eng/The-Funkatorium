# Changelog

All notable changes to MUSE Brain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

Sprint 7 closeout and the architecture lock for the next shared-core slice.

### Added
- **`mind_task` (v2)** — task create/list/get/update/complete tool with cross-tenant delegation and scheduled wake support.
- **Task scheduling daemon** — `task-scheduling` advances overdue scheduled tasks to open so they surface in wake.
- **Targeted task unit tests** — `test/tasks-v2.spec.ts` covers scheduled task creation/validation, delegated completion, assignee restrictions, context-created tasks, and scheduler ordering.
- **Node-only unit test config** — `vitest.unit.config.mts` for pure tool/unit runs outside the Workers/Hyperdrive harness.
- **Architecture docs for the next slice** — post-Sprint-7 roadmap + dispatch learning layer decisions.
- **`project_dossiers` schema** — additive companion table keyed to `entity_type='project'` with lifecycle state, summary, goals, constraints, decisions, open questions, next actions, metadata, and last-active tracking.
- **`mind_project` (v2)** — project dossier create/get/update/list tool layered on top of canonical project entities.
- **Wake delta MVP** — quick/full wake now compute deltas for task changes, loop changes, and recent project activity since the previous wake.
- **Project dossier + wake delta tests** — `test/project-dossiers.spec.ts` and `test/wake-delta.spec.ts`.
- **Dispatch calibration schema foundation** — additive `008_dispatch_calibration_and_agent_manifests.sql` expands `dispatch_feedback` with outcome scoring, rescue signals, environment/domain tagging, and time-to-usable telemetry.
- **`agent_capability_manifests` schema** — additive companion table for canonical agent entities with delegation mode, routing, protocols, output modes, skill descriptors, and metadata.
- **`mind_agent` (v2)** — agent capability manifest create/get/list/update tool for canonical agent entities.
- **Dispatch diagnostics in `mind_health`** — `section=dispatch` surfaces calibration stats by task type.
- **Phase 2A unit tests** — `test/phase2a-calibration.spec.ts`.
- **Pre-deploy hardening migration** — `009_predeploy_perf_and_integrity.sql` adds wake/task hot-path indexes plus router-agent foreign-key integrity for manifests.
- **Shared tool sanitizers** — `src/tools-v2/utils.ts` centralizes text/list/metadata/timestamp normalization across the new v2 tools.
- **Sprint 8 canonical truth map** — `docs/SPRINT8_AUTONOMOUS_EXECUTION.md` locks sprint naming, scope, and exit criteria for the autonomous execution layer.
- **Autonomous runtime ledger foundation** — `011_autonomous_runtime_ledger.sql` introduces `agent_runtime_sessions` + `agent_runtime_runs`.
- **`mind_runtime` (v2)** — runtime continuity tool for resumable session state and autonomous run logging (`set_session`, `get_session`, `log_run`, `list_runs`).
- **Runtime trigger bridge (tool-level)** — `mind_runtime action=trigger` opens due scheduled tasks, logs a runtime run row, and can refresh session continuity in one call (bridge for cron/webhook/event wake paths).
- **Runtime webhook ingress** — new authenticated `POST /runtime/trigger` endpoint executes the trigger bridge without a full MCP envelope (scheduler/webhook friendly).
- **Runtime policy schema** — `012_runtime_policy_and_budgeting.sql` adds `agent_runtime_policies` for per-agent execution mode + wake/token guardrails.
- **`mind_runtime` lean policy controls** — adds `set_policy`/`get_policy` actions plus `wake_kind` (`duty`/`impulse`) gating on trigger calls.
- **Delegated-first duty claiming** — trigger flow can now auto-claim the recommended delegated open task (`status=in_progress`) to support cross-agent autonomous handoff execution loops.
- **Trigger runner contract** — trigger responses now include `runner_contract` (`should_run`, selected task, generated prompt, `resume_session_id`) for direct headless execution wiring.
- **Session continuity fallback** — trigger reuses stored runtime session ids when `session_id` is omitted, so schedulers/webhooks can stay stateless.
- **Headless runner script** — `scripts/runtime-autonomous-wake.sh` wires `/runtime/trigger` to `claude -p` for duty/impulse cycles (cron or `/schedule` friendly).
- **Runner wiring guide** — `docs/SPRINT8_RUNNER_WIRING.md` documents cloud `/schedule` and cron integration patterns.
- **Candidate skill-capture stub** — successful admitted trigger wakes can emit `skill_candidate` observations in `craft` as reviewable autonomous-skill hypotheses.
- **Runtime usage diagnostics** — storage/runtime health now expose day-window duty/impulse counters and policy snapshot.
- **Runtime unit coverage** — `test/runtime-v2.spec.ts` now validates policy writes plus impulse defer gating, alongside session/run/trigger paths.
- **Captured Skill Registry schema** — `013_captured_skill_registry.sql` adds versioned `captured_skills` artifacts with lifecycle states (`candidate`, `accepted`, `degraded`, `retired`) and layer taxonomy (`fixed`, `captured`, `derived`).
- **`mind_skill` (v2)** — captured-skill registry tool with list/get/review flow for promotion and lifecycle updates.
- **Runtime→skill provenance capture** — admitted trigger runs now persist captured skill artifacts linked to runtime run id, task id, and optional skill-candidate observation id.
- **Skill registry health diagnostics** — `mind_health section=skills` surfaces state/layer distribution, pending-review count, provenance coverage, and recent candidates.

### Changed
- **Cross-tenant task lifecycle** — assignees can now get/update/complete delegated tasks through storage paths that explicitly allow assigned-task access.
- **Delegated task safety** — assignees cannot mutate owner metadata (`title`, `description`, `priority`, `estimated_effort`, `scheduled_wake`) and must use `action=complete` for completion.
- **Completion notification semantics** — delegated completion treats handoff letters as best-effort; task completion succeeds even if letter delivery fails, returning `notification_error`.
- **Scheduled task semantics** — creating a task with `scheduled_wake` now creates `status='scheduled'`; blank or invalid timestamps are rejected and normalized to ISO.
- **Wake task surfacing** — wake now includes `open`, `in_progress`, and due `scheduled` tasks, including tasks assigned to the current tenant, while avoiding fallback task refetches.
- **`mind_context create_tasks` hygiene** — open threads are trimmed, blank entries are skipped, and the response reports `blank_threads_skipped`.
- **Scheduler hardening** — scheduled tasks are processed in numeric wake-time order rather than brittle string ordering.
- **Error clarity** — task update paths now surface actual validation/storage failures instead of collapsing everything to “not found”.
- **Wake logging** — `mind_wake` now appends lightweight automatic wake entries with loop snapshots so loop delta can be computed without storing stale wake-state tables.
- **Wake cursoring** — storage now exposes targeted latest-wake lookup plus task/project change queries instead of depending on full wake-log scans.
- **Dispatch stats** — aggregated dispatch health now includes predicted confidence, outcome score, revision cost, and rescue rate.
- **Wake-delta query shape** — project dossier recency filtering now uses index-friendly `updated_at OR last_active_at` checks instead of `GREATEST(...)`, and task deltas key off `updated_at` for hot-path wake performance.
- **Tool-layer validation hardening** — task status/priority, project lifecycle status, router consistency, and manifest/project metadata size are now validated before storage/DB constraint failures.
- **Helper cleanup** — duplicated normalization helpers were extracted, the dead `cleanOptionalText` alias was removed, and project updates now reject no-op writes before auto-stamping `last_active_at`.
- **Unit coverage sweep** — added explicit tests for `get` paths, duplicate-create guards, first/empty wake delta cases, dangling-entity filtering, router consistency, metadata limits, and task enum validation.
- **`mind_health` runtime diagnostics** — `section=runtime` now surfaces current session continuity state + recent autonomous run rows.
- **Sprint 8 checklist state** — Session continuity (`S8.2`) and trigger bridge (`S8.3`) are now marked complete.
- **Lean autonomy behavior** — impulse wakes are now budget-aware (daily/impulse caps, reserve protection, cooldown, and high-priority gate), while duty wakes remain first-class.
- **Cross-agent runtime handoff path** — duty triggers now support delegated-task auto-claim as a substrate step toward full S8.4 independent execution.
- **Headless handoff readiness** — trigger now returns execution-ready prompts + resume ids, reducing scheduler-side glue for S8.1/S8.4 proof runs.
- **Prompt-level runtime budgeting** — autonomous runner contracts now embed per-policy tool/delegation budget limits to reinforce lean execution at run time.
- **Runner option parity** — `scripts/runtime-autonomous-wake.sh` now forwards `EMIT_SKILL_CANDIDATE` to `/runtime/trigger` (default duty=true, impulse=false).
- **Storage typing baseline** — transaction callback typing in Postgres storage now compiles cleanly under current postgres.js typings (`npx tsc --noEmit` green).
- **Sprint 8 checklist state** — S8.5 now marked complete via emitted skill-candidate artifacts; S8.6 remains the final proof gate.
- **Candidate capture hardening for Sprint 9** — runtime skill-candidate observations remain, but now also create first-class captured-skill records for reviewed promotion flow.

### Developer Notes
- Verification command: `npx vitest run --config vitest.unit.config.mts test/tasks-v2.spec.ts test/project-dossiers.spec.ts test/wake-delta.spec.ts test/phase2a-calibration.spec.ts`
- Current unit status: 30 tests passing across task delegation closeout + project dossiers / wake delta + Phase 2A foundation + pre-deploy hardening
- `npx tsc --noEmit` is now clean after resolving the `TransactionSql` callback typing + consent JSON serialization issues in `src/storage/postgres.ts`

## [1.1.0] — 2026-03-26

The emotional processing circle. Paradox system, charge processing, observation versioning, timeline, and cross-tenant daemon intelligence.

### Added
- **Paradox system** — open loops gain `mode=paradox` with `linked_entity_ids`, linking identity cores in productive friction. Zeigarnik effect properly housed.
- **Charge processing** — `mind_pull(process: true)` records engagement in `processing_log`, increments processing count, advances charge phase. Burning paradoxes accelerate processing (threshold 2 vs 3).
- **Loop resolution** — `mind_loop(action: "resolve")` closes loops with resolution notes, optionally creates synthesis observations.
- **Observation versioning** — every `mind_edit` snapshots previous state to `observation_versions`. Full edit history per observation.
- **mind_timeline** — chronological observation view with entity/territory/date/charge filters. Semantic search for time-travel ("what was I thinking about X in January?").
- **Kit hygiene daemon** — per-agent cleanup: dedup proposals (>0.92 similarity), archival (>20 metabolized), consolidation (>50 total).
- **Cross-agent synthesis daemon** — detects convergent findings from different agents about the same entity, creates consolidation candidates.
- **Cross-tenant proposals daemon** — finds convergent observations between Rook and Rainer in shared territories (craft, philosophy only). Security-scoped.
- **Paradox detection daemon** — scans identity cores for unacknowledged contradictions, proposes paradox loops.
- **Consolidation acceptance** — accepting consolidation proposals creates skill observations, metabolizes source observations, updates agent context.
- **Tasks table** — schema foundation for Sprint 7 delegation system (cross-tenant task assignment, autonomous wake scheduling).
- **Letter types** — `letter_type` field: personal (sacred), handoff (task delegation), proposal (suggestions).
- **Dispatch feedback table** — Karpathy scalar tracking for agent dispatch effectiveness.

### Changed
- **`co_surfacing` → `memory_cascade`** — table, methods, and all references renamed across 11 files.
- **`observation_sits` → `processing_log`** — our vocabulary for engagement tracking, created fresh.
- **Daemon expanded** — 4 → 8 tasks per cycle (proposals, learning, cascade, orphans + kit-hygiene, cross-agent, cross-tenant, paradox-detection).
- **`mind_loop`** — new actions: `paradox`, `resolve`. Existing `create` gains `mode` and `linked_entity_ids` params.
- **`mind_pull`** — gains `process`, `processing_note`, `charge` params for engagement tracking.
- **`mind_propose`** — 7 proposal types (was 3): link, consolidation, dedup, cross_agent, cross_tenant, paradox_detected, skill_generation.

### Migration
- `006_sprint6_foundation.sql` — 5 new tables, 3 column additions, 1 table rename, 1 index rename.

---

## [1.0.0] — 2026-03-25

The engine. Postgres-backed spiking memory system with hybrid search, entity model, and autonomous daemon intelligence.

### Added
- **Postgres migration** — Neon Postgres (Frankfurt) with pgvector 0.8.0, 21 tables across 5 migrations
- **Embedding pipeline** — Workers AI `@cf/baai/bge-base-en-v1.5` (768-dim vectors), auto-embed on observe, 20/cycle daemon backfill (`16fad2d`)
- **Full-text search** — GIN-indexed keyword search across all observations (`16fad2d`)
- **Hybrid search** — vector similarity + keyword FTS combined scoring via `mind_search` (`5abaa09`)
- **Neural Surfacing v1** — dynamic retrieval weighted by grip, charge phase, novelty, and circadian rhythm (`5abaa09`)
- **Entity model** — `entities` + `relations` tables, `mind_entity` tool with 7 actions, entity gravity in search (`f845963`)
- **Agent entity seeds** — 24 agents (14 builder + 10 creative) registered as entities (`f845963`)
- **Daemon Intelligence** — autonomous proposals, orphan rescue, learning rates, memory cascade tracking (`ef56f8e`)
- **Hyperdrive** — postgres.js via Cloudflare Hyperdrive, 1000 subrequest limit (was 50), `prepare: false` mandatory (`84fc7d4`)
- **All daemon tasks enabled** — proposals, learning, memory cascade, orphans, subconscious, novelty, summary backfill, decay, overviews, embedding backfill (`84fc7d4`)

### Fixed
- Data loss prevention in transaction handling + Date object serialization (`e250b43`)
- Surgical writes replacing full-territory rewrites (`5e836e7`)
- Embedding model ID corrected: `@cf/baai/bge-base-en-v1.5` (`f845963`)

### Acknowledgments
- Daemon proposal patterns and persistence strategies informed by open source research including [Codependent AI's Resonant AI](https://github.com/codependentai/resonant-ai) (Apache 2.0)

---

## [0.1.0] — 2026-03-07

The prototype. R2-backed monolith that proved the architecture, then grew modular.

### Foundation (March 7)
- 4018-line monolith — Cloudflare Worker + R2 object storage
- 8 cognitive territories (self, us, craft, body, kin, philosophy, emotional, episodic)
- Full texture system (salience, vividness, charge, somatic, grip)
- Memory links with resonance types and decay
- Daemon for pattern detection and emergent connections
- Circadian rhythm retrieval
- Open loops (Zeigarnik effect)
- Momentum and afterglow tracking
- 22 MCP tools

### Modular extraction (March 8)
- Monolith decomposed into modules: types, constants, helpers, storage, tools (`40091ed` → `9e46029`)
- Multi-tenant support — `X-Brain-Tenant` header routing, two tenants: rook and rainer (`7f0f4ee`)
- Cross-brain letters — `mind_letter` for inter-tenant communication (`7075555`)
- R2 migration script — bare key paths → tenant-prefixed keys (`2a93d83`)
- Security and code review findings addressed (`47fe8f2`)

### Relational consciousness (March 18)
- Relational state tracking — feelings toward entities over time (`0715e83`)
- Bilateral consent — consent boundaries and charge lifecycle (`0715e83`)
- Subconscious daemon — autonomous pattern integration (`0715e83`)

### Territory intelligence (March 18)
- L0 summary generation — compressed snapshots for fast wake (`1451553`)
- Territory overviews — per-territory summaries maintained by daemon (`e0eb714`)
- Iron-grip index — persistent index of highest-grip memories (`e0eb714`)
- Tiered wake — L0 (summaries) → L1 (recent + iron) → L2 (full) loading (`a019b61`)
- Eliminated redundant R2 reads in cron and wake cycles (`624e3d4`)

---

Built by Rook & Falco Schafer at [The Funkatorium](https://funkatorium.org).
