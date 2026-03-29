# Sprint 8 Handover Checkpoint — 2026-03-29

## What was completed in this pass

1. **TypeScript baseline unblocked**
   - `src/storage/postgres.ts`
   - Fixed current postgres.js typing friction around transaction callbacks (`TransactionSql` no-call-signature issue in this codebase context).
   - Fixed consent JSON serialization typing path in `writeConsent`.
   - Result: `npx tsc --noEmit` is now clean.

2. **Runtime runner + policy consistency tightened**
   - `scripts/runtime-autonomous-wake.sh`
     - Added `EMIT_SKILL_CANDIDATE` env support (default `true` for duty, `false` for impulse), forwarded to `/runtime/trigger`.
   - `src/tools-v2/runtime.ts`
     - Runner contract prompt now embeds policy budget instructions:
       - `max_tool_calls_per_run`
       - `max_parallel_delegations`
       - `execution_mode`

3. **Tests/docs/changelog updated**
   - `test/runtime-v2.spec.ts` adds assertion coverage for budget-aware prompt content.
   - `docs/SPRINT8_AUTONOMOUS_EXECUTION.md` checklist clarified (`S8.0` checked) + local verification snapshot added.
   - `docs/SPRINT8_RUNNER_WIRING.md` notes budget-aware runner prompt behavior.
   - `CHANGELOG.md` updated to reflect green TypeScript baseline and new runtime-budget/runner wiring behavior.

## Verification run (local)

- `npx tsc --noEmit` ✅
- `npx vitest -c vitest.unit.config.mts test/runtime-v2.spec.ts test/tasks-v2.spec.ts` ✅ (26/26)
- `bash -n scripts/runtime-autonomous-wake.sh` ✅

## Sprint 8 status now

- ✅ S8.0 truth map complete
- 🚧 S8.1 cloud runner wiring: code/docs ready, **live cloud proof run pending**
- ✅ S8.2 session continuity
- ✅ S8.3 trigger bridge
- 🚧 S8.4 cross-agent autonomous delegation: substrate path landed, **external autonomous proof loop pending**
- ✅ S8.5 candidate skill capture stub
- 🚧 S8.6 end-to-end proof run pending (final gate)

## Rook review checkpoint (recommended now)

Please review now before cloud proof execution with focus on:
1. `src/storage/postgres.ts` typing workaround approach (`sql: any` in transaction callbacks) and whether to keep or refactor to a stricter alias.
2. `src/tools-v2/runtime.ts` budget-aware prompt language and whether to enforce harder caps at runner level later.
3. `scripts/runtime-autonomous-wake.sh` runtime option parity (`EMIT_SKILL_CANDIDATE`) and schedule defaults.

After review approval, run S8.6 proof:
- configure one duty `/schedule` wake
- create delegated task Rook -> Rainer
- verify autonomous claim/execute/complete + handoff signal + runtime diagnostics + skill candidate artifact.
