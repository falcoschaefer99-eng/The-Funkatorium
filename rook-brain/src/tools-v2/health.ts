// ============ HEALTH TOOL (v2) ============
// mind_health — system health and daemon intelligence diagnostics.
// section=all|proposals|orphans|embeddings|cascade|dispatch|runtime|skills

import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_health",
		description: "Brain system health and daemon intelligence diagnostics. section=all: full snapshot. section=proposals: proposal stats + current threshold. section=orphans: orphan counts and age. section=embeddings: embedding coverage. section=cascade: top memory cascade observation pairs. section=runtime: autonomous session, policy, usage counters, and recent run ledger. section=skills: captured skill registry lifecycle + provenance coverage.",
		inputSchema: {
			type: "object",
			properties: {
				section: {
					type: "string",
					enum: ["all", "proposals", "orphans", "embeddings", "cascade", "dispatch", "runtime", "skills"],
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
				cascade: section === "all" || section === "cascade",
				dispatch: section === "all" || section === "dispatch",
				runtime: section === "all" || section === "runtime",
				skills: section === "all" || section === "skills"
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

			if (include.dispatch) {
				tasks.push(
					storage.getDispatchStats().then(stats => {
						result.dispatch = {
							by_task_type: stats
						};
					})
				);
			}

			if (include.runtime) {
				const runtimeWindowStart = new Date();
				runtimeWindowStart.setUTCHours(0, 0, 0, 0);
				tasks.push(
					Promise.all([
						storage.getAgentRuntimeSession(storage.getTenant()),
						storage.listAgentRuntimeRuns(storage.getTenant(), 5),
						storage.getAgentRuntimePolicy(storage.getTenant()),
						storage.getAgentRuntimeUsage(storage.getTenant(), runtimeWindowStart.toISOString())
					]).then(([session, runs, policy, usage]) => {
						result.runtime = {
							has_session: session != null,
							session,
							policy,
							usage_window_start: runtimeWindowStart.toISOString(),
							usage_today: usage,
							recent_runs: runs
						};
					})
				);
			}

			if (include.skills) {
				tasks.push(
					Promise.all([
						storage.getCapturedSkillRegistryHealth(),
						storage.listCapturedSkillArtifacts({ status: "candidate", limit: 5 })
					]).then(([registry, recentCandidates]) => {
						result.skills = {
							registry,
							recent_candidates: recentCandidates.map(skill => ({
								id: skill.id,
								skill_key: skill.skill_key,
								version: skill.version,
								name: skill.name,
								status: skill.status,
								layer: skill.layer,
								agent_tenant: skill.agent_tenant,
								source_runtime_run_id: skill.source_runtime_run_id,
								source_task_id: skill.source_task_id,
								created_at: skill.created_at
							}))
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
