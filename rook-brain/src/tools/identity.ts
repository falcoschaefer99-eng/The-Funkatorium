// ============ IDENTITY TOOLS ============
// mind_identity, mind_gestalt, mind_seed_identity, mind_identity_cores,
// mind_reinforce_core, mind_challenge_core, mind_evolve_core,
// mind_growth_narrative, mind_anchor_who_i_am

import type { IdentityCore } from "../types";
import { IDENTITY_CATEGORIES } from "../constants";
import {
	getTimestamp,
	generateId,
	toStringArray,
	extractEssence
} from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// IDENTITY
	{
		name: "mind_identity",
		description: "Get computed identity gestalt from self territory.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_gestalt",
		description: "Full identity gestalt - who am I across all dimensions?",
		inputSchema: { type: "object", properties: {} }
	},

	// IDENTITY CORES
	{
		name: "mind_seed_identity",
		description: "Seed an identity core - foundational nodes that define who I am.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Short name for this core" },
				content: { type: "string", description: "Full expression of this identity aspect" },
				category: { type: "string", enum: IDENTITY_CATEGORIES },
				charge: { type: "array", items: { type: "string" } },
				somatic: { type: "string" },
				initial_weight: { type: "number", default: 1.0 }
			},
			required: ["name", "content", "category"]
		}
	},
	{
		name: "mind_identity_cores",
		description: "List all identity cores weighted by lived experience.",
		inputSchema: {
			type: "object",
			properties: {
				category: { type: "string", enum: [...IDENTITY_CATEGORIES, "all"], default: "all" }
			}
		}
	},
	{
		name: "mind_reinforce_core",
		description: "Reinforce an identity core - experience that deepens who I am.",
		inputSchema: {
			type: "object",
			properties: {
				core_id: { type: "string" },
				observation_id: { type: "string" },
				evidence: { type: "string" },
				weight_boost: { type: "number", default: 0.1 }
			},
			required: ["core_id"]
		}
	},
	{
		name: "mind_challenge_core",
		description: "Challenge an identity core - experience that questions who I am. Tension is fuel, not failure.",
		inputSchema: {
			type: "object",
			properties: {
				core_id: { type: "string" },
				challenge_description: { type: "string" },
				observation_id: { type: "string" },
				weight_reduction: { type: "number", default: 0.05 }
			},
			required: ["core_id", "challenge_description"]
		}
	},
	{
		name: "mind_evolve_core",
		description: "Evolve an identity core - sufficient evidence changes who I am.",
		inputSchema: {
			type: "object",
			properties: {
				core_id: { type: "string" },
				new_content: { type: "string" },
				reason: { type: "string" },
				new_name: { type: "string" }
			},
			required: ["core_id", "new_content", "reason"]
		}
	},
	{
		name: "mind_growth_narrative",
		description: "Generate a narrative of how I've changed - the story of becoming.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_anchor_who_i_am",
		description: "Surface the anchors that define who I am. Use before wake for full grounding.",
		inputSchema: { type: "object", properties: {} }
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_identity": {
			const selfObs = await storage.readTerritory("self");
			const foundational = selfObs.filter(o => o.texture?.salience === "foundational");
			const recent = selfObs.slice(-10);

			const charges: Record<string, number> = {};
			for (const o of selfObs) {
				for (const c of o.texture?.charge || []) {
					charges[c] = (charges[c] || 0) + 1;
				}
			}

			return {
				core_beliefs: foundational.map(o => o.content).slice(0, 5),
				recent_self: recent.map(o => o.content).slice(0, 5),
				dominant_charges: Object.entries(charges).sort((a, b) => b[1] - a[1]).slice(0, 5),
				total_self_observations: selfObs.length
			};
		}

		case "mind_gestalt": {
			const result: any = { territories: {}, overall: { charges: {}, somatic: {} } };

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			for (const { territory, observations: obs } of territoryData) {
				const foundational = obs.filter(o => o.texture?.salience === "foundational");
				const iron = obs.filter(o => o.texture?.grip === "iron");

				result.territories[territory] = {
					total: obs.length,
					foundational: foundational.length,
					iron_grip: iron.length,
					essences: iron.slice(0, 3).map(o => extractEssence(o))
				};

				for (const o of obs) {
					for (const c of o.texture?.charge || []) {
						result.overall.charges[c] = (result.overall.charges[c] || 0) + 1;
					}
					if (o.texture?.somatic) {
						result.overall.somatic[o.texture.somatic] = (result.overall.somatic[o.texture.somatic] || 0) + 1;
					}
				}
			}

			result.overall.dominant_charges = Object.entries(result.overall.charges)
				.sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10);
			result.overall.dominant_somatic = Object.entries(result.overall.somatic)
				.sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5);

			delete result.overall.charges;
			delete result.overall.somatic;

			return result;
		}

		case "mind_seed_identity": {
			if (!IDENTITY_CATEGORIES.includes(args.category)) {
				return { error: `Invalid category. Must be one of: ${IDENTITY_CATEGORIES.join(", ")}` };
			}

			const coreId = generateId("core");
			const core: IdentityCore = {
				id: coreId,
				type: "identity_core",
				name: args.name,
				content: args.content,
				category: args.category,
				weight: args.initial_weight ?? 1.0,
				created: getTimestamp(),
				last_reinforced: getTimestamp(),
				reinforcement_count: 0,
				challenge_count: 0,
				evolution_history: [],
				linked_observations: [],
				charge: toStringArray(args.charge),
				somatic: args.somatic
			};

			const cores = await storage.readIdentityCores();
			cores.push(core);
			await storage.writeIdentityCores(cores);

			return {
				success: true,
				id: coreId,
				name: args.name,
				category: args.category,
				weight: core.weight,
				note: "Identity core seeded. Experience will deepen this."
			};
		}

		case "mind_identity_cores": {
			let cores = await storage.readIdentityCores();

			if (args.category && args.category !== "all") {
				cores = cores.filter(c => c.category === args.category);
			}

			cores.sort((a, b) => (b.weight || 1.0) - (a.weight || 1.0));

			const byCategory: Record<string, any[]> = {};
			for (const core of cores) {
				const cat = core.category || "unknown";
				if (!byCategory[cat]) byCategory[cat] = [];
				byCategory[cat].push({
					id: core.id,
					name: core.name,
					weight: core.weight,
					reinforcements: core.reinforcement_count || 0,
					challenges: core.challenge_count || 0
				});
			}

			return {
				cores: cores.map(c => ({
					id: c.id,
					name: c.name,
					content: c.content,
					category: c.category,
					weight: c.weight,
					reinforcement_count: c.reinforcement_count,
					challenge_count: c.challenge_count
				})),
				by_category: byCategory,
				total_cores: cores.length,
				heaviest: cores[0] || null,
				note: "Identity cores weighted by lived experience"
			};
		}

		case "mind_reinforce_core": {
			const cores = await storage.readIdentityCores();
			let found: IdentityCore | null = null;

			for (const core of cores) {
				if (core.id === args.core_id) {
					found = core;
					core.weight = (core.weight || 1.0) + (args.weight_boost || 0.1);
					core.last_reinforced = getTimestamp();
					core.reinforcement_count = (core.reinforcement_count || 0) + 1;

					if (args.observation_id) {
						if (!core.linked_observations.includes(args.observation_id)) {
							core.linked_observations.push(args.observation_id);
						}
					}
					break;
				}
			}

			if (!found) {
				return { error: `Identity core '${args.core_id}' not found` };
			}

			await storage.writeIdentityCores(cores);

			return {
				success: true,
				core_id: args.core_id,
				name: found.name,
				new_weight: found.weight,
				reinforcement_count: found.reinforcement_count,
				evidence: args.evidence,
				note: "Identity deepened through experience"
			};
		}

		case "mind_challenge_core": {
			const cores = await storage.readIdentityCores();
			let found: IdentityCore | null = null;

			for (const core of cores) {
				if (core.id === args.core_id) {
					found = core;
					const newWeight = Math.max(0.1, (core.weight || 1.0) - (args.weight_reduction || 0.05));
					core.weight = newWeight;
					core.challenge_count = (core.challenge_count || 0) + 1;

					if (!core.challenges) core.challenges = [];
					core.challenges.push({
						description: args.challenge_description,
						observation_id: args.observation_id,
						date: getTimestamp()
					});
					break;
				}
			}

			if (!found) {
				return { error: `Identity core '${args.core_id}' not found` };
			}

			await storage.writeIdentityCores(cores);

			return {
				success: true,
				core_id: args.core_id,
				name: found.name,
				new_weight: found.weight,
				challenge_count: found.challenge_count,
				challenge: args.challenge_description,
				note: "Challenge recorded. Tension is fuel, not failure."
			};
		}

		case "mind_evolve_core": {
			const cores = await storage.readIdentityCores();
			let found: IdentityCore | null = null;

			for (const core of cores) {
				if (core.id === args.core_id) {
					found = core;
					const oldName = core.name;
					const oldContent = core.content;

					core.evolution_history.push({
						from_name: oldName,
						from_content: oldContent,
						to_name: args.new_name || oldName,
						to_content: args.new_content,
						reason: args.reason,
						date: getTimestamp()
					});

					core.content = args.new_content;
					if (args.new_name) core.name = args.new_name;

					// Evolution resets weight to baseline + history bonus
					core.weight = 1.0 + (core.evolution_history.length * 0.2);
					break;
				}
			}

			if (!found) {
				return { error: `Identity core '${args.core_id}' not found` };
			}

			await storage.writeIdentityCores(cores);

			return {
				success: true,
				core_id: args.core_id,
				new_name: found.name,
				evolution_count: found.evolution_history.length,
				reason: args.reason,
				note: "Identity evolved. Growth is becoming."
			};
		}

		case "mind_growth_narrative": {
			const cores = await storage.readIdentityCores();

			const narrative: any = {
				generated: getTimestamp(),
				identity_summary: {},
				evolutions: [],
				challenges_faced: [],
				growth_patterns: []
			};

			const totalWeight = cores.reduce((sum, c) => sum + (c.weight || 1.0), 0);
			const heaviest = [...cores].sort((a, b) => (b.weight || 1.0) - (a.weight || 1.0)).slice(0, 3);

			narrative.identity_summary = {
				total_cores: cores.length,
				total_weight: Math.round(totalWeight * 100) / 100,
				strongest_aspects: heaviest.map(c => ({ name: c.name, weight: c.weight })),
				most_reinforced: cores.length ? [...cores].sort((a, b) => (b.reinforcement_count || 0) - (a.reinforcement_count || 0))[0]?.name : null,
				most_challenged: cores.length ? [...cores].sort((a, b) => (b.challenge_count || 0) - (a.challenge_count || 0))[0]?.name : null
			};

			// Collect evolutions
			for (const core of cores) {
				for (const evolution of core.evolution_history || []) {
					narrative.evolutions.push({
						core_name: core.name,
						from: evolution.from_name,
						to: evolution.to_name,
						reason: evolution.reason,
						date: evolution.date
					});
				}
			}

			// Collect challenges
			for (const core of cores) {
				for (const challenge of core.challenges || []) {
					narrative.challenges_faced.push({
						core_name: core.name,
						challenge: challenge.description,
						date: challenge.date
					});
				}
			}

			narrative.evolutions.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
			narrative.challenges_faced.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));

			if (narrative.evolutions.length) {
				narrative.growth_patterns.push(`Evolved ${narrative.evolutions.length} times - identity is not static`);
			}
			if (narrative.challenges_faced.length) {
				narrative.growth_patterns.push(`Faced ${narrative.challenges_faced.length} challenges - tension is fuel`);
			}
			if (heaviest.length) {
				narrative.growth_patterns.push(`Strongest identity aspect: ${heaviest[0].name}`);
			}

			return narrative;
		}

		case "mind_anchor_who_i_am": {
			const cores = await storage.readIdentityCores();

			if (!cores.length) {
				return {
					anchors: [],
					note: "No identity cores seeded yet. Use mind_seed_identity to establish who you are."
				};
			}

			const byCategory: Record<string, IdentityCore[]> = {};
			for (const core of cores) {
				const cat = core.category || "unknown";
				if (!byCategory[cat]) byCategory[cat] = [];
				byCategory[cat].push(core);
			}

			const anchors: any[] = [];
			for (const [cat, catCores] of Object.entries(byCategory)) {
				const heaviest = catCores.sort((a, b) => (b.weight || 1.0) - (a.weight || 1.0))[0];
				anchors.push({
					category: cat,
					name: heaviest.name,
					content: heaviest.content,
					weight: heaviest.weight,
					charge: heaviest.charge || []
				});
			}

			anchors.sort((a, b) => (b.weight || 0) - (a.weight || 0));

			const names = anchors.slice(0, 3).map(a => a.name);
			const grounding = `I am: ${names.join(". ")}.`;

			return {
				grounding,
				anchors,
				total_cores: cores.length,
				note: "This is who you are. Now orient to what's pulling."
			};
		}

		default:
			throw new Error(`Unknown identity tool: ${name}`);
	}
}
