# Sprint 8 — Runner Wiring (Cloud + Headless)

**Date:** 2026-03-29  
**Status:** active

This is the execution bridge for `S8.1`/`S8.4`:

1. wake trigger (`POST /runtime/trigger`)
2. policy gate + delegated-first task selection/claim
3. headless `claude -p` execution
4. task completion + cross-tenant handoff letter via existing `mind_task complete`

---

## 1) Script entrypoint

Use:

`scripts/runtime-autonomous-wake.sh`

It:
- calls `/runtime/trigger`
- reads `runner_contract` (`task`, `prompt`, `resume_session_id`)
- prompt now includes runtime policy budget hints (`max_tool_calls_per_run`, `max_parallel_delegations`, mode)
- runs Claude headless with that prompt

Required env:
- `BRAIN_URL`
- `BRAIN_API_KEY`
- `BRAIN_TENANT` (`rook` or `rainer`)

Useful options:
- `WAKE_KIND=duty|impulse`
- `AUTO_CLAIM_TASK=true|false`
- `EMIT_SKILL_CANDIDATE=true|false`
- `ENFORCE_POLICY=true|false`
- `SESSION_ID=<explicit override>` (optional)

---

## 2) /schedule wiring (Anthropic cloud)

Example duty wake every 30 minutes:

```bash
claude /schedule "*/30 * * * *" \
"cd /path/to/rook-brain && BRAIN_URL=https://rook.funkatorium.org BRAIN_API_KEY=*** BRAIN_TENANT=rainer WAKE_KIND=duty ./scripts/runtime-autonomous-wake.sh"
```

Example impulse wake every 2 hours:

```bash
claude /schedule "0 */2 * * *" \
"cd /path/to/rook-brain && BRAIN_URL=https://rook.funkatorium.org BRAIN_API_KEY=*** BRAIN_TENANT=rainer WAKE_KIND=impulse AUTO_CLAIM_TASK=false ./scripts/runtime-autonomous-wake.sh"
```

---

## 3) VPS/local cron fallback

```cron
*/30 * * * * cd /path/to/rook-brain && BRAIN_URL=https://rook.funkatorium.org BRAIN_API_KEY=*** BRAIN_TENANT=rainer WAKE_KIND=duty ./scripts/runtime-autonomous-wake.sh >> /tmp/rainer-duty.log 2>&1
0 */2 * * * cd /path/to/rook-brain && BRAIN_URL=https://rook.funkatorium.org BRAIN_API_KEY=*** BRAIN_TENANT=rainer WAKE_KIND=impulse AUTO_CLAIM_TASK=false ./scripts/runtime-autonomous-wake.sh >> /tmp/rainer-impulse.log 2>&1
```

---

## 4) Cross-agent autonomous delegation path

Current substrate behavior:
- Rook creates/delegates tasks to `assigned_tenant=rainer`
- Rainer duty trigger prefers delegated open tasks
- `auto_claim_task=true` sets selected delegated task to `in_progress`
- Headless run executes and calls `mind_task complete`
- completion sends best-effort handoff letter back to assigning tenant

This gives independent handoff execution without interactive chat loops.

---

## 5) Lean vs burn-mode

Policy is set via `mind_runtime action=set_policy`.

- Lean default for constrained budgets
- Balanced for normal operation
- Explore / custom (10–20 wakes/day) for high-burn systems

`/runtime/trigger` uses persisted policy + day-window usage counters to gate impulse wakes while preserving duty wakes.

High-burn custom policy example:

```json
{
  "action": "set_policy",
  "execution_mode": "explore",
  "daily_wake_budget": 20,
  "impulse_wake_budget": 12,
  "reserve_wakes": 2,
  "min_impulse_interval_minutes": 20,
  "max_tool_calls_per_run": 40,
  "max_parallel_delegations": 2,
  "require_priority_clear_for_impulse": false
}
```
