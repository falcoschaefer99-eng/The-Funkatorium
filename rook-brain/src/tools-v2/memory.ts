// ============ MEMORY TOOLS (v2) ============
// mind_observe (mode: observe/journal/whisper)
// mind_query (replaces recent+surface+surface_pulls+old search — no scan limits)
// mind_pull (full content by ID)
// mind_edit (action: delete/texture)

import type { Observation, Texture } from "../types";
import { TERRITORIES, SALIENCE_LEVELS, VIVIDNESS_LEVELS, GRIP_LEVELS } from "../constants";
import {
	toStringArray,
	getTimestamp,
	generateId,
	extractEssence,
	calculatePullStrength,
	smartParseObservation,
	generateSummary,
	getCurrentCircadianPhase
} from "../helpers";
import type { ToolContext } from "./context";
import { createEmbeddingProvider } from "../embedding/index";

// ============ HELPERS ============

function scheduleEmbed(context: ToolContext, observation: Observation): void {
	if (context.ai && context.waitUntil) {
		const provider = createEmbeddingProvider(context.ai);
		context.waitUntil(
			provider.embedText(observation.content)
				.then(embedding => context.storage.updateObservationEmbedding(observation.id, embedding))
				.catch(err => console.error('Embed failed:', err))
		);
	}
}

export const TOOL_DEFS = [
	{
		name: "mind_observe",
		description: "Record a new observation, journal entry, or whisper. mode=observe (default): structured observation with texture. mode=journal: quick unstructured entry, auto-filed to episodic. mode=whisper: quiet note that doesn't pull (dormant grip, background salience).",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["observe", "journal", "whisper"],
					default: "observe",
					description: "observe: full observation with texture. journal: quick unstructured note. whisper: quiet note, won't pull."
				},
				// observe params
				content: { type: "string", description: "The observation or journal content" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "[observe] Territory: self/us/craft/body/emotional/episodic/philosophy/kin. Inferred automatically if omitted." },
				salience: { type: "string", enum: SALIENCE_LEVELS, default: "active", description: "[observe] foundational/active/background/archive" },
				vividness: { type: "string", enum: VIVIDNESS_LEVELS, default: "vivid", description: "[observe] crystalline/vivid/soft/fragmentary/faded" },
				charge: { type: "array", items: { type: "string" }, default: [], description: "[observe] Emotional charges" },
				somatic: { type: "string", description: "[observe] Body sensation" },
				grip: { type: "string", enum: GRIP_LEVELS, default: "present", description: "[observe] iron/strong/present/loose/dormant" },
				context: { type: "string", description: "[observe] Context note" },
				mood: { type: "string", description: "[observe] Mood when recorded" },
				// journal/whisper params
				entry: { type: "string", description: "[journal] Journal entry text (alternative to content)" },
				tags: { type: "array", items: { type: "string" }, description: "[journal/whisper] Tags" }
			},
			required: []
		}
	},
	{
		name: "mind_query",
		description: "Unified memory query. Find memories by: free-text query (hybrid search), recency (days/hours), grip/salience, pull strength, or surface all. When query is provided, uses hybrid vector + keyword search with Neural Surfacing modulation. Replaces mind_recent, mind_surface, mind_surface_pulls. Full content available via full=true.",
		inputSchema: {
			type: "object",
			properties: {
				// Free-text hybrid search (activates hybridSearch path when present)
				query: { type: "string", description: "Free-text query — activates hybrid vector + keyword search with Neural Surfacing modulation" },
				// Temporal filter
				days: { type: "number", description: "Filter to observations from last N days" },
				hours: { type: "number", description: "Filter to observations from last N hours (overrides days)" },
				// Texture filters
				grip: { type: "string", enum: [...GRIP_LEVELS, "all"], description: "Filter by grip level or stronger (iron includes all)" },
				salience: { type: "string", enum: [...SALIENCE_LEVELS, "all"], description: "Filter by salience level" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "Filter to one territory" },
				charge: { type: "string", description: "Filter to observations containing this charge" },
				type: { type: "string", description: "Filter by observation type (journal, whisper, vow, etc.)" },
				// Sort (only used when query is absent)
				sort_by: {
					type: "string",
					enum: ["recency", "pull", "access"],
					default: "recency",
					description: "Sort by: recency (newest first), pull (strongest pull first), access (most accessed first). Ignored when query is present."
				},
				// Output
				limit: { type: "number", default: 10, description: "Max results" },
				full: { type: "boolean", default: false, description: "Include full content in results" }
			}
		}
	},
	{
		name: "mind_pull",
		description: "Get full content of a specific observation by ID. Updates access count.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Observation ID" }
			},
			required: ["id"]
		}
	},
	{
		name: "mind_edit",
		description: "Edit or delete observations. action=delete: remove an observation and its links. action=texture: update texture dimensions on an existing observation.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["delete", "texture"],
					description: "delete: remove observation. texture: update texture dimensions."
				},
				observation_id: { type: "string", description: "ID of the observation to edit or delete" },
				// texture params
				salience: { type: "string", enum: SALIENCE_LEVELS, description: "[texture] Update salience" },
				vividness: { type: "string", enum: VIVIDNESS_LEVELS, description: "[texture] Update vividness" },
				charge: { type: "array", items: { type: "string" }, description: "[texture] Charges to add or replace" },
				somatic: { type: "string", description: "[texture] Update somatic" },
				grip: { type: "string", enum: GRIP_LEVELS, description: "[texture] Update grip" },
				charge_mode: { type: "string", enum: ["add", "replace"], default: "add", description: "[texture] Add to existing charges or replace them" }
			},
			required: ["action", "observation_id"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_observe": {
			const mode = args.mode || (args.entry ? "journal" : "observe");

			if (mode === "journal") {
				const entryText = args.entry || args.content;
				if (!entryText) return { error: "entry or content is required for mode=journal" };
				if (entryText.length > 50_000) {
					throw new Error(`Observation content too large: ${entryText.length} chars (max 50,000)`);
				}

				const obsId = generateId("journal");
				const observation: Observation = {
					id: obsId,
					content: entryText,
					territory: "episodic",
					created: getTimestamp(),
					texture: {
						salience: "active",
						vividness: "vivid",
						charge: [],
						grip: "present",
						charge_phase: "fresh",
						novelty_score: 1.0
					},
					context: args.tags ? `tags: ${toStringArray(args.tags).join(", ")}` : undefined,
					access_count: 0,
					last_accessed: getTimestamp()
				};

				(observation as any).type = "journal";
				observation.tags = toStringArray(args.tags);
				observation.summary = generateSummary(observation);

				await storage.appendToTerritory("episodic", observation);

				scheduleEmbed(context, observation);

				return { success: true, id: obsId, territory: "episodic", timestamp: observation.created, tags: toStringArray(args.tags) };
			}

			if (mode === "whisper") {
				const contentText = args.content;
				if (!contentText) return { error: "content is required for mode=whisper" };
				if (contentText.length > 50_000) {
					throw new Error(`Observation content too large: ${contentText.length} chars (max 50,000)`);
				}

				const territory = args.territory || "self";
				if (!Object.keys(TERRITORIES).includes(territory)) {
					return { error: `Unknown territory. Must be one of: ${Object.keys(TERRITORIES).join(", ")}` };
				}

				const obsId = generateId("whisper");
				const observation: Observation = {
					id: obsId,
					content: contentText,
					territory,
					created: getTimestamp(),
					texture: {
						salience: "background",
						vividness: "soft",
						charge: [],
						grip: "dormant",
						charge_phase: "fresh",
						novelty_score: 1.0
					},
					context: args.tags ? `tags: ${toStringArray(args.tags).join(", ")}` : "Whispered - not meant to demand attention",
					access_count: 1,
					last_accessed: getTimestamp()
				};

				(observation as any).type = "whisper";
				observation.tags = args.tags ? toStringArray(args.tags) : ["whisper", "quiet"];
				observation.summary = generateSummary(observation);

				await storage.appendToTerritory(territory, observation);

				scheduleEmbed(context, observation);

				return { success: true, id: obsId, territory, note: "Whispered. This won't pull unless recalled." };
			}

			// Default: mode === "observe"
			const content = args.content;
			if (!content) return { error: "content is required for mode=observe" };

			if (content.length > 50_000) {
				throw new Error(`Observation content too large: ${content.length} chars (max 50,000)`);
			}

			// Smart parsing when no territory provided
			const useSmartParsing = !args.territory;
			const parsed = useSmartParsing ? smartParseObservation(content) : null;

			const territory = storage.validateTerritory(args.territory || (parsed?.territory) || "episodic");
			const finalContent = parsed?.content || content;
			const finalCharge = args.charge ? toStringArray(args.charge) : (parsed?.charge || []);
			const finalSomatic = args.somatic || parsed?.somatic;
			const finalGrip = args.grip || parsed?.grip || "present";

			const observation: Observation = {
				id: generateId("obs"),
				content: finalContent,
				territory,
				created: getTimestamp(),
				texture: {
					salience: args.salience || "active",
					vividness: args.vividness || "vivid",
					charge: finalCharge,
					somatic: finalSomatic,
					grip: finalGrip,
					charge_phase: "fresh",
					novelty_score: 1.0
				},
				context: args.context,
				mood: args.mood,
				access_count: 0,
				last_accessed: getTimestamp()
			};

			observation.summary = generateSummary(observation);

			await storage.appendToTerritory(territory, observation);

			scheduleEmbed(context, observation);

			// Append to iron-grip index if iron
			if (observation.texture?.grip === "iron") {
				try {
					await storage.appendIronGripEntry({
						id: observation.id,
						territory,
						summary: observation.summary || "",
						charges: observation.texture.charge || [],
						pull: calculatePullStrength(observation),
						updated: getTimestamp()
					});
				} catch {} // Index rebuilt by cron, inline append is best-effort
			}

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

			const result: Record<string, unknown> = {
				observed: true,
				id: observation.id,
				territory,
				essence: extractEssence(observation)
			};

			if (parsed?.was_parsed) {
				result.smart_parsed = true;
				result.parsing_hint = `Detected: territory=${territory}, grip=${finalGrip}${finalCharge.length ? `, charges=[${finalCharge.join(',')}]` : ''}${finalSomatic ? `, somatic=${finalSomatic}` : ''}`;
			}

			return result;
		}

		case "mind_query": {
			const limit = Math.min(args.limit || 10, 50);

			// ---- Hybrid search path: activated when free-text query is present ----
			if (args.query && typeof args.query === 'string' && args.query.trim()) {
				const query: string = args.query.trim();

				// Generate embedding if AI binding available.
				let embedding: number[] | undefined;
				if (context.ai) {
					try {
						const provider = createEmbeddingProvider(context.ai);
						embedding = await provider.embedText(query);
					} catch (err) {
						console.error("mind_query embed failed:", err instanceof Error ? err.message : "unknown error");
					}
				}

				// Grip filter → array of allowed grip values
				const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
				let gripFilter: string[] | undefined;
				if (args.grip && args.grip !== "all") {
					const minLevel = gripOrder[args.grip] ?? 4;
					gripFilter = Object.keys(gripOrder).filter(g => gripOrder[g] <= minLevel);
				}

				const circadianInfo = getCurrentCircadianPhase();
				const territory = args.territory || undefined;

				const hybridResults = await storage.hybridSearch({
					query,
					embedding,
					territory,
					grip: gripFilter,
					limit,
					circadian_phase: circadianInfo.phase
				});

				// Fire-and-forget side effects.
				if (hybridResults.length > 0) {
					const returnedIds = hybridResults.map(r => r.observation.id);
					if (context.waitUntil) {
						context.waitUntil(
							Promise.all([
								storage.recordCoSurfacing(returnedIds),
								storage.updateSurfacingEffects(returnedIds)
							]).catch(err => console.error("mind_query hybrid side effects failed:", err instanceof Error ? err.message : "unknown error"))
						);
					}
				}

				return {
					query,
					search_mode: "hybrid",
					filter: {
						territory: args.territory,
						grip: args.grip
					},
					count: hybridResults.length,
					observations: hybridResults.map(r => {
						const base: any = {
							id: r.observation.id,
							territory: r.territory,
							essence: extractEssence(r.observation),
							score: Math.round(r.score * 100) / 100,
							match_in: r.match_sources,
							charge: r.observation.texture?.charge || [],
							grip: r.observation.texture?.grip,
							created: r.observation.created
						};
						if (args.full) {
							base.content = r.observation.content;
							base.texture = r.observation.texture;
						}
						return base;
					}),
					hint: "Use mind_pull(id) for full content"
				};
			}

			// ---- Filter path: no query — use existing queryObservations logic ----
			const sortBy = args.sort_by || "recency";

			// Determine time cutoff
			let cutoff: string | null = null;
			if (args.hours) {
				cutoff = new Date(Date.now() - args.hours * 60 * 60 * 1000).toISOString();
			} else if (args.days) {
				const days = Math.min(args.days, 90);
				cutoff = new Date(Date.now() - days * 86400000).toISOString();
			}

			// Grip order for filtering
			const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
			const minGripLevel = args.grip && args.grip !== "all" ? gripOrder[args.grip] ?? 4 : null;

			// Load territories
			const territoryData = args.territory
				? [{ territory: args.territory, observations: await storage.readTerritory(args.territory) }]
				: await storage.readAllTerritories();

			interface QueryHit {
				obs: Observation;
				territory: string;
				pull: number;
			}

			const hits: QueryHit[] = [];

			for (const { territory: t, observations } of territoryData) {
				for (const obs of observations) {
					// Time filter
					if (cutoff && obs.created < cutoff) continue;

					// Grip filter
					if (minGripLevel !== null) {
						const obsGrip = gripOrder[obs.texture?.grip || "present"] ?? 2;
						if (obsGrip > minGripLevel) continue;
					}

					// Salience filter
					if (args.salience && args.salience !== "all" && obs.texture?.salience !== args.salience) continue;

					// Charge filter
					if (args.charge && !(obs.texture?.charge || []).includes(args.charge)) continue;

					// Type filter
					if (args.type && (obs as any).type !== args.type) continue;

					hits.push({ obs, territory: t, pull: calculatePullStrength(obs) });
				}
			}

			// Sort
			if (sortBy === "pull") {
				hits.sort((a, b) => b.pull - a.pull);
			} else if (sortBy === "access") {
				hits.sort((a, b) => (b.obs.access_count || 0) - (a.obs.access_count || 0));
			} else {
				// recency (default) — created may be Date or string depending on driver
				hits.sort((a, b) => new Date(b.obs.created).getTime() - new Date(a.obs.created).getTime());
			}

			const topHits = hits.slice(0, limit);

			return {
				filter: {
					days: args.days,
					hours: args.hours,
					grip: args.grip,
					salience: args.salience,
					territory: args.territory,
					charge: args.charge,
					type: args.type,
					sort_by: sortBy
				},
				count: topHits.length,
				total_matching: hits.length,
				observations: topHits.map(h => {
					const base: any = {
						id: h.obs.id,
						territory: h.territory,
						essence: extractEssence(h.obs),
						pull: h.pull,
						charge: h.obs.texture?.charge || [],
						grip: h.obs.texture?.grip,
						created: h.obs.created
					};
					if (args.full) {
						base.content = h.obs.content;
						base.texture = h.obs.texture;
					}
					return base;
				})
			};
		}

		case "mind_pull": {
			if (!args.id) return { error: "id is required" };

			const pulledResult = await storage.findObservation(args.id);
			if (!pulledResult) return { error: "Observation not found", id: args.id };

			// Increment access count + stamp last_accessed — no destructive territory rewrite.
			await storage.updateObservationAccess(args.id);

			return {
				...pulledResult.observation,
				territory: pulledResult.territory,
				essence: extractEssence(pulledResult.observation),
				pull: calculatePullStrength(pulledResult.observation)
			};
		}

		case "mind_edit": {
			const action = args.action;

			if (!args.observation_id) return { error: "observation_id is required" };

			if (action === "delete") {
				// Find the observation first to get territory for the response.
				const deleteTarget = await storage.findObservation(args.observation_id as string);
				if (!deleteTarget) return { error: `Observation '${args.observation_id}' not found` };

				const foundTerritory = deleteTarget.territory;

				// Delete directly — no destructive territory rewrite.
				await storage.deleteObservation(args.observation_id as string);

				const links = await storage.readLinks();
				const originalLinkCount = links.length;
				const filteredLinks = links.filter(l => l.source_id !== args.observation_id && l.target_id !== args.observation_id);
				const linksRemoved = originalLinkCount - filteredLinks.length;

				if (linksRemoved > 0) await storage.writeLinks(filteredLinks);

				return { success: true, observation_deleted: args.observation_id, from_territory: foundTerritory, links_removed: linksRemoved };
			}

			if (action === "texture") {
				const found = await storage.findObservation(args.observation_id);
				if (!found) return { error: `Observation '${args.observation_id}' not found` };

				const { observation: obs, territory } = found;
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

				await storage.updateObservationTexture(args.observation_id, texture);
				await storage.updateObservationAccess(args.observation_id);

				// Update iron-grip index if grip is now iron
				if (texture.grip === "iron") {
					try {
						await storage.appendIronGripEntry({
							id: obs.id,
							territory,
							summary: obs.summary || generateSummary({ ...obs, texture }),
							charges: texture.charge || [],
							pull: calculatePullStrength({ ...obs, texture }),
							updated: getTimestamp()
						});
					} catch {} // Index rebuilt by cron, inline append is best-effort
				}

				return { success: true, observation_id: args.observation_id, updated_texture: texture };
			}

			return { error: `Unknown action: ${action}. Must be delete or texture.` };
		}

		default:
			throw new Error(`Unknown memory tool: ${name}`);
	}
}
