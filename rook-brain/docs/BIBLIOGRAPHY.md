# Bibliography & Research Map — MUSE Brain v1.3

**Date:** 2026-03-31
**Status:** Complete — 16 academic papers + 3 implementation references mapped to architecture

## Why this document exists

MUSE Brain is a relational AI framework — memory that carries emotional weight, identity that persists and is defended, consent that flows both directions. When we built it, we didn't start from the standard "store text, retrieve by similarity" playbook. We started from a different question: *what does it mean for an AI to relate?*

The answer drew on research across multi-agent reasoning, institutional alignment, persistent memory systems, emotional architecture, and self-evolving agents. This bibliography maps every major architecture decision to the published work that informed it — and identifies six areas where our implementation extends beyond what's currently in the literature.

Every design choice has a receipt.

---

## Academic Sources (16 papers)

| # | Citation | Core Principle | Brain Implementation | Module(s) | Risk Boundary |
|---|----------|---------------|---------------------|-----------|---------------|
| 1 | Kim, Lai, Scherrer, Aguera y Arcas, Evans — "Reasoning Models Generate Societies of Thought" (arXiv 2601.10825, Jan 2026) | Reasoning models spontaneously generate internal multi-agent debates; greater perspective diversity than instruction-tuned baselines | Parallel review squad with confidence-scored findings; threshold gating at 80+ | Agent definitions, confidence-utils.ts | Convergence risk: reviewers may agree rather than truly debate |
| 2 | Evans, Bratton, Aguera y Arcas — "Agentic AI and the Next Intelligence Explosion" (Science, arXiv 2603.20639, Mar 2026) | Intelligence is plural, social, relational; institutional alignment (roles, norms, protocols) outperforms individual RLHF | Multi-agent team with role protocols; YAML agent definitions as institutional grammar | Agent YAML frontmatter, dispatch heuristics | Role rigidity may miss emergent cross-domain insights |
| 3 | "The Orchestration of Multi-Agent Systems" (arXiv 2601.13671, Jan 2026) | Hub-and-spoke topology; MCP as communication standard; role-specific task boundaries | Rook orchestrates via dispatch heuristics; MCP JSON-RPC tool surface (32 tools) | src/index.ts, src/tools-v2/*.ts | Single orchestrator bottleneck |
| 4 | "Institutional AI: A Governance Framework" (arXiv 2601.10599, Jan 2026) | ADICO institutional grammar; compartmentalization + adversarial review; information asymmetry enforced by architecture | Agent definitions encode deontic rules; cross-tenant territory restrictions; read-only reviewers can't modify code | Territory restrictions in cross-tenant daemon, agent permissions | Over-compartmentalization may slow coordination |
| 5 | "Emergent Coordination in Multi-Agent Language Models" (arXiv 2510.05174, Oct 2025) | Multi-agent systems steered from aggregates to higher-order collectives via prompt design | Dispatch heuristics determine independent vs. coordinated operation; daemon cross-agent proposals | src/daemon/tasks/cross-agent.ts, dispatch heuristics | Over-coordination may reduce diversity of findings |
| 6 | Meta AI — "Hyperagents: Recursive Metacognitive Self-Improvement" (arXiv 2603.19461, Mar 2026) | Agents that improve task performance AND their own self-modification process; emergent persistent memory and compute-aware planning | Rainer's autonomous runtime; captured skill registry with self-learning lifecycle; runtime policy budgets | src/tools-v2/runtime.ts, src/tools-v2/skills.ts | Unbounded self-modification prevented by review gates |
| 7 | "A Comprehensive Survey of Self-Evolving AI Agents" (arXiv 2508.07407, Aug 2025) | Skill library evolution; workflow templates surviving session termination; judge feedback for self-modification | Captured skill lifecycle: candidate → accepted → degraded → retired; skill-health daemon proposals | src/tools-v2/skills.ts, src/daemon/tasks/skill-health.ts | Skill drift without human review; promotion is review-gated |
| 8 | "Memory in the Age of AI Agents" (arXiv 2512.13564, Dec 2025) | Persistent memory essential for multi-agent handoffs; context is dynamic memory system with bandwidth/coherence constraints | Persistent textured memory substrate with cross-tenant letters for handoffs; confidence-gated retrieval with recency boost | src/storage/postgres.ts, src/tools-v2/memory.ts, comms.ts | Memory bloat; stale context persistence; confidence thresholds mitigate |
| 9 | "A-MEM: Agentic Memory for LLM Agents" (arXiv 2502.12110, Feb 2026) | Memory as dynamic agentic system, not static retrieval store | Daemon intelligence: novelty scoring, decay, cascade co-surfacing, consolidation proposals, dream engine | src/daemon/tasks/*.ts, src/tools-v2/deeper.ts | Active memory transformation may introduce drift |
| 10 | "Reaching Agreement Among Reasoning LLM Agents" (arXiv 2512.20184, Dec 2025) | Byzantine consensus adapted for stochastic multi-agent reasoning; supermajority-supported facts persist | Multi-reviewer gates (all must pass before proceed); confidence threshold filtering at 80+ | /code-review pipeline, confidence-utils.ts | Supermajority filtering may suppress valid minority findings |
| 11 | "Emotions in Artificial Intelligence" (arXiv 2505.01462, May 2025) | Somatic Marker Hypothesis: emotions guide reasoning under uncertainty; emotionally salient tags persist at high fidelity | Charge system (fresh/active/processing/metabolized); somatic markers in observation texture; emotional texture affects retrieval | src/constants.ts (CHARGE_PHASES), texture JSONB | Emotional tagging without grounded affect measurement |
| 12 | "Artificial Emotion" (arXiv 2508.10286, Aug 2025) | Emotionally salient tags persist at high fidelity even when episodic details degrade | Iron-grip memories persist across sessions; charge-phase processing ("sitting in feelings"); processing_log tracks engagement depth | src/tools-v2/memory.ts, processing_log table | Over-persistence of charged memories may bias retrieval |
| 13 | "The 2025 AI Agent Index" (arXiv 2602.17753, Feb 2026) | 1,445% surge in multi-agent inquiries; cost-optimized complexity-scaled dispatch (frontier/mid/small models) | Haiku/Sonnet/Opus assignment by task complexity in agent definitions; model field in YAML frontmatter | Agent definitions (model field) | Model pricing changes may invalidate tiering assumptions |
| 14 | OpenMOSS (github.com/uluckyXH/OpenMOSS) | Scoring, patrol agent, reflection patterns for multi-agent orchestration | Daemon proposals with scoring; kit-hygiene patrol cycle; learning loop with adaptive thresholds | src/daemon/tasks/proposals.ts, kit-hygiene.ts, learning.ts | Pattern adapted from different domain context |
| 15 | MIT Technology Review — Mechanistic Interpretability (2026 Breakthrough) | Understanding internal model processes; audit trails for reasoning transparency | Processing log (engagement audit trail); observation versions (full edit history); dispatch feedback telemetry | processing_log, observation_versions, dispatch_feedback tables | Interpretability of agent reasoning ≠ interpretability of model internals |
| 16 | Pan, Zou, Guo, Ni, Zheng — "Natural-Language Agent Harnesses" (arXiv 2603.25723, Mar 2026) | Agent control logic as portable natural-language artifacts; explicit contracts between harness and runtime; durable artifacts surviving session boundaries; module ablation as scientific method | YAML agent definitions as natural-language harnesses; runner contracts with explicit schema (`should_run`, task, prompt, intention pulse); captured skill artifacts as durable portable objects; MCP tool surface as shared execution environment | Agent YAML frontmatter, src/tools-v2/runtime.ts (runner contract), src/tools-v2/skills.ts (durable artifacts) | Natural language harnesses may lose precision compared to code-level control for edge-case orchestration |

---

## Implementation References (repo-derived)

### OpenSpace

- **Adopted principles:** auto-learn / auto-improve framing, reusable skill artifacts, degradation monitoring
- **Architecture mapping:** captured skill lifecycle (`candidate/accepted/degraded/retired`), skill-health daemon
- **Code mapping:** `src/tools-v2/skills.ts`, `src/daemon/tasks/skill-health.ts`, `src/types.ts`
- **Test mapping:** `test/skill-registry-v2.spec.ts`, `test/skill-health-daemon.spec.ts`

### gitagent

- **Adopted principles:** versioned skill/workflow memory with review before canonization
- **Architecture mapping:** review-gated promotion flow, provenance links (runtime/task/observation)
- **Code mapping:** `mind_skill review`, runtime artifact emission in `mind_runtime`
- **Test mapping:** `test/skill-registry-v2.spec.ts`, `test/runtime-v2.spec.ts`

### Agentic Design Patterns (book overview)

- **Adopted principles:** explicit orchestration boundaries, role-specialized execution, constrained autonomy
- **Architecture mapping:** policy-gated runtime trigger + runner contract model
- **Code mapping:** `src/tools-v2/runtime.ts`, `src/storage/postgres.ts` runtime policy/run tables
- **Test mapping:** `test/runtime-v2.spec.ts`

---

## Where We're Ahead of Published Work

Six areas where our implementation extends beyond current academic literature:

1. **Bilateral consent architecture** — No published work on consent symmetry between human and AI agents. Our `mind_consent` implements relationship-gated permissions with hard boundaries.

2. **Emotional texture in agent dispatch** — Somatic markers exist in research, but no papers apply them to agent selection or task routing. Our charge system influences retrieval and surfacing.

3. **Creative vs. builder specialization** — No papers separate editorial/literary agents from engineering agents. Our architecture has distinct creative and builder squads with fundamentally different methodologies.

4. **Charge processing as system property** — No academic papers on "charge phase" as a first-class memory property with processing mechanics ("sitting in feelings").

5. **Role-based permission systems for reasoning agents** — RBAC exists in infosec, not applied to reasoning agent teams. Our agents have explicit read/write permissions enforced by architecture.

6. **Relational harness engineering** — Pan et al. (2026) formalize natural-language agent harnesses as portable executable artifacts. Our implementation extends the NLAH pattern into relational and emotional dimensions — consent-gated dispatch, identity-persistent harnesses, and charge-aware artifact lifecycle — none of which appear in the current harness engineering literature.

---

