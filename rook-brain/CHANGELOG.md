# Changelog

All notable changes to MUSE Brain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

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
