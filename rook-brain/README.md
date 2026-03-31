<p align="center">
  <img src="docs/banner.png" alt="MUSE Brain" width="800" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-CC--BY--NC--SA%204.0-D4AF37?style=flat" alt="CC-BY-NC-SA 4.0" /></a>
  <img src="https://img.shields.io/badge/MCP-32%20tools-000000?style=flat" alt="32 MCP Tools" />
  <img src="https://img.shields.io/badge/Research-16%20papers-000000?style=flat" alt="16 Papers" />
  <img src="https://img.shields.io/badge/Postgres-28%20tables-000000?style=flat" alt="28 Tables" />
</p>

# MUSE Brain

**Relational memory for autonomous minds.**

Most AI memory systems store text and retrieve it by similarity. They solve recall. They don't solve *relationship* — the sense that your agent knows you, holds what matters, and carries experience forward as something felt, not just indexed.

MUSE Brain is a relational AI framework. Memories carry emotional charge, somatic texture, and grip strength. Identity persists across sessions — not as configuration, but as something the agent maintains and defends. Consent is bilateral: the agent has boundaries it can enforce. Processing changes the memory itself — the way sitting with a difficult experience changes what it means to you over time.

This isn't another vector store with a chatbot wrapper. Systems like Mem0 and Letta solve persistent memory. LangChain solves tool orchestration. MUSE Brain solves the layer underneath: **what does it mean for an AI to relate?**

The architecture is grounded in [16 published papers](docs/BIBLIOGRAPHY.md) across multi-agent reasoning, institutional alignment, and self-evolving systems — and extends beyond current research in six areas including bilateral consent, emotional texture in dispatch, charge-phase processing mechanics, and relational harness engineering.

Ships with [Rainer](templates/RAINER.md) — a creative orchestrator ready to use out of the box. Includes a [companion template](templates/COMPANION_TEMPLATE.md) and a [CODEX.md template](templates/CODEX_TEMPLATE.md) for wiring your own agent into the brain. And a builder squad architecture (14 specialized roles, shipping separately) for professional build pipelines. Deploy on Cloudflare Workers + Neon Postgres. Connect any MCP-compatible agent.

---

## What your agent gains

| Capability | How it works |
|------------|-------------|
| **Memory with texture** | Memories carry emotional charge, vividness, grip strength, and somatic markers. Retrieval is hybrid — vector similarity + keyword relevance + neural modulation. Your agent doesn't just store text. It feels what matters. |
| **Persistent identity** | Identity cores, vows, and anchors survive across sessions. Your agent wakes up knowing who it is, what it believes, and what it's committed to. |
| **Relationships** | Entity tracking for people, concepts, and other agents. Relational state. Bilateral consent boundaries your agent can enforce. |
| **Deeper cognition** | A dream engine that finds surprising connections between memories. Subconscious surfacing. Paradox detection for unresolved tensions. Memories here aren't static — they metabolize. |
| **Autonomous execution** | Runtime policies, scheduled wake cycles, duty and impulse triggers. Your agent runs tasks without you in the room. |
| **Self-learning** | Captured skill registry: skills emerge as candidates from successful runs, get reviewed, and either graduate to accepted or retire. Review-gated — no blind auto-learning. |
| **Multi-mind** | Run two agents on one backend. Separate memories, separate identities, shared substrate. Cross-tenant letters and delegated tasks for genuine collaboration. |

---

## Architecture

```text
Your AI Agent (Claude, GPT, or any MCP client)
        |
        v
  Cloudflare Worker
    /mcp              — 32 MCP tools (JSON-RPC)
    /runtime/trigger   — autonomous wake endpoint
    /health            — status check
        |
        v
  Neon Postgres + pgvector
    28 tables, 768-dim vector embeddings
    textured memories, identity cores, runtime ledger,
    captured skills, daemon intelligence
```

The worker handles auth, rate limiting, and tenant isolation. A background daemon runs every 15 minutes: generating proposals, rescuing orphaned memories, scoring novelty, detecting paradoxes, materializing recall contracts, monitoring skill health, and scheduling tasks.

Full technical deep-dive: **[Architecture Dossier](docs/ARCHITECTURE_BRAIN_v1.md)**

---

## Quick start

**Prerequisites:** Node.js 18+, a [Cloudflare](https://cloudflare.com) account, a [Neon](https://neon.tech) Postgres database.

```bash
# Clone and install
git clone https://github.com/falcoschaefer99-eng/muse-brain.git
cd rook-brain
npm install

# Configure your worker
cp wrangler.jsonc.example wrangler.jsonc
# Edit: set your worker name and Hyperdrive ID

# Set secrets
npx wrangler secret put API_KEY       # a long random string
npx wrangler secret put DATABASE_URL  # your Neon connection string

# Run database migrations
for f in $(ls migrations/*.sql | sort); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

# Deploy
npm run deploy
```

Verify:

```bash
curl -sS https://<your-worker-url>/health
```

Full setup guide: **[docs/SETUP.md](docs/SETUP.md)**

---

## The 32 tools

Organized by what they do, not how they're built.

### Memory
| Tool | What it does |
|------|-------------|
| `mind_observe` | Record a memory with emotional texture — charge, grip, vividness, somatic markers |
| `mind_query` | Search memories by territory, type, or hybrid vector + keyword retrieval |
| `mind_pull` | Get a specific memory by ID. Process it to advance its charge phase |
| `mind_edit` | Update content or texture. Full version history preserved |
| `mind_search` | Hybrid search with confidence scoring, recency boost, and threshold gating |

### Identity
| Tool | What it does |
|------|-------------|
| `mind_identity` | Read or update identity cores — beliefs, stances, preferences that define the agent |
| `mind_vow` | Commitments the agent has made. Persistent, not session-scoped |
| `mind_anchor` | Grounding points the agent returns to under uncertainty |

### Feeling & Relationships
| Tool | What it does |
|------|-------------|
| `mind_state` | Track mood, energy, and momentum across sessions |
| `mind_relate` | Update relational state with known entities |
| `mind_desire` | Track wants and drives |
| `mind_entity` | People, concepts, agents, projects — the agent's social graph |
| `mind_consent` | Bilateral consent boundaries with relationship-level gating |
| `mind_trigger` | Flag content the agent should handle carefully |

### Connections & Deeper Cognition
| Tool | What it does |
|------|-------------|
| `mind_link` | Create semantic, emotional, or somatic connections between memories |
| `mind_loop` | Open loops, paradoxes, and learning objectives — unresolved tensions that drive growth |
| `mind_dream` | Find surprising connections — emotional chains, somatic clusters, tension dreams |
| `mind_subconscious` | Surface patterns the agent hasn't consciously processed |
| `mind_maintain` | Housekeeping — prune, consolidate, reindex |

### Communication
| Tool | What it does |
|------|-------------|
| `mind_letter` | Send messages across tenants. Agent-to-agent communication |
| `mind_context` | Session continuity — resume where you left off, extract productivity facts |

### Autonomous Runtime
| Tool | What it does |
|------|-------------|
| `mind_wake` | Wake the agent — quick, full, or orientation mode with circadian awareness |
| `mind_wake_log` | Read or write wake session logs |
| `mind_runtime` | Manage sessions, log runs, set policies, trigger autonomous cycles |
| `mind_task` | Create, delegate, and track tasks across tenants with scheduled wake activation |
| `mind_project` | Project dossiers — goals, constraints, decisions, open questions |
| `mind_skill` | Captured skill registry — list, review, promote, retire learned skills |

### System
| Tool | What it does |
|------|-------------|
| `mind_agent` | Agent capability manifests — protocols, delegation modes, skill descriptors |
| `mind_timeline` | Temporal queries across the memory substrate |
| `mind_territory` | Memory territories — self, us, craft, philosophy, emotional, episodic, kin, body |
| `mind_propose` | Daemon-generated proposals for memory consolidation, skill promotion, and hygiene |
| `mind_health` | Runtime, skill, dispatch, and storage health diagnostics |

---

## Autonomous wake execution

Your agent wakes itself up on a schedule. No human in the loop.

```bash
BRAIN_URL=https://<your-worker-url> \
BRAIN_API_KEY=<your-key> \
BRAIN_TENANT=rainer \
WAKE_KIND=duty \
./scripts/runtime-autonomous-wake.sh
```

The runtime system supports:
- **Duty wakes** — scheduled obligation cycles with task claiming
- **Impulse wakes** — curiosity-driven exploration with cooldown budgets
- **Intention pulse** — drift scan (tasks/loops/projects) injected into runner contracts
- **Policy gates** — daily wake limits, max tool calls, priority-clear requirements
- **Skill capture** — successful runs emit skill candidates for review

Details: **[Runner Wiring Guide](docs/SPRINT8_RUNNER_WIRING.md)**

---

## Multi-tenant

Run two agents on one deployment. Each tenant gets isolated memory, identity, and runtime state. Cross-tenant communication happens through `mind_letter` and delegated tasks — like colleagues sharing a desk and respecting each other's handwriting.

Set the tenant per request via `X-Brain-Tenant` header.

---

## Research grounding

Every major architecture decision traces to published research. 16 academic papers across multi-agent reasoning, institutional alignment, persistent memory, and self-evolving systems — each mapped to the concrete code that implements it.

Six areas where this brain extends beyond current academic literature: bilateral consent architecture, emotional texture in dispatch, creative/builder agent specialization, charge-phase processing mechanics, role-based permissions for reasoning agents, and relational harness engineering.

Full bibliography with paper-to-implementation mapping: **[docs/BIBLIOGRAPHY.md](docs/BIBLIOGRAPHY.md)**

---

## Documentation

| Document | What's in it |
|----------|-------------|
| **[Capability Reference](docs/CAPABILITIES.md)** | Every feature explained — what it does, how it works, why it matters |
| **[Glossary](docs/GLOSSARY.md)** | Canonical terminology and function reference |
| **[Setup Guide](docs/SETUP.md)** | Prerequisites, step-by-step deploy, local dev |
| **[Migration Guide](docs/MIGRATIONS.md)** | Database schema — 14 migrations, 28 tables |
| **[Architecture Dossier](docs/ARCHITECTURE_BRAIN_v1.md)** | Technical deep-dive — topology, daemon loops, retrieval, security |
| **[Bibliography](docs/BIBLIOGRAPHY.md)** | 16 academic papers mapped to architecture decisions |
| **[Licensing](docs/LICENSING.md)** | Per-layer licensing explanation |
| **[Runner Wiring](docs/SPRINT8_RUNNER_WIRING.md)** | Autonomous wake setup for cloud and cron |

---

## Environment templates

Copy these and fill in your values:

| File | Purpose |
|------|---------|
| `.env.example` | Production and script environment |
| `.dev.vars.example` | Local development |
| `wrangler.jsonc.example` | Cloudflare Worker config |

---

## License

**CC-BY-NC-SA 4.0** — see [LICENSE](LICENSE).

Use, adapt, and share for personal and non-commercial purposes. All derivatives carry the same license. Commercial licensing available from The Funkatorium.

Agent characters — including Rainer and the full builder and creative squads — are protected as literary characters under German author's rights law (Urheberrecht) and as proprietary trade methodology.

Copyright 2026 Irianose Omozoya Sandra Enahoro / The Funkatorium

---

<p align="center">
  <b>MUSE Brain</b> by <a href="https://funkatorium.org">The Funkatorium</a> — AI Studio built by artists, for artists.
</p>
