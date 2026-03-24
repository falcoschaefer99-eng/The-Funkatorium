// ============ SEARCH TOOL (v2) ============
// mind_search — hybrid search (vector + full-text) with Neural Surfacing v1 modulation.
// Backward-compatible tool interface: same input params, enriched output.

import { TERRITORIES } from "../constants";
import { extractEssence, getCurrentCircadianPhase } from "../helpers";
import type { ToolContext } from "./context";
import { createEmbeddingProvider } from "../embedding/index";

export const TOOL_DEFS = [
	{
		name: "mind_search",
		description: "Search memories by content, charges, and somatic markers. Uses hybrid vector + keyword search with Neural Surfacing modulation (grip, novelty, circadian bias). Use for finding specific memories by topic, person, feeling, or event.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Keywords or natural language to search for" },
				territory: { type: "string", enum: [...Object.keys(TERRITORIES), "all"], default: "all", description: "Filter to one territory or 'all'" },
				limit: { type: "number", default: 10, description: "Max results" },
				grip_filter: { type: "string", enum: ["iron", "strong", "present", "loose", "dormant"], description: "Optional: only return observations at this grip level or stronger" }
			},
			required: ["query"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_search": {
			const query: string = args.query || "";
			if (!query.trim()) {
				return { query, scope: args.territory || "all", results: [], total_matches: 0, hint: "Query too short — use longer keywords" };
			}

			const limit = Math.min(args.limit || 10, 50);
			const territory = (!args.territory || args.territory === "all") ? undefined : args.territory;

			// Optional grip filter — translate to array for hybridSearch
			const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
			let gripFilter: string[] | undefined;
			if (args.grip_filter) {
				const minLevel = gripOrder[args.grip_filter] ?? 4;
				gripFilter = Object.keys(gripOrder).filter(g => gripOrder[g] <= minLevel);
			}

			// Generate query embedding if AI binding is available.
			let embedding: number[] | undefined;
			if (context.ai) {
				try {
					const provider = createEmbeddingProvider(context.ai);
					embedding = await provider.embedText(query);
				} catch (err) {
					// Embedding failure is non-fatal — fall back to keyword-only.
					console.error("mind_search embed failed:", err instanceof Error ? err.message : "unknown error");
				}
			}

			// Get circadian phase for territory bias modulation.
			const circadianInfo = getCurrentCircadianPhase();

			const hybridResults = await context.storage.hybridSearch({
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
							context.storage.recordCoSurfacing(returnedIds),
							context.storage.updateSurfacingEffects(returnedIds)
						]).catch(err => console.error("hybridSearch side effects failed:", err instanceof Error ? err.message : "unknown error"))
					);
				}
			}

			const finalResults = hybridResults.map(r => ({
				id: r.observation.id,
				territory: r.territory,
				essence: extractEssence(r.observation),
				charge: r.observation.texture?.charge || [],
				grip: r.observation.texture?.grip,
				match_in: r.match_sources,
				score: Math.round(r.score * 100) / 100
			}));

			return {
				query,
				scope: args.territory || "all territories",
				results: finalResults,
				total_matches: finalResults.length,
				hint: "Use mind_pull(id) for full content"
			};
		}

		default:
			throw new Error(`Unknown search tool: ${name}`);
	}
}
