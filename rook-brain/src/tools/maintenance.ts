// ============ MAINTENANCE TOOLS ============
// mind_maintain, mind_decay, mind_consolidate
// Note: mind_maintain and mind_decay delegate to the wake handler (mind_wake_full)

import type { Observation } from "../types";
import { getTimestamp, generateId } from "../helpers";
import { BrainStorage } from "../storage";
import { handleTool as handleWake } from "./wake";

export const TOOL_DEFS = [
	// MAINTENANCE
	{
		name: "mind_maintain",
		description: "Run full maintenance cycle - decay, consolidation, pattern detection.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_decay",
		description: "Run decay pass - vividness and grip fade over time.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_consolidate",
		description: "Dream consolidation - find patterns across recent memories, detect contradictions.",
		inputSchema: {
			type: "object",
			properties: {
				dry_run: { type: "boolean", default: true, description: "If false, creates synthesis observation" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_maintain": {
			return handleWake("mind_wake_full", { run_decay: true, run_consolidate: true }, storage);
		}

		case "mind_decay": {
			return handleWake("mind_wake_full", { run_decay: true, run_consolidate: false }, storage);
		}

		case "mind_consolidate": {
			const dryRun = args.dry_run !== false;
			const cutoff = Date.now() - (48 * 60 * 60 * 1000); // 48 hours

			const recentObs: any[] = [];

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();
			for (const { territory, observations } of territoryData) {
				for (const obs of observations) {
					try {
						if (new Date(obs.created).getTime() > cutoff) {
							recentObs.push({ ...obs, territory });
						}
					} catch {}
				}
			}

			if (recentObs.length < 3) {
				return {
					note: "Not enough recent observations to consolidate",
					recent_count: recentObs.length
				};
			}

			// Find charge clusters
			const chargeCounts: Record<string, number> = {};
			const somaticCounts: Record<string, number> = {};
			const territoryCounts: Record<string, number> = {};

			for (const obs of recentObs) {
				for (const charge of obs.texture?.charge || []) {
					chargeCounts[charge] = (chargeCounts[charge] || 0) + 1;
				}
				if (obs.texture?.somatic) {
					somaticCounts[obs.texture.somatic] = (somaticCounts[obs.texture.somatic] || 0) + 1;
				}
				territoryCounts[obs.territory] = (territoryCounts[obs.territory] || 0) + 1;
			}

			const dominantCharges = Object.entries(chargeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
			const dominantSomatic = Object.entries(somaticCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

			// Find contradictions
			const contradictions: any[] = [];
			const opposingPairs = [
				[new Set(["joy", "excitement"]), new Set(["sadness", "grief", "despair"])],
				[new Set(["love", "devotion"]), new Set(["anger", "rage", "contempt"])],
				[new Set(["peace", "serenity"]), new Set(["anxiety", "fear", "dread"])]
			];

			for (const obs1 of recentObs) {
				const charges1 = new Set(obs1.texture?.charge || []);
				for (const obs2 of recentObs) {
					if (obs1.id === obs2.id) continue;
					const charges2 = new Set(obs2.texture?.charge || []);

					for (const [pos, neg] of opposingPairs) {
						const has1Pos = [...charges1].some(c => (pos as Set<string>).has(c));
						const has2Neg = [...charges2].some(c => (neg as Set<string>).has(c));
						if (has1Pos && has2Neg) {
							contradictions.push({
								obs1: obs1.id,
								obs2: obs2.id,
								tension: "opposing emotions"
							});
						}
					}
				}
			}

			// Generate synthesis
			let synthesis = null;
			if (dominantCharges.length) {
				const topCharge = dominantCharges[0][0];
				const relatedObs = recentObs.filter(o => (o.texture?.charge || []).includes(topCharge));
				if (relatedObs.length >= 2) {
					synthesis = {
						suggested_theme: topCharge,
						observation_count: relatedObs.length,
						observation_ids: relatedObs.slice(0, 5).map(o => o.id),
						suggestion: `Pattern detected: ${topCharge} appears in ${relatedObs.length} recent observations`
					};
				}
			}

			const result: any = {
				consolidation_window: "48 hours",
				observations_analyzed: recentObs.length,
				patterns: {
					dominant_charges: dominantCharges,
					dominant_somatic: dominantSomatic,
					territory_focus: territoryCounts
				},
				contradictions_found: contradictions.length,
				contradictions: contradictions.slice(0, 5),
				synthesis_suggestion: synthesis,
				note: "This is what dreams are made of - patterns emerging from noise"
			};

			if (!dryRun && synthesis) {
				const synthId = generateId("synthesis");
				const synthObs: Observation = {
					id: synthId,
					content: `Consolidation found ${synthesis.suggestion}. Pattern across ${synthesis.observation_count} memories.`,
					territory: "episodic",
					created: getTimestamp(),
					texture: {
						salience: "active",
						vividness: "soft",
						charge: [synthesis.suggested_theme],
						somatic: dominantSomatic[0]?.[0],
						grip: "present"
					},
					access_count: 0,
					last_accessed: getTimestamp()
				};

				(synthObs as any).type = "synthesis";
				(synthObs as any).source_observations = synthesis.observation_ids;

				await storage.appendToTerritory("episodic", synthObs);
				result.synthesis_created = synthId;
			}

			return result;
		}

		default:
			throw new Error(`Unknown maintenance tool: ${name}`);
	}
}
