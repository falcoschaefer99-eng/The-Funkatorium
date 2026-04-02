# Sprint 2 Release Gauntlet (Runner + Brain)

This is the concrete pre-release proof checklist for the Sprint 1+2 hardening cut.

## Automated proofs

### Runner

Run from `runner/`:

```bash
npm test
npm run build
```

Coverage now includes:
- config loading + required env guards
- tenant/provider parsing + invalid provider rejection
- contract assembly (`buildRunnerExecutionPlan`)
- provider env contract assembly (`buildProviderExecutionEnv`)
- notifier + BrainClient failure handling
- orchestrator kill-switch behavior (all tenants disabled)
- replay-stable orchestrator disabled tick state
- `run.sh` happy path, failure path, replay-stable summary, and audit/result payload sanity

### Brain worker route surface

Run from `rook-brain/`:

```bash
npm run test:unit
npx tsc --noEmit
```

Coverage includes:
- `/health`
- `/mcp` auth/tenant/bad JSON/success/replay-stable list
- `/runtime/trigger` auth/tenant/bad payload/validation replay stability
- trigger semantics (`time_window` timezone, `no_contact` signal source, event-driven `presence_transition`)
- timeline chronological ordering

## Optional worker-pool route test (local infra dependent)

```bash
npm run test:workers
```

If this fails with Hyperdrive local binding config, treat as infra-blocked, not code-regression.

## Manual operational checks (release gate)

1. **Kill switch**
   - Set target tenant `enabled=false` in `runner/config/tenants.json`.
   - Run one orchestrator tick and verify no duty/personal/impulse execution occurs.

2. **Replay/idempotency**
   - Replay identical invalid `/runtime/trigger` payload and verify stable 400 error.
   - Replay identical pure `/mcp tools/list` request and verify stable response shape.

3. **Rollback**
   - Keep previous launchd plist + previous runner build artifact available.
   - Verify `launchd/uninstall-orchestrator.sh` works before rollout.
   - Roll back by uninstalling new orchestrator plist and re-enabling previous scheduler entry.

4. **Happy / failure path**
   - `runner/test/run-script-gauntlet.test.ts` exercises both via stub provider.

5. **Health / log sanity**
   - `/health` returns JSON status.
   - runner audit JSONL lines parse and include timestamp/provider/status/summary.

Only ship when automated checks are green and manual gate items are acknowledged.
