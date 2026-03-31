// ============ DAEMON ORCHESTRATOR (Sprint 4 + Sprint 6 + Sprint 7) ============
// Runs all daemon intelligence tasks in order.
// Execution order: proposals → learning → cascade → orphans → kit-hygiene → skill-health → cross-agent → cross-tenant → paradox-detection → recall-contracts → task-scheduling.
// Proposals first — it's the primary feature and uses the fewest subrequests.
// Each task is isolated — failures don't cascade.

import type { IBrainStorage } from "../storage/interface";
import type { IEmbeddingProvider } from "../embedding/interface";
import type { DaemonTaskResult } from "./types";

import { runCascadeTask } from "./tasks/cascade";
import { runOrphanTask } from "./tasks/orphans";
import { runProposalTask } from "./tasks/proposals";
import { runLearningTask } from "./tasks/learning";
import { runKitHygieneTask } from "./tasks/kit-hygiene";
import { runSkillHealthTask } from "./tasks/skill-health";
import { runCrossAgentTask } from "./tasks/cross-agent";
import { runCrossTenantTask } from "./tasks/cross-tenant";
import { runParadoxDetectionTask } from "./tasks/paradox-detection";
import { runRecallContractsTask } from "./tasks/recall-contracts";
import { runTaskSchedulingTask } from "./tasks/task-scheduling";

export async function runDaemonTasks(
	storage: IBrainStorage,
	embedding?: IEmbeddingProvider
): Promise<DaemonTaskResult[]> {
	const results: DaemonTaskResult[] = [];

	// 1. Proposals — generate link proposals from vector similarity
	try {
		const result = await runProposalTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "proposals",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 2. Learning — adaptive threshold adjustment
	try {
		const result = await runLearningTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "learning",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 3. Memory cascade — record charge-based co-occurrence pairs
	try {
		const result = await runCascadeTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "cascade",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 4. Orphans — detect and attempt rescue
	try {
		const result = await runOrphanTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "orphans",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 5. Kit hygiene — per-agent consolidation and dedup proposals
	try {
		const result = await runKitHygieneTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "kit-hygiene",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 6. Skill health — stale accepted skills + candidate drift proposals
	try {
		const result = await runSkillHealthTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "skill-health",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 7. Cross-agent synthesis — convergent findings across different agent entities
	try {
		const result = await runCrossAgentTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "cross-agent",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 8. Cross-tenant proposals — shared territory convergence (craft, philosophy only)
	try {
		const result = await runCrossTenantTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "cross-tenant",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 9. Paradox detection — identity cores challenged 3+ times without a paradox loop
	try {
		const result = await runParadoxDetectionTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "paradox-detection",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 10. Recall contracts — materialize due recall contracts into tasks/proposals
	try {
		const result = await runRecallContractsTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "recall-contracts",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 11. Task scheduling — advance scheduled tasks to open when their scheduled_wake passes
	try {
		const result = await runTaskSchedulingTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "task-scheduling",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	return results;
}
