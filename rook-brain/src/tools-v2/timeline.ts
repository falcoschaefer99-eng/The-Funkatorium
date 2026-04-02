// ============ TIMELINE TOOL (v2) ============
// mind_timeline — chronological view of observations with optional filters
// and vector-semantic time-travel ("what was I thinking about X in January?").

import { TERRITORIES } from "../constants";
import { extractEssence, getCurrentCircadianPhase } from "../helpers";
import type { ToolContext } from "./context";
import { createEmbeddingProvider } from "../embedding/index";

export const TOOL_DEFS = [
	{
		name: "mind_timeline",
		description: "Chronological view of observations, optionally filtered by entity, territory, charges, or time range. Vector search available for semantic time-travel ('what was I thinking about X in January?').",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Optional semantic search query for time-travel" },
				entity_id: { type: "string", description: "Filter to observations about this entity" },
				entity_name: { type: "string", description: "Entity name lookup (alternative to entity_id)" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "Filter to territory" },
				start_date: { type: "string", description: "ISO 8601 start date" },
				end_date: { type: "string", description: "ISO 8601 end date" },
				charge: { type: "string", description: "Filter to observations with this charge" },
				limit: { type: "number", description: "Max results (default 20)" },
				include_versions: { type: "boolean", description: "Include edit history per observation" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_timeline": {
			const limit = Math.min(args.limit || 20, 100);
			const storage = context.storage;

			// Resolve entity_id from name if needed.
			let entityId: string | undefined = args.entity_id;
			if (!entityId && args.entity_name) {
				const entity = await storage.findEntityByName(args.entity_name);
				if (!entity) {
					return { error: `Entity not found: ${args.entity_name}` };
				}
				entityId = entity.id;
			}

			// Fetch observations using queryObservations with date + entity + territory filters.
			// queryObservations handles territory and date range natively.
			const rawResults = await storage.queryObservations({
				territory: args.territory,
				created_after: args.start_date,
				created_before: args.end_date,
				charges_any: args.charge ? [args.charge] : undefined,
				limit: args.query ? limit * 5 : limit, // fetch more when semantic re-ranking needed
				order_by: "created",
				order_dir: "asc"
			});

			// Filter by entity_id post-fetch (queryObservations doesn't have an entity_id param).
			let filtered = entityId
				? rawResults.filter(r => r.observation.entity_id === entityId)
				: rawResults;

			// If a semantic query is provided, generate embedding and re-rank by cosine similarity.
			if (args.query && typeof args.query === "string" && args.query.trim()) {
				const query: string = args.query.trim();

				if (context.ai) {
					try {
						const provider = createEmbeddingProvider(context.ai);
						const queryEmbedding = await provider.embedText(query);

						// Delegate to hybridSearch scoped to the same filters for semantic re-ranking.
						// This gives us proper vector similarity against the full index rather than
						// re-implementing cosine distance in JS on the already-filtered set.
						const circadianInfo = getCurrentCircadianPhase();
						const hybridResults = await storage.hybridSearch({
							query,
							embedding: queryEmbedding,
							territory: args.territory,
							limit: limit * 5,
							circadian_phase: circadianInfo.phase,
							entity_id: entityId
						});

						// Build a score map from hybrid results.
						const scoreMap = new Map<string, number>();
						for (const r of hybridResults) {
							scoreMap.set(r.observation.id, r.score);
						}

						// Keep only filtered observations that also appear in hybrid results,
						// then re-order chronologically within the top semantic matches.
						const filteredIds = new Set(filtered.map(r => r.observation.id));
						const semanticMatches = hybridResults
							.filter(r => filteredIds.has(r.observation.id))
							.slice(0, limit);

						// Build final list: sort by created_at ASC (chronological within semantic matches).
						const matchIds = new Set(semanticMatches.map(r => r.observation.id));
						filtered = filtered
							.filter(r => matchIds.has(r.observation.id))
							.sort((a, b) => new Date(a.observation.created).getTime() - new Date(b.observation.created).getTime());

						// Attach scores for output.
						const scoreMapFinal = scoreMap;

						const observations = await Promise.all(filtered.map(async r => {
							const base: Record<string, unknown> = {
								id: r.observation.id,
								territory: r.territory,
								essence: extractEssence(r.observation),
								charge: r.observation.texture?.charge || [],
								grip: r.observation.texture?.grip,
								charge_phase: r.observation.texture?.charge_phase,
								created: r.observation.created,
								entity_id: r.observation.entity_id,
								score: scoreMapFinal.has(r.observation.id)
									? Math.round((scoreMapFinal.get(r.observation.id) as number) * 100) / 100
									: undefined
							};

							if (args.include_versions) {
								base.versions = await storage.getVersionHistory(r.observation.id);
							}

							return base;
						}));

						return {
							search_mode: "semantic_timeline",
							query,
							filters: {
								entity_id: entityId,
								territory: args.territory,
								start_date: args.start_date,
								end_date: args.end_date,
								charge: args.charge
							},
							count: observations.length,
							observations,
							hint: "Use mind_pull(id) for full content"
						};
					} catch (err) {
						console.error("mind_timeline embed failed:", err instanceof Error ? err.message : "unknown error");
						// Fall through to chronological path on embedding failure.
					}
				}
			}

			// Chronological path (no query, or embedding failed).
			// Enforce chronological ordering even if storage order drifts.
			filtered = filtered
				.slice()
				.sort((a, b) => new Date(a.observation.created).getTime() - new Date(b.observation.created).getTime())
				.slice(0, limit);

			const observations = await Promise.all(filtered.map(async r => {
				const base: Record<string, unknown> = {
					id: r.observation.id,
					territory: r.territory,
					essence: extractEssence(r.observation),
					charge: r.observation.texture?.charge || [],
					grip: r.observation.texture?.grip,
					charge_phase: r.observation.texture?.charge_phase,
					created: r.observation.created,
					entity_id: r.observation.entity_id
				};

				if (args.include_versions) {
					base.versions = await storage.getVersionHistory(r.observation.id);
				}

				return base;
			}));

			return {
				search_mode: "chronological",
				filters: {
					entity_id: entityId,
					territory: args.territory,
					start_date: args.start_date,
					end_date: args.end_date,
					charge: args.charge
				},
				count: observations.length,
				observations,
				hint: "Use mind_pull(id) for full content"
			};
		}

		default:
			throw new Error(`Unknown timeline tool: ${name}`);
	}
}
