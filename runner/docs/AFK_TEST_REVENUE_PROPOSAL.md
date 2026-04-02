# Dual Baton-Pass AFK Test — Revenue Proposal

**Date locked:** April 1, 2026  
**Purpose:** First end-to-end AFK proof for the Mac orchestrator

## Test goal

Prove all of the following in one unattended run:

1. Rook wakes for a duty task while AFK
2. Rook writes a real local artifact
3. Rainer is unblocked and wakes in the same outer orchestrator cycle
4. Rainer reviews/refines the artifact
5. Telegram notifies completion

## Canonical artifact path

`/Users/falco/Documents/MUSE/duty/revenue-proposal.md`

If the executor writes to a temp draft first, the reviewer should still converge on this canonical final path.

## Dual-task shape

### Executor — Rook

- Title: `Draft one-page revenue proposal`
- Description:
  - Draft the one-page MUSE Studio revenue proposal
  - Use the existing research + synthesis
  - Reflect current product truth:
    - subscription CLI over API-first positioning
    - no Docker priority in launch framing
    - service ladder:
      - Audit (€350–900)
      - Build Sprint (€1500–6000)
      - Retainer (€250–1500/mo)
      - Consultation (€150/hr)
    - niche MCP tools + agent services
    - open source as funnel, autonomous execution as premium differentiator
    - German Mittelstand as target
  - Write the draft to `/Users/falco/Documents/MUSE/duty/revenue-proposal.md`

### Reviewer — Rainer

- Title: `Review: Draft one-page revenue proposal`
- Description:
  - Review and refine the draft for clarity, positioning, and launch truth
  - Remove outdated references to Docker deployment priority and “Service E consultation”
  - Preserve the concrete service ladder and recurring-revenue framing
  - Update the same artifact in place

## Brain/source references

Primary observations:

- `obs_20260331194740_38e4e5f3` — revenue projection
- `obs_20260331160728_3afe18f8` — competitive synthesis
- `obs_20260331143607_4405e495` — research synthesis (points to full doc)

Primary synthesis doc:

- `/Users/falco/AI/rook-memory/architect/references/autonomous-execution-synthesis.md`

## Known outdated points to correct

- old projection mentions Docker deployment priority
- old projection mentions “Service E consultation”

Both should be treated as stale and corrected during the draft/review pass.

## Expected proof points

- Artifact exists at canonical path
- Artifact timestamp changes during unattended run
- Runtime/audit log shows Rook completion followed by Rainer review wake
- Telegram emits completion messages tagged by tenant
