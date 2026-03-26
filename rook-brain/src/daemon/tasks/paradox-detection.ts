// ============ DAEMON TASK: PARADOX DETECTION ============
// v1 simplified approach: detect identity cores that have been challenged
// repeatedly without a paradox loop existing.
//
// If a core was challenged 3+ times in the last 30 days and no paradox
// open_loop (mode='paradox') exists linked to it, propose a paradox loop.
//
// This is intentionally conservative — false positives (proposing a paradox
// that isn't real) are less harmful than missing genuine tension.

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const CHALLENGE_THRESHOLD = 3;
const LOOKBACK_DAYS = 30;

export async function runParadoxDetectionTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let proposals_created = 0;

	// Get all identity cores
	const cores = await storage.readIdentityCores();
	if (cores.length === 0) {
		return { task: "paradox-detection", changes: 0, proposals_created: 0 };
	}

	const cutoffDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

	// Get existing paradox open_loops to check if one already covers a given core
	const allLoops = await storage.readOpenLoops();
	const paradoxLoops = allLoops.filter(loop => loop.mode === "paradox");

	for (const core of cores) {
		// Count recent challenges (challenges in last 30 days)
		const recentChallenges = (core.challenges ?? []).filter(c => c.date >= cutoffDate);
		if (recentChallenges.length < CHALLENGE_THRESHOLD) continue;

		// Check if a paradox loop already exists linked to this core
		const alreadyHasParadox = paradoxLoops.some(loop =>
			loop.linked_entity_ids?.includes(core.id)
		);
		if (alreadyHasParadox) continue;

		// Check if a paradox_detected proposal already exists for this core
		const proposalExists = await storage.proposalExists("paradox_detected", core.id, core.id);
		if (proposalExists) continue;

		await storage.createProposal({
			tenant_id: storage.getTenant(),
			proposal_type: "paradox_detected",
			source_id: core.id,
			target_id: core.id,
			confidence: Math.min(0.5 + recentChallenges.length * 0.1, 0.95),
			rationale: `Identity core "${core.name}" was challenged ${recentChallenges.length} times in the last ${LOOKBACK_DAYS} days — paradox loop may be needed`,
			metadata: {
				core_id: core.id,
				core_name: core.name,
				challenge_count: recentChallenges.length,
				recent_challenges: recentChallenges.slice(0, 3).map(c => ({
					description: c.description,
					date: c.date
				}))
			},
			status: "pending"
		});
		proposals_created++;
	}

	return { task: "paradox-detection", changes: 0, proposals_created };
}
