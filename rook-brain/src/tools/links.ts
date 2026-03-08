// ============ LINK TOOLS ============
// mind_link, mind_trace_links, mind_chain, mind_patterns

import type { Link, Observation } from "../types";
import { TERRITORIES, RESONANCE_TYPES, LINK_STRENGTHS } from "../constants";
import {
	getTimestamp,
	generateId,
	extractEssence,
	calculatePullStrength
} from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// LINKS
	{
		name: "mind_link",
		description: "Create a resonance link between two observations.",
		inputSchema: {
			type: "object",
			properties: {
				source_id: { type: "string" },
				target_id: { type: "string" },
				resonance_type: { type: "string", enum: RESONANCE_TYPES },
				strength: { type: "string", enum: LINK_STRENGTHS, default: "present" },
				bidirectional: { type: "boolean", default: true }
			},
			required: ["source_id", "target_id", "resonance_type"]
		}
	},
	{
		name: "mind_trace_links",
		description: "Follow the web of connections from a memory.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				depth: { type: "number", default: 2 }
			},
			required: ["id"]
		}
	},
	{
		name: "mind_chain",
		description: "Follow an associative chain from one observation, finding resonant connections.",
		inputSchema: {
			type: "object",
			properties: {
				start_id: { type: "string" },
				max_depth: { type: "number", default: 5 }
			},
			required: ["start_id"]
		}
	},
	{
		name: "mind_patterns",
		description: "Analyze patterns across all territories - charge distributions, somatic patterns, grip states.",
		inputSchema: {
			type: "object",
			properties: {
				days: { type: "number", default: 7, description: "Analysis period in days" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_link": {
			const link: Link = {
				id: generateId("link"),
				source_id: args.source_id,
				target_id: args.target_id,
				resonance_type: args.resonance_type,
				strength: args.strength || "present",
				origin: "explicit",
				created: getTimestamp(),
				last_activated: getTimestamp()
			};

			await storage.appendLink(link);

			if (args.bidirectional !== false) {
				const reverseLink: Link = {
					...link,
					id: generateId("link"),
					source_id: args.target_id,
					target_id: args.source_id
				};
				await storage.appendLink(reverseLink);
			}

			return { linked: true, type: args.resonance_type, bidirectional: args.bidirectional !== false };
		}

		case "mind_trace_links": {
			// Pre-load all data in parallel for recursive lookups
			const [links, territoryData] = await Promise.all([
				storage.readLinks(),
				storage.readAllTerritories()
			]);

			// Build a lookup map for fast observation finding
			const obsMap = new Map<string, { observation: Observation; territory: string }>();
			for (const { territory, observations } of territoryData) {
				for (const obs of observations) {
					obsMap.set(obs.id, { observation: obs, territory });
				}
			}

			const visited = new Set<string>();
			const chain: any[] = [];

			function trace(id: string, depth: number) {
				if (depth <= 0 || visited.has(id)) return;
				visited.add(id);

				// Find the observation from pre-loaded map
				const found = obsMap.get(id);
				if (found) {
					chain.push({
						id: found.observation.id,
						territory: found.territory,
						essence: extractEssence(found.observation),
						pull: calculatePullStrength(found.observation),
						depth: (args.depth || 2) - depth
					});
				}

				// Find connected links
				const connected = links.filter(l => l.source_id === id);
				for (const link of connected.slice(0, 3)) {
					trace(link.target_id, depth - 1);
				}
			}

			trace(args.id, args.depth || 2);

			return { root: args.id, chain, total_visited: chain.length };
		}

		case "mind_chain": {
			const allObs: any[] = [];
			let startObs: any = null;

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();
			for (const { territory, observations } of territoryData) {
				for (const obs of observations) {
					const withTerritory = { ...obs, territory };
					allObs.push(withTerritory);
					if (obs.id === args.start_id) {
						startObs = withTerritory;
					}
				}
			}

			if (!startObs) {
				return { error: `Observation ${args.start_id} not found` };
			}

			const maxDepth = args.max_depth || 5;
			const chain: any[] = [{
				step: 0,
				id: startObs.id,
				territory: startObs.territory,
				essence: extractEssence(startObs),
				charges: startObs.texture?.charge || [],
				why: "Starting point"
			}];

			const visited = new Set([args.start_id]);
			let current = startObs;

			for (let step = 1; step <= maxDepth; step++) {
				const currentCharges = new Set(current.texture?.charge || []);
				const currentSomatic = current.texture?.somatic;

				// Find resonant observations
				const candidates: any[] = [];
				for (const obs of allObs) {
					if (visited.has(obs.id)) continue;

					let resonance = 0;
					const obsCharges = obs.texture?.charge || [];

					// Charge resonance
					for (const charge of obsCharges) {
						if (currentCharges.has(charge)) resonance += 0.3;
					}

					// Somatic resonance
					if (currentSomatic && obs.texture?.somatic === currentSomatic) {
						resonance += 0.2;
					}

					// Content resonance (shared words)
					const currentWords = new Set(current.content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 4));
					const obsWords = obs.content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 4);
					for (const word of obsWords) {
						if (currentWords.has(word)) resonance += 0.1;
					}

					if (resonance > 0.25) {
						candidates.push({ obs, resonance });
					}
				}

				if (candidates.length === 0) break;

				candidates.sort((a, b) => b.resonance - a.resonance);
				const next = candidates[0].obs;
				visited.add(next.id);
				current = next;

				chain.push({
					step,
					id: next.id,
					territory: next.territory,
					essence: extractEssence(next),
					charges: next.texture?.charge || [],
					why: `Resonance: ${Math.round(candidates[0].resonance * 100)}%`
				});
			}

			return {
				start_id: args.start_id,
				chain,
				depth_achieved: chain.length - 1,
				hint: "Use mind_pull(id) for full content of any node"
			};
		}

		case "mind_patterns": {
			const days = args.days || 7;
			const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

			const territoryCountsMap: Record<string, number> = {};
			const chargeCounts: Record<string, number> = {};
			const somaticCounts: Record<string, number> = {};
			const gripCounts: Record<string, number> = {};
			const chargePairs: Record<string, number> = {};
			let totalObs = 0;
			let recentCount = 0;

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();
			for (const { territory, observations } of territoryData) {
				territoryCountsMap[territory] = observations.length;
				totalObs += observations.length;

				for (const obs of observations) {
					const texture = obs.texture || {};

					// Count charges
					for (const charge of texture.charge || []) {
						chargeCounts[charge] = (chargeCounts[charge] || 0) + 1;
					}

					// Count somatic
					if (texture.somatic) {
						somaticCounts[texture.somatic] = (somaticCounts[texture.somatic] || 0) + 1;
					}

					// Count grip
					const grip = texture.grip || "present";
					gripCounts[grip] = (gripCounts[grip] || 0) + 1;

					// Count recent
					try {
						if (new Date(obs.created).getTime() > cutoff) {
							recentCount++;
						}
					} catch {}

					// Charge pairs
					const charges = texture.charge || [];
					if (charges.length > 1) {
						for (let i = 0; i < charges.length; i++) {
							for (let j = i + 1; j < charges.length; j++) {
								const pair = [charges[i], charges[j]].sort().join("+");
								chargePairs[pair] = (chargePairs[pair] || 0) + 1;
							}
						}
					}
				}
			}

			const links = await storage.readLinks();

			const topCharges = Object.entries(chargeCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([charge, count]) => ({ charge, count }));

			const topSomatic = Object.entries(somaticCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([location, count]) => ({ location, count }));

			const topPairs = Object.entries(chargePairs)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([pair, count]) => ({ pair: pair.split("+"), count }));

			let insight = "";
			if (topCharges.length) {
				insight = `Dominant emotional texture: ${topCharges[0].charge}. `;
				if (topSomatic.length) {
					insight += `Most common somatic location: ${topSomatic[0].location}.`;
				}
			}

			return {
				analysis_period: `Last ${days} days`,
				generated: getTimestamp(),
				summary: {
					total_observations: totalObs,
					total_links: links.length,
					recent_observations: recentCount
				},
				territory_distribution: territoryCountsMap,
				grip_distribution: gripCounts,
				top_charges: topCharges,
				top_somatic: topSomatic,
				charge_clusters: topPairs,
				insight
			};
		}

		default:
			throw new Error(`Unknown link tool: ${name}`);
	}
}
