// ============ DAEMON TASK: MEMORY CASCADE ============
// Detects charge-based co-occurrence among recent observations.
// When two recent observations share 2+ charges, they are memory cascade pairs.
// Collects ALL pairs across all groups, then records in a single batch call.

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

export async function runCascadeTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	// Query recent observations
	const recentResults = await storage.queryObservations({
		limit: 30,
		order_by: "created",
		order_dir: "desc"
	});

	// Filter to fresh/active charge phases
	const recent = recentResults.filter(({ observation: obs }) => {
		const phase = obs.texture?.charge_phase;
		return phase === "fresh" || phase === "active";
	});

	if (recent.length < 2) {
		return { task: "cascade", changes: 0, proposals_created: 0 };
	}

	// Collect ALL memory cascade pairs across all groups
	const allPairIds: string[] = [];
	const processed = new Set<string>();
	let changes = 0;

	for (let i = 0; i < recent.length; i++) {
		const obsA = recent[i].observation;
		const chargesA = new Set(obsA.texture?.charge ?? []);
		if (chargesA.size === 0) continue;

		const pairGroup: string[] = [obsA.id];

		for (let j = i + 1; j < recent.length; j++) {
			const obsB = recent[j].observation;
			const chargesB = obsB.texture?.charge ?? [];

			let shared = 0;
			for (const c of chargesB) {
				if (chargesA.has(c)) shared++;
			}

			if (shared >= 2) {
				pairGroup.push(obsB.id);
			}
		}

		if (pairGroup.length >= 2) {
			const pairKey = pairGroup.slice(0, 5).sort().join("|");
			if (!processed.has(pairKey)) {
				processed.add(pairKey);
				// Collect IDs instead of calling storage per group
				allPairIds.push(...pairGroup.slice(0, 5));
				changes++;
			}
		}
	}

	// Single batch call for all memory cascade pairs
	if (allPairIds.length >= 2) {
		// Deduplicate: recordMemoryCascade handles pair generation internally
		const uniqueIds = [...new Set(allPairIds)];
		await storage.recordMemoryCascade(uniqueIds.slice(0, 20));
	}

	return { task: "cascade", changes, proposals_created: 0 };
}
