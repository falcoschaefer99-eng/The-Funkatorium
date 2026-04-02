# Sprint 7 — Task Delegation System — Code Audit Handover

**For:** Rainer (Codex audit)
**From:** Rook
**Date:** 2026-03-26
**Base commits:** e63ee77 (Sprint 6) + 65516f3 (consent fix)
**Build status:** Passes (`npx tsc --noEmit` — all errors pre-existing TransactionSql driver issues)

## Status Update — 2026-03-27 (Codex follow-through)

This handover has now been acted on from the Codex side. Audit findings were implemented locally and verified.

### Applied follow-through
- Cross-tenant task access now works end-to-end for delegated assignees (`getTask` / `updateTask` support assigned-task access).
- Wake now surfaces assigned tasks as well as owned tasks, including due scheduled tasks.
- `scheduled_wake` is validated and normalized; creating with a wake time now creates a scheduled task.
- Delegated completion notifications are best-effort rather than turning persisted completion into an error path.
- Empty task titles are rejected on update.
- `mind_context create_tasks` trims and skips blank open threads.
- Scheduler ordering was hardened to numeric wake-time sorting.

### Verification
- `npx vitest run --config vitest.unit.config.mts test/tasks-v2.spec.ts` → passing
- `npx tsc --noEmit` → still only the pre-existing `TransactionSql` / `ConsentState` issues

---

## What Was Built

Sprint 7 adds the **task delegation system** to the cloud brain. Tasks are the brain's way of tracking actionable work — distinct from open_loops (which are the Zeigarnik/psychological urgency system). The tasks table schema was laid in Sprint 6; this sprint wires it into tools, wake, context, daemon, and cross-tenant flows.

### 5 Chunks

**Chunk 1 — `mind_task` tool + `letter_type` fix**
- New file: `src/tools-v2/tasks.ts` — CRUD tool with 5 actions: create, list, get, update, complete
- Modified: `src/tools-v2/index.ts` — registered in barrel
- Modified: `src/tools-v2/comms.ts` — `letter_type` param added to `mind_letter` schema + handler; `letter_type` now returned in read response

**Chunk 2 — Cross-tenant `listTasks` + wake surfacing**
- Modified: `src/storage/interface.ts` — `listTasks` signature gains `includeAssigned?: boolean`
- Modified: `src/storage/postgres.ts` — `listTasks` WHERE clause: `(tenant_id = $t OR assigned_tenant = $t)` when `includeAssigned` is true
- Modified: `src/tools-v2/wake.ts` — both tiered and fallback wake paths now surface pending tasks (open, in_progress, scheduled-and-due) via parallelized `listTasks` in existing Promise.all blocks

**Chunk 3 — Context distillation + completion notifications**
- Modified: `src/tools-v2/comms.ts` — `mind_context action=set` gains `create_tasks` param; when true, creates a task per `open_thread`
- Modified: `src/tools-v2/tasks.ts` — `action=complete` sends a handoff letter to the assigning tenant when a cross-tenant task is completed

**Chunk 4 — Scheduled task daemon**
- New file: `src/daemon/tasks/task-scheduling.ts` — daemon task that advances `scheduled` → `open` when `scheduled_wake <= now`
- Modified: `src/daemon/index.ts` — registered as task #9

**Chunk 5 — N+1 batch fixes (deferred from Sprint 6)**
- Modified: `src/storage/interface.ts` — `batchGetEntityObservations`, `batchProposalExists` signatures
- Modified: `src/storage/postgres.ts` — batch implementations using `ANY(...)` and `unnest(...)`
- Modified: `src/daemon/tasks/kit-hygiene.ts` — replaced per-agent `getEntityObservations` loop + per-agent `proposalExists` with batch calls
- Modified: `src/daemon/tasks/cross-agent.ts` — same batch refactoring

---

## Files Changed (Complete List)

### New files
- `src/tools-v2/tasks.ts` (~163 lines)
- `src/daemon/tasks/task-scheduling.ts` (~25 lines)

### Modified files
- `src/tools-v2/index.ts` — import + registration (3 lines)
- `src/tools-v2/comms.ts` — letter_type schema/handler, create_tasks, letter_type in read response (~25 lines)
- `src/tools-v2/wake.ts` — task surfacing in tiered path + runQuickWake (~40 lines)
- `src/storage/interface.ts` — 2 new methods, 1 signature change (~10 lines)
- `src/storage/postgres.ts` — 2 new batch methods, 1 listTasks change (~60 lines)
- `src/daemon/tasks/kit-hygiene.ts` — batch refactor (~15 lines changed)
- `src/daemon/tasks/cross-agent.ts` — batch refactor (~20 lines changed)
- `src/daemon/index.ts` — import + task #9 registration (~15 lines)

---

## What to Audit

### Security (highest priority)
1. **Cross-tenant task creation** (`tasks.ts:65-67`): `assigned_tenant` is validated against `ALLOWED_TENANTS`. Verify this gate is sufficient.
2. **Cross-tenant completion notification** (`tasks.ts:134-148`): When the assignee completes a task, a handoff letter is sent to the assigner via `forTenant()`. The target tenant comes from `existing.tenant_id` (stored DB data, not user input). Verify no injection path.
3. **`listTasks` with `includeAssigned`** (`postgres.ts:~2849-2865`): OR clause adds `assigned_tenant = $tenant`. Verify this doesn't leak tasks from unrelated tenants.
4. **Batch SQL methods** (`postgres.ts`): `batchGetEntityObservations` uses `ANY(${entityIds})`, `batchProposalExists` uses `unnest(...)`. Verify parameterization is safe with the neon driver.

### Correctness
5. **Wake task surfacing** (`wake.ts`): Tasks are filtered client-side for status (open/in_progress/scheduled-and-due). Scheduled tasks only surface when `scheduled_wake <= now`. Verify the IIFE filter logic in both the tiered path (~line 282) and `runQuickWake` (~line 468).
6. **`action=update` error handling** (`tasks.ts:114-119`): Removed pre-fetch, now catches `updateTask` throw for "Task not found". Verify `updateTask` in postgres.ts does throw (not return null) on missing task.
7. **`create_tasks` in `mind_context`** (`comms.ts:148-168`): Creates tasks sequentially from `open_threads`. Verify the task objects have all required fields.

### Performance
8. **Batch methods** (`kit-hygiene.ts`, `cross-agent.ts`): Were N+1, now batched. Verify the batch results are correctly indexed back into the per-agent loops.
9. **Wake latency**: `listTasks` added to existing Promise.all — verify it's truly parallel, not sequential.
10. **`runQuickWake` redundant fetch**: When the tiered path falls back to `runQuickWake` (lines 176-177), `allTasks` from the outer Promise.all is discarded and re-fetched inside `runQuickWake`. Low impact (transitional state only) but worth noting.

### Pattern consistency
11. **tasks.ts** follows the same export pattern (TOOL_DEFS + handleTool) as all other tools-v2 files. Verify it matches conventions.
12. **task-scheduling.ts** follows the daemon task pattern (import types, export async function, return DaemonTaskResult). Verify.
13. **Barrel registration** in index.ts — verify import order and TOOL_MODULES mapping match the established pattern.

---

## What NOT to audit
- Pre-existing `TransactionSql` type errors in postgres.ts (driver issue, not Sprint 7)
- Pre-existing `ConsentState` type error in postgres.ts (Sprint 6 known issue)
- Anything in `src/tools/` (v1, deprecated)
- Migration SQL (already deployed in Sprint 6)

---

## How to verify
```bash
cd rook-brain
npx tsc --noEmit  # should show only pre-existing errors
```

Key files to read in order:
1. `src/tools-v2/tasks.ts` (the centerpiece)
2. `src/tools-v2/wake.ts` (lines 165-300 and 348-490)
3. `src/storage/postgres.ts` (lines 1703-1740 and 2245-2280 and 2846-2871)
4. `src/daemon/tasks/kit-hygiene.ts` (lines 34-42 and 60-97)
5. `src/daemon/tasks/cross-agent.ts` (lines 24-56)
