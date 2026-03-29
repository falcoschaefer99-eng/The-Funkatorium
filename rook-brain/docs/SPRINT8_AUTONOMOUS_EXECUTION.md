# Sprint 8 — Autonomous Execution Layer (Canonical)

**Date locked:** 2026-03-28
**Status:** in progress
**Purpose:** close the gap between a capable brain substrate and real autonomous cloud execution.

---

## Why this sprint exists

We shipped a strong substrate (tools, daemons, tasks, wake, calibration), but the core intended behavior is still missing:

- autonomous cloud wake/execute cycles
- self-scheduling agents
- event-driven wake triggers
- independent cross-agent execution loops

This sprint is the bridge from **memory substrate** to **autonomous orchestrator**.

---

## Inputs (research anchors)

- `reference_claude_cloud_autonomous.md`
  - `/schedule` cloud scheduler
  - headless `claude -p`
  - session resume semantics
- `reference_openclaw.md`
  - self-managed cron pattern (agent-owned scheduling)
  - lane-safe orchestration model
- `reference_hermes_agent.md`
  - skill capture from successful runs
  - evolution loop as later extension

---

## Truth map (built vs missing)

### Built now

- `mind_task` with scheduling/delegation/completion
- wake + task surfacing
- daemon cron + maintenance intelligence
- cross-tenant letters + completion notifications
- dispatch telemetry foundations

### Missing now (Sprint 8 target)

- cloud runner trigger path into autonomous headless execution
- persistent session continuity ledger for autonomous runs
- event-driven trigger bridge (not cron-only)
- independent cross-agent execution lifecycle (Rook delegates, Rainer wakes and completes autonomously)
- candidate skill artifact emission from successful autonomous runs

### Not Sprint 8 (explicitly deferred)

- full GEPA/evolution optimization loop
- automatic unreviewed skill promotion
- full taste-map/liminal architecture

---

## Sprint 8 checklist

- [x] **S8.0 Truth map complete** (this document + architecture alignment)
- [ ] **S8.1 Cloud runner wiring** (`/schedule` + `claude -p` pathway; script+docs landed via `scripts/runtime-autonomous-wake.sh` and `docs/SPRINT8_RUNNER_WIRING.md`, live cloud proof run pending)
- [x] **S8.2 Session continuity** (store/resume `session_id` in brain substrate)
- [x] **S8.3 Trigger bridge** (daemon/webhook/event trigger path via `/runtime/trigger` + `mind_runtime action=trigger`)
- [ ] **S8.4 Cross-agent autonomous delegation** (Rook -> Rainer independent execution; delegated task auto-claim landed in trigger path, external runner execution loop still pending)
- [x] **S8.5 Candidate skill capture stub** (successful admitted trigger runs can emit `skill_candidate` artifacts in craft territory)
- [ ] **S8.6 End-to-end proof run** (no laptop-interactive dependency)

### Sprint 8 operating policy (added 2026-03-28)

### Local verification snapshot (2026-03-29)

- `npx tsc --noEmit` passes.
- `npx vitest -c vitest.unit.config.mts test/tasks-v2.spec.ts test/runtime-v2.spec.ts` passes (26/26).
- `bash -n scripts/runtime-autonomous-wake.sh` passes.
- Live cloud proof run remains the final S8.6 gate.


- Duty wakes are always first-class.
- Impulse wakes remain allowed, but are policy-gated (budget, reserve wakes, cooldown, priority-clear checks).
- Execution profiles (`lean` / `balanced` / `explore`) are now persisted per tenant+agent runtime.
- Runtime diagnostics now include policy + usage counters (today-window) to tune token/cost behavior empirically.
- Duty trigger can now auto-claim a delegated open task (`status -> in_progress`) so assignee runners can execute one concrete handoff item per wake.
- Trigger now resolves session continuity from stored runtime session state when `session_id` is omitted, and returns a runner contract (`task + prompt + resume_session_id`) for headless execution.
- Successful admitted trigger runs can emit background `skill_candidate` observation artifacts as reviewable skill-hypothesis stubs (`type=skill_candidate`).

---

## Exit criteria (must all pass)

1. A due task can trigger autonomous cloud execution without manual chat prompting.
2. The run persists `session_id`, and the next wake resumes that session.
3. Rook can delegate a task to Rainer; Rainer executes independently and notifies back.
4. At least one successful autonomous run emits a candidate skill artifact for review.
5. All of the above are visible in health/status diagnostics.

---

## After Sprint 8

- **Sprint 9:** Captured Skill Registry (full Phase 2B)
- **Sprint 10:** Skill degradation + reviewed propagation
- **Sprint 11:** Liminal + taste map + contradiction/revision ledger

This file is the canonical source for sprint naming and scope for this cycle.
