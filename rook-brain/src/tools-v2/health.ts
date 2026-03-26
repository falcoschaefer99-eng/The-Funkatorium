// ============ HEALTH TOOL (v2) ============
// mind_health — system health and daemon intelligence diagnostics.
// section=all|proposals|orphans|embeddings|cascade

import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_health",
		description: "Brain system health and daemon intelligence diagnostics. section=all: full snapshot. section=proposals: proposal stats + current threshold. section=orphans: orphan counts and age. section=embeddings: embedding coverage. section=cascade: top memory cascade observation pairs.",
		inputSchema: {
			type: "object",
			properties: {
				section: {
					type: "string",
					enum: ["all", "proposals", "orphans", "embeddings", "cascade"],
					default: "all",
					description: "Which section of health data to return"
				}
			},
			required: []
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;

	switch (name) {
		case "mind_health": {
			const section = args.section ?? "all";

			const include = {
				proposals: section === "all" || section === "proposals",
				orphans: section === "all" || section === "orphans",
				embeddings: section === "all" || section === "embeddings",
				cascade: section === "all" || section === "cascade"
			};

			const result: Record<string, unknown> = {};

			// Run all requested sections in parallel
			const tasks: Promise<void>[] = [];

			if (include.embeddings) {
				tasks.push(
					storage.getEmbeddingCoverage().then(coverage => {
						const pct = coverage.total > 0
							? Math.round((coverage.embedded / coverage.total) * 100)
							: 0;
						result.embeddings = {
							total: coverage.total,
							embedded: coverage.embedded,
							missing: coverage.total - coverage.embedded,
							coverage_pct: pct
						};
					})
				);
			}

			if (include.proposals) {
				tasks.push(
					Promise.all([
						storage.getProposalStats(),
						storage.readDaemonConfig()
					]).then(([stats, config]) => {
						result.proposals = {
							current_threshold: config.link_proposal_threshold,
							last_threshold_update: config.last_threshold_update ?? null,
							tenant_weights: {
						charge_weight: config.data.charge_weight ?? null,
						similarity_weight: config.data.similarity_weight ?? null,
						entity_weight: config.data.entity_weight ?? null
					},
							stats_by_type: stats
						};
					})
				);
			}

			if (include.orphans) {
				tasks.push(
					storage.getOrphanStats().then(stats => {
						result.orphans = stats;
					})
				);
			}

			if (include.cascade) {
				tasks.push(
					storage.getTopCascadePairs(10).then(pairs => {
						result.cascade = {
							top_pairs: pairs
						};
					})
				);
			}

			await Promise.all(tasks);

			return { tenant: storage.getTenant(), ...result };
		}

		default:
			throw new Error(`Unknown health tool: ${name}`);
	}
}
