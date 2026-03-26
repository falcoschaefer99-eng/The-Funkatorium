// ============ DAEMON TASK: KIT HYGIENE ============
// Kit's cleanup cycle runs per agent entity.
// For each agent: counts observations by charge_phase, proposes consolidation
// when metabolized or total counts are high, and proposes dedup for near-duplicate
// observations (vector similarity > 0.92).

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const METABOLIZED_THRESHOLD = 20;
const TOTAL_THRESHOLD = 50;
const DEDUP_SIMILARITY = 0.92;
const CONSOLIDATION_LOOKBACK_DAYS = 30;

export async function runKitHygieneTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let proposals_created = 0;

	// Get all agent entities for this tenant
	const agentEntities = await storage.listEntities({ entity_type: "agent", limit: 200 });

	if (agentEntities.length === 0) {
		return { task: "kit-hygiene", changes: 0, proposals_created: 0 };
	}

	const cutoffDate = new Date(Date.now() - CONSOLIDATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

	// Hoist listProposals — avoids one DB call per agent hitting the total threshold.
	// Only track source_ids with accepted consolidations within the lookback window.
	const recentConsolidations = await storage.listProposals("consolidation", "accepted", 200);
	const consolidatedSourceIds = new Set(
		recentConsolidations.filter(p => p.proposed_at >= cutoffDate).map(p => p.source_id)
	);

	// Global cap on findSimilarUnlinked calls — 200 agents × 30 obs would blow the 1000 subrequest limit
	let vectorQueriesRemaining = 30;

	for (const agent of agentEntities) {
		// Get this agent's observations
		const entityObs = await storage.getEntityObservations(agent.id, 200);

		if (entityObs.length === 0) continue;

		const observations = entityObs.map(r => r.observation);

		// Count by charge_phase
		let metabolizedCount = 0;
		let totalCount = observations.length;
		for (const obs of observations) {
			if (obs.texture?.charge_phase === "metabolized") metabolizedCount++;
		}

		// (a) High metabolized count → propose archival consolidation
		if (metabolizedCount > METABOLIZED_THRESHOLD) {
			const exists = await storage.proposalExists("consolidation", agent.id, agent.id);
			if (!exists) {
				await storage.createProposal({
					tenant_id: storage.getTenant(),
					proposal_type: "consolidation",
					source_id: agent.id,
					target_id: agent.id,
					confidence: 0.85,
					rationale: `Agent ${agent.name} has ${metabolizedCount} metabolized observations ready for archival`,
					metadata: { agent_id: agent.id, agent_name: agent.name, metabolized_count: metabolizedCount },
					status: "pending"
				});
				proposals_created++;
			}
		}
		// (b) High total count without recent consolidation → propose consolidation
		else if (totalCount > TOTAL_THRESHOLD) {
			// Use pre-fetched consolidation set — avoids a DB call per agent
			const hasRecentConsolidation = consolidatedSourceIds.has(agent.id);

			if (!hasRecentConsolidation) {
				const exists = await storage.proposalExists("consolidation", agent.id, agent.id);
				if (!exists) {
					await storage.createProposal({
						tenant_id: storage.getTenant(),
						proposal_type: "consolidation",
						source_id: agent.id,
						target_id: agent.id,
						confidence: 0.75,
						rationale: `Agent ${agent.name} has ${totalCount} total observations, needs consolidation`,
						metadata: { agent_id: agent.id, agent_name: agent.name, total_count: totalCount },
						status: "pending"
					});
					proposals_created++;
				}
			}
		}

		// (c) Dedup check — look for near-duplicate observations among this agent's obs
		// Compare pairs using findSimilarUnlinked on each observation and check similarity > 0.92
		// Only scan non-metabolized observations to keep the N² manageable
		const scannable = observations.filter(o => o.texture?.charge_phase !== "metabolized").slice(0, 30);

		const dupPairsFound = new Set<string>();

		for (const obs of scannable) {
			if (vectorQueriesRemaining <= 0) break;
			const similar = await storage.findSimilarUnlinked(obs.id, 5);
			vectorQueriesRemaining--;

			for (const candidate of similar) {
				if (candidate.similarity < DEDUP_SIMILARITY) continue;

				// Only flag pairs within this agent's observation set
				const candidateIsAgentObs = observations.some(o => o.id === candidate.observation.id);
				if (!candidateIsAgentObs) continue;

				// Canonical pair key (sorted) to avoid double-proposing
				const pairKey = [obs.id, candidate.observation.id].sort().join("|");
				if (dupPairsFound.has(pairKey)) continue;
				dupPairsFound.add(pairKey);

				const exists = await storage.proposalExists("dedup", obs.id, candidate.observation.id);
				if (!exists) {
					await storage.createProposal({
						tenant_id: storage.getTenant(),
						proposal_type: "dedup",
						source_id: obs.id,
						target_id: candidate.observation.id,
						similarity: candidate.similarity,
						confidence: candidate.similarity,
						rationale: `Two observations by agent ${agent.name} are near-duplicates (similarity ${Math.round(candidate.similarity * 100)}%)`,
						metadata: { agent_id: agent.id, agent_name: agent.name },
						status: "pending"
					});
					proposals_created++;
				}
			}
		}
	}

	return { task: "kit-hygiene", changes: 0, proposals_created };
}
