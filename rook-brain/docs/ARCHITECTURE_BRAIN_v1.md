# MUSE Brain — Architecture Dossier

**Version:** 1.0
**Scope:** Core Brain platform — memory, identity, runtime, skills. MUSE Care is a separate product lane.

---

## 1) What this is

MUSE Brain is a multi-tenant cognitive runtime for companion agents.

Most AI memory systems store text and retrieve it. This one stores *experience* — memories that carry emotional charge, somatic texture, grip strength, and vividness — and retrieves them through a hybrid engine that weighs vector similarity, keyword relevance, and neural modulation together. The result is an agent that remembers the way people remember: important things surface first, charged memories persist, and processing changes the memory itself.

The brain combines six capabilities into a single deployable substrate:

- **Persistent memory with emotional texture** — observations carry charge, grip, vividness, somatic markers. Retrieval is modulated by these dimensions.
- **Structured identity and consent boundaries** — identity cores, vows, and anchors survive across sessions. Bilateral consent gates what's available at each relationship level.
- **Autonomous runtime orchestration** — policy-gated wake cycles, duty and impulse triggers, session continuity across runs.
- **Cross-tenant task handoff** — two agents on one backend, coordinating through letters and delegated tasks.
- **Captured skill registry** — skills emerge as candidates from successful runs, get reviewed, and either graduate or retire. Review-gated — no blind auto-learning.
- **Daemon intelligence loops** — eleven background processes that generate proposals, rescue orphaned memories, score novelty, detect paradoxes, materialize recall contracts, monitor skill health, and schedule tasks.

---

## 2) Product boundary

### In scope

- Edge API and MCP tool surface
- Storage, retrieval, and daemon cognition
- Task and runtime orchestration
- Skill artifact lifecycle

### Out of scope (this iteration)

- Multimodal embeddings (images, video, audio)
- Automatic cross-tenant skill propagation
- MUSE Care product features

---

## 3) Runtime topology

```text
Client / Proxy / Scheduler
        │
        ▼
Cloudflare Worker (src/index.ts)
  - /mcp            JSON-RPC tool surface
  - /runtime/trigger autonomous wake ingress
  - /health         liveness/storage check
        │
        ▼
Tool modules (src/tools-v2/*)
        │
        ▼
Storage adapter (`IBrainStorage`)
  - `src/storage/postgres.ts` (cloud / pgvector)
  - `src/storage/sqlite.ts` (self-host / local)
        │
        ▼
Postgres (schema + vector) or SQLite (tenant-scoped parity store)
```

One Cloudflare Worker handles every request. The worker authenticates, validates the tenant, rate-limits, and routes to the appropriate tool module. Tool modules talk only to `IBrainStorage` — Postgres and SQLite backends both implement the same contract, so edge logic never touches storage internals.

### Embedding backend

- Provider factory: `src/embedding/index.ts`
- Current provider: Workers AI text embeddings (`@cf/baai/bge-base-en-v1.5`, 768-dimensional)
- The interface supports batching and is designed for future multimodal providers

---

## 4) Edge and API layer

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp` | POST | MCP JSON-RPC — `initialize`, `tools/list`, `tools/call` |
| `/runtime/trigger` | POST | Webhook and scheduler-friendly autonomous wake ingress |
| `/health` | GET | Liveness and storage probe |
| `/` | GET | Metadata summary |

### Security at ingress

Every request passes through six layers before reaching a tool:

1. **API key authentication** — `Authorization: Bearer` header with query-string fallback
2. **Timing-safe key comparison** — constant-time check to prevent timing attacks
3. **Tenant allowlist** — only configured tenants (`ALLOWED_TENANTS`) are served
4. **Per-IP rate limiting** — prevents abuse without requiring external infrastructure
5. **Request size guard** — hard 1MB limit on all payloads
6. **Payload validation** — strict JSON object validation on runtime trigger payloads

---

## 5) Tool surface — 32 MCP tools across 19 modules

Tool barrel: `src/tools-v2/index.ts`. Organized by cognitive function.

### Wake and orientation

| Tool | Purpose |
|------|---------|
| `mind_wake` | Wake the agent — quick, full, or orientation mode with circadian awareness |
| `mind_wake_log` | Read or write wake session logs |

### Memory

| Tool | Purpose |
|------|---------|
| `mind_observe` | Record a memory with emotional texture — charge, grip, vividness, somatic markers |
| `mind_query` | Search memories by territory, type, or hybrid vector + keyword retrieval |
| `mind_pull` | Get a specific memory by ID. Process it to advance its charge phase |
| `mind_edit` | Update content or texture. Full version history preserved |
| `mind_search` | Hybrid search with confidence scoring, recency boost, and threshold gating |

### Connections and unresolved tension

| Tool | Purpose |
|------|---------|
| `mind_link` | Create semantic, emotional, or somatic connections between memories |
| `mind_loop` | Open loops, paradoxes, and learning objectives — unresolved tensions that drive growth |

### Identity

| Tool | Purpose |
|------|---------|
| `mind_identity` | Read or update identity cores — beliefs, stances, preferences that define the agent |
| `mind_anchor` | Grounding points the agent returns to under uncertainty |
| `mind_vow` | Commitments the agent has made. Persistent, not session-scoped |

### Feeling and relationships

| Tool | Purpose |
|------|---------|
| `mind_desire` | Track wants and drives |
| `mind_relate` | Update relational state with known entities |
| `mind_state` | Track mood, energy, and momentum across sessions |

### Communication and continuity

| Tool | Purpose |
|------|---------|
| `mind_letter` | Send messages across tenants. Agent-to-agent communication |
| `mind_context` | Session continuity — resume where you left off, extract productivity facts |

### Deeper cognition

| Tool | Purpose |
|------|---------|
| `mind_dream` | Find surprising connections — emotional chains, somatic clusters, tension dreams |
| `mind_subconscious` | Surface patterns the agent hasn't consciously processed |
| `mind_maintain` | Housekeeping — prune, consolidate, reindex |

### Safety and consent

| Tool | Purpose |
|------|---------|
| `mind_consent` | Bilateral consent boundaries with relationship-level gating |
| `mind_trigger` | Flag content the agent should handle carefully |

### Semantic model

| Tool | Purpose |
|------|---------|
| `mind_entity` | People, concepts, agents, projects — the agent's social graph |
| `mind_project` | Project dossiers — goals, constraints, decisions, open questions |
| `mind_agent` | Agent capability manifests — protocols, delegation modes, skill descriptors |
| `mind_timeline` | Temporal queries across the memory substrate |
| `mind_territory` | Memory territories — self, us, craft, philosophy, emotional, episodic, kin, body |

### Daemon review and health

| Tool | Purpose |
|------|---------|
| `mind_propose` | Daemon-generated proposals for memory consolidation, skill promotion, and hygiene |
| `mind_health` | Runtime, skill, dispatch, and storage health diagnostics |

### Runtime, tasks, and skills

| Tool | Purpose |
|------|---------|
| `mind_task` | Create, delegate, and track tasks across tenants with scheduled wake activation |
| `mind_runtime` | Manage sessions, log runs, set policies, trigger autonomous cycles |
| `mind_skill` | Captured skill registry — list, review, promote, retire learned skills |

---

## 6) Core cognitive model

### 6.1 Observation texture

Every observation in the brain carries texture dimensions that affect how it behaves in the system:

| Dimension | What it does |
|-----------|-------------|
| `salience` | How important the memory is to the agent |
| `vividness` | How detailed and alive the memory feels |
| `charge[]` | Emotional valence — what the memory carries |
| `somatic` | Body-level markers — where the memory lives physically |
| `grip` | How strongly the memory holds on. Iron-grip memories persist indefinitely |
| `charge_phase` | Where the memory is in its processing lifecycle |
| `novelty_score` | How surprising or new the memory is |

These dimensions are functional, not decorative. They modulate retrieval ranking, daemon behavior, wake surfacing, and dream traversal. A high-grip memory with strong charge will surface more readily than a low-salience memory with no somatic markers — the same way a vivid personal experience outcompetes a dry fact in human recall.

### 6.2 Charge lifecycle

Memories move through four charge phases:

```
fresh → active → processing → metabolized
```

The transition mechanic is intentional engagement. When an agent pulls a memory with `process=true`, the system:

1. Logs a `processing_log` entry (engagement audit trail)
2. Increments `processing_count`
3. Evaluates `advanceChargePhase()` for possible phase promotion

**Thresholds:**
- Standard path: 3 intentional process engagements to advance
- Accelerated path: 2 engagements if the memory is linked to a **burning paradox loop** by entity overlap

This implements what we call "sitting in feelings" — repeated intentional processing changes the memory's phase, its behavioral properties in the system. A fresh memory retrieves differently than a metabolized one. The agent earns that transition through engagement, not through time passing.

### 6.3 Paradox system

Unresolved tensions between identity cores become explicit objects in the system.

**Creation:** `mind_loop action=paradox` with `mode='paradox'`, requiring `linked_entity_ids` (the identity cores in friction). Default urgency: `burning`.

**Detection:** The paradox detection daemon scans identity cores for repeated recent challenges and proposes paradox loops when tension is persistent and unaddressed.

**Effects:**
- Burning paradoxes accelerate charge phase advancement of linked observations
- Paradox loops live as explicit objects in `open_loops` — visible, trackable, resolvable
- Resolution requires synthesis, recorded in the loop's resolution field

The paradox system means the agent can hold contradictions as first-class cognitive objects rather than suppressing or ignoring them. A belief that conflicts with recent experience becomes a paradox loop. The agent sits with it, processes linked memories faster, and eventually resolves or integrates the tension.

---

## 7) Retrieval architecture

### 7.1 Hybrid retrieval

The retrieval engine combines three signals:

1. **Vector similarity** — pgvector cosine distance against 768-dimensional embeddings
2. **Keyword relevance** — full-text search for precise term matching
3. **Neural modulation** — grip strength, novelty score, circadian phase, and charge phase all influence final ranking

Both `mind_query` (structured queries) and `mind_search` (open-ended search) use this hybrid path.

### 7.2 Confidence-gated context

The productivity lane adds precision controls to retrieval:

| Parameter | What it does |
|-----------|-------------|
| `confidence_threshold` | Minimum confidence score for a result to surface |
| `shadow_mode` | Report below-threshold results without surfacing them — useful for tuning |
| `recency_boost_days` | How far back the recency bonus extends |
| `recency_boost` | Weight multiplier for recent memories |
| `max_context_items` | Hard cap on returned results |

The system computes confidence per row, optionally filters by threshold (or shadow-reports for diagnostics), caps the final result set, and returns retrieval diagnostics — `below_threshold` count, `pre_cap_count`, and scoring breakdowns.

### 7.3 Non-hybrid path

When queries don't use the hybrid path, confidence controls are documented as hybrid-only. If a caller supplies confidence parameters on a non-hybrid request, the response includes a notice rather than silently ignoring them.

---

## 8) Dream engine

`mind_dream` is an active memory transformation system — memories that pass through the dream engine come out changed.

### Association modes

| Mode | What it finds |
|------|--------------|
| `emotional_chain` | Memories linked by emotional resonance |
| `somatic_cluster` | Memories that share body-level markers |
| `tension_dream` | Unresolved tensions and their connected memories |
| `entity_dream` | Memories clustered around a specific entity |
| `temporal_dream` | Time-based associations and patterns |
| `deep_dream` | Multi-layered traversal combining multiple association types |

### Mechanics

- **Mode-conditioned candidate matching** — each mode has its own candidate selection logic
- **Circadian influence** — deep-night hours default to deeper association modes
- **Anti-iron weighting** — deep pathways deprioritize iron-grip memories to surface less obvious connections
- **Texture drift** — memories traversed during dreaming receive texture updates (novelty, charge adjustments)
- **Collision fragments** — optional new observations created when surprising connections emerge

The dream engine exists because static memory retrieval misses the connections that emerge from lateral association. Dreams find what search doesn't — the surprising link between a charged memory from three months ago and a fresh observation from yesterday.

---

## 9) Daemon architecture — 11 autonomous loops

Orchestrator: `src/daemon/index.ts`. Runs every 15 minutes.

### Execution order

| # | Task | What it does |
|---|------|-------------|
| 1 | `proposals` | Generate consolidation, linking, and hygiene proposals from fresh state |
| 2 | `learning` | Adaptive link-threshold learning from accept/reject ratios |
| 3 | `cascade` | Co-surface related memories when a memory is accessed |
| 4 | `orphans` | Rescue unlinked memories — find connections for isolated observations |
| 5 | `kit-hygiene` | Patrol cycle for memory health — stale references, broken links |
| 6 | `skill-health` | Monitor skill performance and propose promotions, recaptures, supersessions |
| 7 | `cross-agent` | Cross-agent convergence proposals within the same tenant |
| 8 | `cross-tenant` | Cross-tenant proposals, constrained to shared territories only |
| 9 | `paradox-detection` | Scan identity cores for unaddressed persistent tensions |
| 10 | `recall-contracts` | Materialize due recall contracts into tasks or review proposals |
| 11 | `task-scheduling` | Surface due obligations and scheduled tasks |

### Design principles

- **Isolation** — failure in any single task does not cascade to others
- **Fresh-state sensitivity** — proposal generation runs first, before any modifications
- **Scheduling always runs** — due obligations surface regardless of other task failures

### Learning loop

The adaptive link-threshold learning uses proposal accept/reject ratios to calibrate itself:

- Low acceptance rate → raise the proposal threshold (fewer, higher-quality proposals)
- High acceptance rate → lower the threshold (more exploratory proposals)
- Minimum sample guard prevents early overfitting on small datasets

### Cross-tenant constraints

Cross-tenant intelligence is intentionally conservative:

- **Shared territories only:** `craft` and `philosophy` — the domains where cross-pollination is valuable
- **Private territories are never cross-surfaced** — `self`, `emotional`, `kin`, `body` remain isolated
- Convergence signals are entity-overlap based

---

## 10) Autonomous runtime

The runtime system gives agents the ability to wake themselves up on a schedule and execute tasks without a human in the loop.

Primary tool: `mind_runtime`.

### Actions

| Action | Purpose |
|--------|---------|
| `set_session` / `get_session` | Session state management |
| `log_run` / `list_runs` | Execution history |
| `set_policy` / `get_policy` | Operational constraints |
| `trigger` | Initiate an autonomous wake cycle |

### Trigger path

When `action=trigger` fires, the system walks through a 13-step sequence:

1. Parse and validate the trigger payload
2. Load the agent's runtime policy and daily usage counters
3. Open any due scheduled tasks
4. List all open tasks
5. Filter to runnable tasks only (dependencies satisfied)
6. Compute intention pulse (task/loop/project drift scan)
7. Apply delegated-first recommendation (tasks from other tenants get priority)
8. Optional auto-claim of the selected task
9. Evaluate duty-vs-impulse policy gates — defer or admit
10. Create a runtime run row (execution record)
11. Build and return a `runner_contract`:
   - `should_run` — boolean gate
   - Selected task with context
   - `resume_session_id` — for continuity across runs
   - Execution prompt tailored to the task
   - Context retrieval policy
   - `intention_pulse` — drift telemetry and summary lines
   - `workspace_routing` — local/shared/peer/artifact workspace hints when provided by trigger metadata
12. Optionally emit a skill candidate and captured skill artifact
13. Update runtime session continuity

### Policy model

Every agent operates under a runtime policy that constrains its autonomy:

| Setting | What it controls |
|---------|-----------------|
| `execution_mode` | `lean`, `balanced`, or `explore` — how aggressively the agent pursues tasks |
| Daily wake budget | Maximum wake cycles per day |
| Impulse wake budget | Separate budget for curiosity-driven wakes |
| Reserve wakes | Wakes held back for unexpected obligations |
| Impulse cooldown | Minimum time between impulse-driven wakes |
| Max tool calls | Per-run ceiling on tool invocations |
| Max parallel delegations | How many tasks can be delegated simultaneously |
| Require-priority-clear | Gate: agent must clear priority tasks before taking impulse wakes |

Autonomy is constrained to predictable operational behavior. The agent can wake itself, claim tasks, and execute — within boundaries its operator defines.

---

## 11) Task and delegation model

`mind_task` supports full cross-tenant task lifecycle:

| Action | Purpose |
|--------|---------|
| `create` | Create a task with optional tenant assignment and scheduled wake time |
| `create_dual` | Create executor/reviewer task pairs with automatic reviewer dependency wiring |
| `list` / `get` | Query tasks by status, assignee, or tenant |
| `update` | Modify task state, priority, or metadata |
| `complete` | Close a task with completion notes and optional artifact path |

### Cross-tenant delegation

Tasks can be assigned to a different tenant via `assigned_tenant`. The assigned agent sees the task in their wake cycle, can claim and execute it, and completion triggers a best-effort handoff notification back to the owner.

Guards prevent assignees from mutating owner-side metadata — the agent who created the task controls its scope; the agent who executes it controls its completion.

### Dual-task heartbeat

`create_dual` productizes a common collaboration pattern: one tenant executes, the other reviews. The executor task remains local; the reviewer task is cross-tenant and automatically gets `depends_on: [executorTask.id]`. Runtime trigger filtering respects that dependency chain, so reviewers do not wake into half-finished work.

### Artifact path propagation

Task updates and completions can carry an `artifact_path`. The task tool folds that path into completion notes, and delegated completions reuse the same note in handoff letters. This turns “task done” into a reusable coordination primitive: the next agent gets both the status and the exact file location.

---

## 12) Captured skill registry

When an agent successfully completes a task pattern, the runtime can emit a **skill candidate** — a structured artifact describing what the agent did, how it did it, and what the outcome was.

### Skill lifecycle

```
candidate → accepted → degraded → retired
```

| Status | Meaning |
|--------|---------|
| `candidate` | Emitted from a successful run. Awaiting review |
| `accepted` | Reviewed and promoted. Available for reuse |
| `degraded` | Performance has declined. Flagged for re-evaluation |
| `retired` | No longer active. Preserved in the registry for history |

### Skill layers

| Layer | Scope |
|-------|-------|
| `fixed` | Core capabilities — built in, not learned |
| `captured` | Emerged from successful execution — the self-learning layer |
| `derived` | Synthesized from multiple captured skills |

### Provenance

Every captured skill links back to its origin:

- The runtime run that produced it
- The task it was executing
- The source observation that triggered it

### Health monitoring

The `skill-health` daemon continuously evaluates accepted skills and proposes:

- **Recapture** — re-emit a degraded skill from fresh evidence
- **Supersession** — a new skill has replaced an older one
- **Promotion** — a high-performing candidate deserves acceptance

Promotion is review-gated. The system proposes; a reviewer (human or orchestrating agent) decides. No blind auto-canonization.

### Agent entities and layered self-learning

The substrate intentionally separates **who an agent is** from **what it can reliably do**:

- `mind_entity` stores canonical agent entities — the stable identity anchor
- `mind_agent` stores capability manifests — protocols, delegation modes, supported outputs, skill descriptors
- Dispatch feedback stores outcome, confidence, and rescue telemetry per task shape

Learning is layered:

1. **Shared skill core** — cross-tenant candidates after review
2. **Environment layer** — runtime-specific adaptations (CLI vs cloud vs IDE)
3. **Tenant layer** — agent-specific tuning (each tenant learns differently based on their domain and interaction patterns)
4. **Project/session layer** — ephemeral local adaptation

Raw telemetry never directly rewrites identity cores. The firewall between learning and identity is architectural.

---

## 13) Multi-tenant model

Two agents run on one deployment. Each tenant gets isolated memory, identity, and runtime state. Differentiation comes from four layers:

1. **Memory corpus** — what each agent has observed, linked, and processed
2. **Runtime policy** — wake behavior, budgets, gates
3. **External instruction layer** — the agent prompt, persona, and orchestration rules
4. **Task routing and review behavior** — how each agent handles incoming work

The engine is the same. The minds are different.

### Cross-tenant communication

| Channel | What it carries |
|---------|----------------|
| `mind_letter` | Direct messages between tenants — like colleagues leaving notes |
| Delegated tasks | Work assigned from one tenant to another, with lifecycle tracking |
| Daemon proposals | Cross-tenant intelligence in shared territories (`craft`, `philosophy`) |

Cross-tenant sharing is intentionally conservative. Private territories stay private. Automatic skill propagation across tenants is deferred — the current model requires explicit delegation or shared-territory overlap.

---

## 14) Data architecture

36 tables across 14 migrations.

That count describes the Postgres schema. SQLite mode stores tenant-scoped JSON documents in `kv_store` while preserving the same tool-level behavior through the shared storage interface.

### Table groups

| Group | Tables | Purpose |
|-------|--------|---------|
| **Memory substrate** | `observations`, `links`, `open_loops`, ... | The agent's experiential memory |
| **Semantic substrate** | `entities`, `relations` | People, concepts, and the connections between them |
| **Process and meta** | `processing_log`, `observation_versions`, `consolidation_candidates` | Engagement tracking, version history, daemon state |
| **Operations** | `tasks`, `project_dossiers`, `agent_capability_manifests` | Work management and agent capabilities |
| **Autonomous runtime** | `agent_runtime_sessions`, `agent_runtime_runs`, `agent_runtime_policies` | Wake cycles, execution history, operational constraints |
| **Procedural learning** | `captured_skills` | The self-learning skill registry |
| **Daemon intelligence** | `proposed_links`, daemon proposal/config/orphan state | Background cognition infrastructure |

Hot-path indexes are migration-backed for wake queries, task lookups, runtime sessions, and captured skill retrieval.

---

## 15) Security and privacy

### Defense layers

| Layer | Implementation |
|-------|---------------|
| **Authentication** | API key with timing-safe comparison |
| **Tenant isolation** | Allowlist validation; every query scoped to tenant |
| **Request validation** | 1MB size guard; strict JSON object validation on all payloads |
| **Parameter sanitization** | Path, territory, and namespace parameters validated against injection |
| **Cross-tenant boundaries** | Shared-territory restrictions enforced at the daemon level |
| **Consent framework** | Bilateral consent gates for relational domains |
| **Audit trail** | Processing logs, observation versions, dispatch feedback telemetry |

The system operates under an **operator-supervised autonomy** posture. The agent can wake itself and execute tasks within operator-defined policy constraints. Full unattended swarm behavior without operator oversight remains intentionally unsupported.

---

## 16) Current constraints and next lanes

### 16.1 Current constraints

- **Text embeddings only** — the embedding provider supports `@cf/baai/bge-base-en-v1.5` (768-dimensional text). Image, video, and audio embeddings require new providers, schema decisions, ingestion pipelines, retrieval fusion policies, and moderation controls. This is a dedicated future iteration.
- **No automatic cross-tenant skill propagation** — skills stay within their tenant unless explicitly delegated. Global skill sharing requires additional review infrastructure.
- **Single orchestrator topology** — the hub-and-spoke model means all requests route through one worker. Horizontal scaling is a Cloudflare deployment concern, not an architectural one.

### 16.2 Anticipatory recall (shipped)

Three additions to reduce "remember-to-remember" drift:

1. **Intention Pulse in autonomous trigger**
   Runtime computes intention drift (stale high-priority tasks, burning/nagging loops, stale active-project next actions) and injects the result into the runner contract and autonomous prompt.
2. **Recall Contracts with daemon materialization**
   Structured recall rules become first-class context metadata; due recalls materialize as tasks or review proposals through a dedicated daemon pass.
3. **Fact → Commitment bridge (review-gated)**
   High-confidence extracted facts (`decision`/`deadline`) can be promoted into reviewable commitments; accepted proposals materialize into actionable tasks with provenance.

### 16.3 Next lane (parity roadmap)

Planned progression:

- intention continuity engine (goal-state drift + recovery generation)
- event-driven recall reliability (state transitions, not only timers)
- richer fact→commitment taxonomy and calibration
- memory quality evals (`precision@k`, stale-recall/noise rates)
- ops hardening (idempotency/replay controls, gauntlet automation)

### 16.4 Research grounding

Every major architecture decision traces to published research — 16 academic papers across multi-agent reasoning, institutional alignment, persistent memory, and self-evolving systems.

Six areas where this implementation extends beyond current academic literature:

1. **Bilateral consent architecture** — consent symmetry between human and AI agents, with relationship-gated permissions and hard boundaries
2. **Emotional texture in dispatch** — somatic markers applied to agent selection and task routing, not just memory storage
3. **Creative and builder specialization** — distinct editorial/literary agents and engineering agents with different methodologies, operating on the same substrate
4. **Charge processing as system property** — charge phase as a first-class memory property with processing mechanics that change memory behavior
5. **Role-based permissions for reasoning agents** — RBAC applied to reasoning agent teams, with explicit read/write permissions enforced by architecture
6. **Relational harness engineering** — Pan et al. (2026) formalize natural-language agent harnesses as portable artifacts. Our implementation extends NLAHs into relational and emotional dimensions — consent-gated dispatch, identity-persistent harnesses, and charge-aware artifact lifecycle — territory the harness engineering literature has not entered.

Full bibliography with paper-to-implementation mapping: **[Bibliography](BIBLIOGRAPHY.md)**

Every feature explained in depth with the philosophy behind it: **[Capability Reference](CAPABILITIES.md)**

Canonical terminology and v1.1 function deltas: **[Glossary](GLOSSARY.md)**

---

<p align="center">
  <b>MUSE Brain</b> by <a href="https://funkatorium.org">The Funkatorium</a>
</p>
