// ============ DAEMON TASK: RECALL CONTRACTS ============
// Prevents "remember to remember" drift by materializing due recall contracts.
// Contracts can be attached to conversation context or project dossier metadata.
// - scope=task     -> create open task directly (deduped by source)
// - scope=proposal -> create reviewable recall_contract proposal

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";
import type { ProjectDossier, Task } from "../../types";

const MAX_TASK_SCAN = 300;
const MAX_PROJECT_SCAN = 100;
const MIN_RECALL_AFTER_HOURS = 1;
const MAX_RECALL_AFTER_HOURS = 24 * 30;

const PRIORITIES: Task["priority"][] = ["burning", "high", "normal", "low", "someday"];

type RecallScope = "task" | "proposal";

interface DueRecallContract {
	contract_id: string;
	title: string;
	note?: string;
	recall_after_hours: number;
	scope: RecallScope;
	priority: Task["priority"];
	linked_entity_ids: string[];
	anchor_at: string;
	due_at: string;
	origin: "context" | "project";
	proposal_source_id: string;
	proposal_target_id: string;
}

export async function runRecallContractsTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	const nowIso = new Date().toISOString();
	const nowMs = new Date(nowIso).getTime();

	const [contextRaw, projects, openTasks, scheduledTasks, inProgressTasks] = await Promise.all([
		storage.readConversationContext(),
		storage.listProjectDossiers({ lifecycle_status: "active", limit: MAX_PROJECT_SCAN }),
		storage.listTasks("open", undefined, MAX_TASK_SCAN, true),
		storage.listTasks("scheduled", undefined, MAX_TASK_SCAN, true),
		storage.listTasks("in_progress", undefined, MAX_TASK_SCAN, true)
	]);

	const activeTaskSources = new Set(
		[...openTasks, ...scheduledTasks, ...inProgressTasks]
			.map(task => task.source)
			.filter((source): source is string => typeof source === "string" && source.length > 0)
	);

	const dueContracts: DueRecallContract[] = [];
	dueContracts.push(...collectContextContracts(contextRaw, nowIso, nowMs));
	dueContracts.push(...collectProjectContracts(projects, nowIso, nowMs));

	let changes = 0;
	let proposals_created = 0;

	for (const contract of dueContracts) {
		const taskSource = `recall_contract:${contract.contract_id}`;

		if (contract.scope === "task") {
			if (activeTaskSources.has(taskSource)) continue;

			await storage.createTask({
				title: contract.title,
				description: buildTaskDescription(contract),
				status: "open",
				priority: contract.priority,
				source: taskSource,
				linked_observation_ids: [],
				linked_entity_ids: contract.linked_entity_ids
			});

			activeTaskSources.add(taskSource);
			changes++;
			continue;
		}

		const exists = await storage.proposalExists("recall_contract", contract.proposal_source_id, contract.proposal_target_id);
		if (exists) continue;

		await storage.createProposal({
			tenant_id: storage.getTenant(),
			proposal_type: "recall_contract",
			source_id: contract.proposal_source_id,
			target_id: contract.proposal_target_id,
			confidence: 0.8,
			rationale: `Recall contract due (${contract.origin})`,
			metadata: {
				title: contract.title,
				description: buildTaskDescription(contract),
				priority: contract.priority,
				source: taskSource,
				linked_entity_ids: contract.linked_entity_ids,
				linked_observation_ids: [],
				origin: contract.origin,
				anchor_at: contract.anchor_at,
				due_at: contract.due_at,
				recall_after_hours: contract.recall_after_hours
			},
			status: "pending"
		});

		proposals_created++;
		changes++;
	}

	return {
		task: "recall-contracts",
		changes,
		proposals_created
	};
}

function collectContextContracts(contextRaw: unknown, nowIso: string, nowMs: number): DueRecallContract[] {
	if (!contextRaw || typeof contextRaw !== "object" || Array.isArray(contextRaw)) return [];
	const context = contextRaw as Record<string, unknown>;
	const anchorAt = normalizeIso(context.timestamp) ?? nowIso;
	const contractsRaw = Array.isArray(context.recall_contracts) ? context.recall_contracts : [];

	const due: DueRecallContract[] = [];
	for (let i = 0; i < contractsRaw.length; i++) {
		const normalized = normalizeContract(contractsRaw[i], {
			fallbackId: `ctx_${i + 1}`,
			fallbackTitle: `Recall thread ${i + 1}`,
			anchorAt,
			origin: "context",
			linkedEntityIds: []
		});
		if (!normalized) continue;
		if (!isDue(normalized.anchor_at, normalized.recall_after_hours, nowMs)) continue;
		due.push(normalized);
	}
	return due;
}

function collectProjectContracts(projects: ProjectDossier[], nowIso: string, nowMs: number): DueRecallContract[] {
	const due: DueRecallContract[] = [];

	for (const project of projects) {
		const metadata = (project.metadata && typeof project.metadata === "object" && !Array.isArray(project.metadata))
			? project.metadata as Record<string, unknown>
			: {};

		const rawContracts = Array.isArray(metadata.recall_contracts)
			? metadata.recall_contracts
			: (metadata.recall_contract ? [metadata.recall_contract] : []);

		if (!Array.isArray(rawContracts) || rawContracts.length === 0) continue;

		const baseAnchor = normalizeIso(project.last_active_at)
			?? normalizeIso(project.updated_at)
			?? nowIso;

		for (let i = 0; i < rawContracts.length; i++) {
			const normalized = normalizeContract(rawContracts[i], {
				fallbackId: `project_${project.project_entity_id}_${i + 1}`,
				fallbackTitle: `Recall project ${project.project_entity_id}`,
				anchorAt: baseAnchor,
				origin: "project",
				linkedEntityIds: [project.project_entity_id]
			});
			if (!normalized) continue;
			if (!normalized.linked_entity_ids.includes(project.project_entity_id)) {
				normalized.linked_entity_ids.push(project.project_entity_id);
			}
			if (!isDue(normalized.anchor_at, normalized.recall_after_hours, nowMs)) continue;
			due.push(normalized);
		}
	}

	return due;
}

function normalizeContract(
	raw: unknown,
	defaults: {
		fallbackId: string;
		fallbackTitle: string;
		anchorAt: string;
		origin: "context" | "project";
		linkedEntityIds: string[];
	}
): DueRecallContract | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;

	const title = cleanString(obj.title) ?? defaults.fallbackTitle;
	const recallAfter = normalizeRecallHours(obj.recall_after_hours);
	if (recallAfter == null) return null;

	const contractId = toSafeToken(cleanString(obj.id) ?? defaults.fallbackId, defaults.fallbackId);
	const scope = normalizeScope(obj.scope) ?? "task";
	const priority = normalizePriority(obj.priority) ?? "normal";
	const linkedEntityIds = uniqueStrings([
		...defaults.linkedEntityIds,
		...toStringArraySafe(obj.linked_entity_ids)
	]);
	const anchorAt = normalizeIso(obj.anchor_at) ?? defaults.anchorAt;
	const dueAt = new Date(new Date(anchorAt).getTime() + recallAfter * 60 * 60 * 1000).toISOString();
	const proposalSourceId = toSafeToken(`${defaults.origin}_${contractId}`, `${defaults.origin}_${contractId}`);
	const proposalTargetId = toSafeToken(linkedEntityIds[0] ?? `${defaults.origin}_recall`, `${defaults.origin}_recall`);

	return {
		contract_id: contractId,
		title,
		note: cleanString(obj.note),
		recall_after_hours: recallAfter,
		scope,
		priority,
		linked_entity_ids: linkedEntityIds,
		anchor_at: anchorAt,
		due_at: dueAt,
		origin: defaults.origin,
		proposal_source_id: proposalSourceId,
		proposal_target_id: proposalTargetId
	};
}

function buildTaskDescription(contract: DueRecallContract): string {
	const details = [
		`Recall contract origin: ${contract.origin}`,
		`Contract id: ${contract.contract_id}`,
		`Anchor: ${contract.anchor_at}`,
		`Due: ${contract.due_at}`,
		`Window: ${contract.recall_after_hours}h`
	];
	if (contract.note) details.push(`Note: ${contract.note}`);
	return details.join("\n");
}

function normalizeRecallHours(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
	if (value < MIN_RECALL_AFTER_HOURS || value > MAX_RECALL_AFTER_HOURS) return null;
	return value;
}

function normalizeScope(value: unknown): RecallScope | undefined {
	if (value === "task" || value === "proposal") return value;
	return undefined;
}

function normalizePriority(value: unknown): Task["priority"] | undefined {
	if (typeof value !== "string") return undefined;
	return PRIORITIES.includes(value as Task["priority"]) ? value as Task["priority"] : undefined;
}

function isDue(anchorIso: string, recallAfterHours: number, nowMs: number): boolean {
	const anchorMs = new Date(anchorIso).getTime();
	if (Number.isNaN(anchorMs)) return false;
	const dueMs = anchorMs + recallAfterHours * 60 * 60 * 1000;
	return nowMs >= dueMs;
}

function normalizeIso(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const stamp = new Date(value);
	if (Number.isNaN(stamp.getTime())) return null;
	return stamp.toISOString();
}

function cleanString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function toStringArraySafe(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map(item => item.trim())
		.filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) continue;
		seen.add(value);
		out.push(value);
	}
	return out;
}

function toSafeToken(value: string, fallback: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 64);
	return sanitized || fallback;
}
