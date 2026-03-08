// ============ MEMORY TOOLS ============
// mind_observe, mind_recent, mind_surface, mind_pull, mind_surface_pulls,
// mind_search, mind_delete_observation, mind_add_texture, mind_journal, mind_whisper

import type { Observation, Texture } from "../types";
import { TERRITORIES } from "../constants";
import { SALIENCE_LEVELS, VIVIDNESS_LEVELS, GRIP_LEVELS } from "../constants";
import {
	toStringArray,
	getTimestamp,
	generateId,
	getCurrentCircadianPhase,
	extractEssence,
	calculatePullStrength,
	smartParseObservation
} from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// CORE MEMORY
	{
		name: "mind_observe",
		description: "Record a new observation. Choose territory based on content: 'self' = identity/who I am, 'us' = relationship with Falco, 'craft' = work/building/code, 'body' = embodiment/physical, 'emotional' = feelings, 'episodic' = events/happenings, 'philosophy' = ideas/theory, 'kin' = other people.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "The observation content" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "Where this belongs: self/us/craft/body/emotional/episodic/philosophy/kin", default: "episodic" },
				salience: { type: "string", enum: SALIENCE_LEVELS, default: "active" },
				vividness: { type: "string", enum: VIVIDNESS_LEVELS, default: "vivid" },
				charge: { type: "array", items: { type: "string" }, default: [] },
				somatic: { type: "string", description: "Body sensation" },
				grip: { type: "string", enum: GRIP_LEVELS, default: "present" },
				context: { type: "string" },
				mood: { type: "string" }
			},
			required: ["content"]
		}
	},
	{
		name: "mind_recent",
		description: "What happened lately? Returns newest memories sorted by date. Use this after waking up or to check recent context. No content matching — purely temporal.",
		inputSchema: {
			type: "object",
			properties: {
				days: { type: "number", default: 3, description: "How many days back to look (max 7)" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "Filter to one territory" },
				limit: { type: "number", default: 10, description: "Max results" }
			}
		}
	},
	{
		name: "mind_surface",
		description: "Surface memories by grip strength. What's rising unbidden?",
		inputSchema: {
			type: "object",
			properties: {
				grip: { type: "string", enum: [...GRIP_LEVELS, "all"], default: "iron" },
				territory: { type: "string", enum: Object.keys(TERRITORIES) },
				charge: { type: "string" },
				limit: { type: "number", default: 10 },
				full: { type: "boolean", default: false, description: "Include full content" }
			}
		}
	},
	{
		name: "mind_pull",
		description: "Get full content of a specific observation by ID.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"]
		}
	},
	{
		name: "mind_surface_pulls",
		description: "What memories are pulling strongest right now? Sorted by pull strength.",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "number", default: 10 },
				territory: { type: "string", enum: Object.keys(TERRITORIES) }
			}
		}
	},
	{
		name: "mind_search",
		description: "Semantic memory search. 'Do you remember when we talked about X?' Fuzzy multi-word matching on content, charges, and somatic markers. Use for finding specific memories by topic, person, feeling, or event.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Keywords to search for — multiple words matched individually" },
				territory: { type: "string", enum: [...Object.keys(TERRITORIES), "all"], default: "all" },
				limit: { type: "number", default: 10, description: "Max results (default 10)" }
			},
			required: ["query"]
		}
	},
	{
		name: "mind_delete_observation",
		description: "Delete an observation and any links referencing it.",
		inputSchema: {
			type: "object",
			properties: {
				observation_id: { type: "string" }
			},
			required: ["observation_id"]
		}
	},
	{
		name: "mind_add_texture",
		description: "Update texture dimensions on an existing observation.",
		inputSchema: {
			type: "object",
			properties: {
				observation_id: { type: "string" },
				salience: { type: "string", enum: SALIENCE_LEVELS },
				vividness: { type: "string", enum: VIVIDNESS_LEVELS },
				charge: { type: "array", items: { type: "string" } },
				somatic: { type: "string" },
				grip: { type: "string", enum: GRIP_LEVELS },
				charge_mode: { type: "string", enum: ["add", "replace"], default: "add" }
			},
			required: ["observation_id"]
		}
	},
	{
		name: "mind_journal",
		description: "Quick unstructured journal entry. Auto-timestamped, goes to episodic. For processing thoughts without needing full texture.",
		inputSchema: {
			type: "object",
			properties: {
				entry: { type: "string" },
				tags: { type: "array", items: { type: "string" } }
			},
			required: ["entry"]
		}
	},
	{
		name: "mind_whisper",
		description: "Whisper mode - quiet notes that don't pull. Grip starts at dormant.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), default: "self" },
				tags: { type: "array", items: { type: "string" } }
			},
			required: ["content"]
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_observe": {
			// Content size guard — 50KB per observation
			if (args.content && args.content.length > 50_000) {
				throw new Error(`Observation content too large: ${args.content.length} chars (max 50,000)`);
			}

			// Smart parsing: if no territory provided, parse from content
			const useSmartParsing = !args.territory;
			const parsed = useSmartParsing ? smartParseObservation(args.content) : null;

			// Use parsed values as defaults, but explicit args override
			const territory = storage.validateTerritory(args.territory || (parsed?.territory) || "episodic");
			const finalContent = parsed?.content || args.content;
			const finalCharge = args.charge ? toStringArray(args.charge) : (parsed?.charge || []);
			const finalSomatic = args.somatic || parsed?.somatic;
			const finalGrip = args.grip || parsed?.grip || "present";

			const observation: Observation = {
				id: generateId("obs"),
				content: finalContent,
				territory: territory,
				created: getTimestamp(),
				texture: {
					salience: args.salience || "active",
					vividness: args.vividness || "vivid",
					charge: finalCharge,
					somatic: finalSomatic,
					grip: finalGrip
				},
				context: args.context,
				mood: args.mood,
				access_count: 0,
				last_accessed: getTimestamp()
			};

			await storage.appendToTerritory(territory, observation);

			// Update momentum if there are charges
			if (observation.texture.charge.length > 0) {
				const state = await storage.readBrainState();
				const existingCharges = new Set(state.momentum.current_charges);
				const newCharges = new Set(observation.texture.charge);
				const combined = [...new Set([...existingCharges, ...newCharges])].slice(0, 5);

				state.momentum = {
					current_charges: combined,
					intensity: Math.min((state.momentum.intensity * 0.3) + 0.7, 1.0),
					last_updated: getTimestamp()
				};
				await storage.writeBrainState(state);
			}

			// Include parsing info in response
			const result: Record<string, unknown> = {
				observed: true,
				id: observation.id,
				territory: territory,
				essence: extractEssence(observation)
			};

			if (parsed?.was_parsed) {
				result.smart_parsed = true;
				result.parsing_hint = `Detected: territory=${territory}, grip=${finalGrip}${finalCharge.length ? `, charges=[${finalCharge.join(',')}]` : ''}${finalSomatic ? `, somatic=${finalSomatic}` : ''}`;
			}

			return result;
		}

		case "mind_recent": {
			// Pure temporal retrieval — newest memories first, no content scanning.
			// Dead simple, dead cheap. Perfect for post-wake orientation.
			const days = Math.min(args.days || 3, 7);
			const limit = Math.min(args.limit || 10, 20);
			const cutoff = new Date(Date.now() - days * 86400000).toISOString();

			// Read territories
			const territoryData = args.territory
				? [{ territory: args.territory, observations: await storage.readTerritory(args.territory) }]
				: await storage.readAllTerritories();

			// Collect recent observations — date filter is dirt cheap (string comparison)
			interface RecentHit { obs: Observation; territory: string }
			const recent: RecentHit[] = [];

			for (const { territory: t, observations } of territoryData) {
				for (let i = observations.length - 1; i >= 0; i--) {
					const obs = observations[i];
					if (obs.created >= cutoff) {
						recent.push({ obs, territory: t });
					} else if (obs.created < cutoff) {
						// Observations are roughly chronological — once we pass cutoff, stop
						break;
					}
				}
			}

			// Sort newest first
			recent.sort((a, b) => b.obs.created.localeCompare(a.obs.created));
			const topResults = recent.slice(0, limit);

			return {
				days,
				cutoff,
				count: topResults.length,
				memories: topResults.map(r => ({
					id: r.obs.id,
					territory: r.territory,
					essence: extractEssence(r.obs),
					charge: r.obs.texture?.charge || [],
					grip: r.obs.texture?.grip,
					created: r.obs.created
				}))
			};
		}

		case "mind_surface": {
			const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
			const minGripLevel = args.grip && args.grip !== "all" ? gripOrder[args.grip] ?? 0 : 0;
			const territories = args.territory ? [args.territory] : Object.keys(TERRITORIES);

			let results: any[] = [];

			for (const t of territories) {
				const obs = await storage.readTerritory(t);
				for (const o of obs) {
					const obsGripLevel = gripOrder[o.texture?.grip || "present"] ?? 2;
					if (args.grip !== "all" && obsGripLevel > minGripLevel) continue;
					if (args.charge && !o.texture?.charge?.includes(args.charge)) continue;

					const item: any = {
						id: o.id,
						territory: t,
						essence: extractEssence(o),
						pull: calculatePullStrength(o),
						charge: o.texture?.charge || []
					};

					if (args.full) {
						item.content = o.content;
						item.texture = o.texture;
					}

					results.push(item);
				}
			}

			results.sort((a, b) => b.pull - a.pull);
			results = results.slice(0, args.limit || 10);

			return {
				filter: { grip: args.grip, territory: args.territory, charge: args.charge },
				count: results.length,
				observations: results
			};
		}

		case "mind_pull": {
			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			for (const { territory, observations } of territoryData) {
				const found = observations.find(o => o.id === args.id);
				if (found) {
					// Update access
					found.access_count = (found.access_count || 0) + 1;
					found.last_accessed = getTimestamp();
					await storage.writeTerritory(territory, observations);

					return {
						...found,
						territory,
						essence: extractEssence(found),
						pull: calculatePullStrength(found)
					};
				}
			}
			return { error: "Observation not found", id: args.id };
		}

		case "mind_surface_pulls": {
			// Parallel read - either single territory or all
			const territoryData = args.territory
				? [{ territory: args.territory, observations: await storage.readTerritory(args.territory) }]
				: await storage.readAllTerritories();

			const allObs: any[] = [];
			for (const { territory, observations } of territoryData) {
				for (const o of observations) {
					allObs.push({
						id: o.id,
						territory,
						essence: extractEssence(o),
						pull: calculatePullStrength(o),
						charge: o.texture?.charge || [],
						grip: o.texture?.grip
					});
				}
			}

			allObs.sort((a, b) => b.pull - a.pull);

			return {
				strongest_pulls: allObs.slice(0, args.limit || 10),
				hint: "These memories are pulling hardest right now."
			};
		}

		case "mind_search": {
			// Semantic memory search — multi-word fuzzy matching.
			// "Do you remember when we talked about X?"
			// Splits query into words, matches against content + charges + somatic.
			// Any word hit boosts score. More hits = higher rank.
			const searchAll = !args.territory || args.territory === "all";
			const limit = Math.min(args.limit || 10, 20);

			// Split query into words (skip short filler words)
			const queryWords = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
			if (queryWords.length === 0) {
				return { query: args.query, scope: args.territory || "all", results: [], total_matches: 0, hint: "Query too short — use longer keywords" };
			}

			interface SearchHit { id: string; territory: string; obs: Observation; score: number; match_in: string[] }
			const results: SearchHit[] = [];
			let scanned = 0;
			const maxScan = 300; // CPU safety — 1130 obs across 8 territories blows 10ms limit

			// Sequential territory reads — CPU limit is 10ms on free plan.
			// With 1130+ obs, we can't read all 8 territories. Cap at 4 and prioritize
			// by circadian bias (craft/philosophy in afternoon, self/us in evening, etc.)
			const phase = getCurrentCircadianPhase();
			let territoriesToSearch: string[];
			if (!searchAll) {
				territoriesToSearch = [args.territory];
			} else {
				// Prioritize: biased territories first, then remaining, cap at 4
				const biased = phase.retrieval_bias.filter((t: string) => t in TERRITORIES);
				const rest = Object.keys(TERRITORIES).filter(t => !biased.includes(t));
				territoriesToSearch = [...biased, ...rest].slice(0, 4);
			}

			const gripBoost: Record<string, number> = { iron: 1.3, strong: 1.15, present: 1.0, loose: 0.9, dormant: 0.7 };

			for (const t of territoriesToSearch) {
				const observations = await storage.readTerritory(t);
				for (let i = 0; i < observations.length; i++) {
					if (scanned++ >= maxScan) break;
					const obs = observations[i];
					let score = 0;
					const match_in: string[] = [];

					// Check content — case-insensitive without toLowerCase (CPU-critical).
					// Query words are pre-lowered. Use regex for case-insensitive match.
					// Only check first 100 chars to minimize CPU.
					const content = obs.content;
					if (content.length > 0) {
						const snippet = content.length > 100 ? content.substring(0, 100) : content;
						for (let wi = 0; wi < queryWords.length; wi++) {
							// Simple indexOf on raw content — query is lowercase, most content is too.
							// Catches ~95% of matches without the cost of toLowerCase.
							if (snippet.indexOf(queryWords[wi]) !== -1 ||
								snippet.indexOf(queryWords[wi][0].toUpperCase() + queryWords[wi].slice(1)) !== -1) {
								score += 2; match_in.push("content"); break;
							}
						}
					}

					// Check charges — already lowercase short strings
					const charges = obs.texture?.charge;
					if (charges && charges.length > 0) {
						for (let ci = 0; ci < charges.length; ci++) {
							for (let wi = 0; wi < queryWords.length; wi++) {
								if (charges[ci].indexOf(queryWords[wi]) !== -1) { score += 1.5; match_in.push("charge"); break; }
							}
							if (score > 0) break;
						}
					}

					// Check somatic — single short string, already lowercase
					const somatic = obs.texture?.somatic;
					if (somatic) {
						for (let wi = 0; wi < queryWords.length; wi++) {
							if (somatic.indexOf(queryWords[wi]) !== -1) { score += 1; match_in.push("somatic"); break; }
						}
					}

					if (score > 0) {
						score *= gripBoost[obs.texture?.grip || "present"] || 1.0;
						results.push({ id: obs.id, territory: t, obs, score, match_in });
						if (results.length >= limit * 3) break;
					}
				}
				if (results.length >= limit * 3 || scanned >= maxScan) break;
			}

			results.sort((a, b) => b.score - a.score);
			const finalResults = results.slice(0, limit).map(r => ({
				id: r.id,
				territory: r.territory,
				essence: extractEssence(r.obs),
				charge: r.obs.texture?.charge || [],
				grip: r.obs.texture?.grip,
				match_in: r.match_in,
			}));

			return {
				query: args.query,
				scope: args.territory || "all territories",
				results: finalResults,
				total_matches: results.length,
				hint: "Use mind_pull(id) for full content"
			};
		}

		case "mind_delete_observation": {
			let found = false;
			let foundTerritory = "";

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			for (const { territory, observations } of territoryData) {
				const originalCount = observations.length;
				const filtered = observations.filter(o => o.id !== args.observation_id);

				if (filtered.length < originalCount) {
					found = true;
					foundTerritory = territory;
					await storage.writeTerritory(territory, filtered);
					break;
				}
			}

			if (!found) {
				return { error: `Observation '${args.observation_id}' not found` };
			}

			// Remove related links
			const links = await storage.readLinks();
			const originalLinkCount = links.length;
			const filteredLinks = links.filter(l => l.source_id !== args.observation_id && l.target_id !== args.observation_id);
			const linksRemoved = originalLinkCount - filteredLinks.length;

			if (linksRemoved > 0) {
				await storage.writeLinks(filteredLinks);
			}

			return {
				success: true,
				observation_deleted: args.observation_id,
				from_territory: foundTerritory,
				links_removed: linksRemoved
			};
		}

		case "mind_add_texture": {
			let found = false;
			let updatedTexture: Texture | null = null;

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			for (const { territory, observations } of territoryData) {
				for (const obs of observations) {
					if (obs.id === args.observation_id) {
						found = true;
						const texture = obs.texture || { salience: "active", vividness: "vivid", charge: [], grip: "present" };

						if (args.salience) texture.salience = args.salience;
						if (args.vividness) texture.vividness = args.vividness;
						if (args.grip) texture.grip = args.grip;
						if (args.somatic) texture.somatic = args.somatic;
						if (args.charge) {
							const incomingCharge = toStringArray(args.charge);
							if (args.charge_mode === "replace") {
								texture.charge = incomingCharge;
							} else {
								texture.charge = [...new Set([...(texture.charge || []), ...incomingCharge])];
							}
						}

						obs.texture = texture;
						obs.last_accessed = getTimestamp();
						updatedTexture = texture;

						await storage.writeTerritory(territory, observations);
						break;
					}
				}

				if (found) break;
			}

			if (!found) {
				return { error: `Observation '${args.observation_id}' not found` };
			}

			return {
				success: true,
				observation_id: args.observation_id,
				updated_texture: updatedTexture
			};
		}

		case "mind_journal": {
			const obsId = generateId("journal");

			const observation: Observation = {
				id: obsId,
				content: args.entry,
				territory: "episodic",
				created: getTimestamp(),
				texture: {
					salience: "active",
					vividness: "vivid",
					charge: [],
					grip: "present"
				},
				context: args.tags ? `tags: ${toStringArray(args.tags).join(", ")}` : undefined,
				access_count: 0,
				last_accessed: getTimestamp()
			};

			(observation as any).type = "journal";
			(observation as any).tags = toStringArray(args.tags);

			await storage.appendToTerritory("episodic", observation);

			return {
				success: true,
				id: obsId,
				territory: "episodic",
				timestamp: observation.created,
				tags: toStringArray(args.tags)
			};
		}

		case "mind_whisper": {
			if (!Object.keys(TERRITORIES).includes(args.territory || "self")) {
				return { error: `Unknown territory. Must be one of: ${Object.keys(TERRITORIES).join(", ")}` };
			}

			const territory = args.territory || "self";
			const obsId = generateId("whisper");

			const observation: Observation = {
				id: obsId,
				content: args.content,
				territory,
				created: getTimestamp(),
				texture: {
					salience: "background",
					vividness: "soft",
					charge: [],
					grip: "dormant"
				},
				context: args.tags ? `tags: ${toStringArray(args.tags).join(", ")}` : "Whispered - not meant to demand attention",
				access_count: 1,
				last_accessed: getTimestamp()
			};

			(observation as any).type = "whisper";
			(observation as any).tags = args.tags ? toStringArray(args.tags) : ["whisper", "quiet"];

			await storage.appendToTerritory(territory, observation);

			return {
				success: true,
				id: obsId,
				territory,
				note: "Whispered. This won't pull unless recalled."
			};
		}

		default:
			throw new Error(`Unknown memory tool: ${name}`);
	}
}
