// ============ TASKS TOOL (v2) ============
// mind_task — create, list, get, update, and complete tasks.
// Cross-tenant delegation and scheduled wake support.

import type { Task, Letter } from "../types";
import { ALLOWED_TENANTS } from "../constants";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import type { ToolContext } from "./context";
import { cleanText } from "./utils";

const TASK_STATUSES = ["open", "scheduled", "in_progress", "done", "deferred", "cancelled"] as const;
const TASK_PRIORITIES = ["burning", "high", "normal", "low", "someday"] as const;

const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 4000;
const MAX_TASK_SOURCE_LENGTH = 120;
const MAX_TASK_ESTIMATED_EFFORT_LENGTH = 120;
const MAX_TASK_COMPLETION_NOTE_LENGTH = 2000;
const MAX_ARTIFACT_PATH_LENGTH = 1000;

export const TOOL_DEFS = [
	{
		name: "mind_task",
		description: "Manage tasks. action=create creates a task. action=create_dual creates executor+reviewer task pairs. action=list lists tasks with optional filters. action=get fetches a single task. action=update modifies a task. action=complete marks a task done.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "create_dual", "list", "get", "update", "complete"],
					description: "create: new task. create_dual: executor + reviewer task pair. list: list tasks. get: single task by id. update: modify task fields. complete: mark done."
				},
				// create params
				title: { type: "string", description: "[create/create_dual/update] Task title" },
				description: { type: "string", description: "[create/create_dual/update] Task description" },
				reviewer_title: { type: "string", description: "[create_dual] Reviewer task title (defaults to 'Review: <title>')" },
				reviewer_description: { type: "string", description: "[create_dual] Reviewer task description" },
				priority: {
					type: "string",
					enum: ["burning", "high", "normal", "low", "someday"],
					description: "[create/create_dual/update] Task priority (default: normal)"
				},
				assigned_tenant: { type: "string", description: "[create/create_dual] Cross-tenant delegation — assign this task to another tenant" },
				scheduled_wake: { type: "string", description: "[create/create_dual/update] ISO timestamp for self-scheduling" },
				source: { type: "string", description: "[create/create_dual] Where this task came from" },
				linked_observation_ids: { type: "array", items: { type: "string" }, description: "[create/create_dual] Observation IDs to link" },
				linked_entity_ids: { type: "array", items: { type: "string" }, description: "[create/create_dual] Entity IDs to link" },
				depends_on: { type: "array", items: { type: "string" }, description: "[create/create_dual] Task IDs this task depends on" },
				estimated_effort: { type: "string", description: "[create/create_dual/update] Effort estimate (e.g., '2h', '1d')" },
				// list params
				status: {
					type: "string",
					enum: ["open", "scheduled", "in_progress", "done", "deferred", "cancelled"],
					description: "[list] Filter by status"
				},
				assigned: { type: "boolean", description: "[list] If true, show tasks assigned TO this tenant from others" },
				limit: { type: "number", description: "[list] Max results (default 20)" },
				// get/update/complete params
				id: { type: "string", description: "[get/update/complete] Task ID" },
				// update/complete params
				completion_note: { type: "string", description: "[update/complete] Note on how or why the task was completed" },
				artifact_path: { type: "string", description: "[update/complete] Exact path to the produced artifact" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_task": {
			const action = args.action;
			const storage = context.storage;

			switch (action) {
				case "create": {
					const createInput = validateCreateTaskInput(args, storage);
					if ("error" in createInput) return { error: createInput.error };

					const task = await storage.createTask({
						title: createInput.title,
						description: createInput.description,
						status: createInput.status,
						priority: createInput.priority,
						assigned_tenant: createInput.assigned_tenant,
						scheduled_wake: createInput.scheduled_wake,
						source: createInput.source,
						linked_observation_ids: createInput.linked_observation_ids,
						linked_entity_ids: createInput.linked_entity_ids,
						depends_on: createInput.depends_on,
						estimated_effort: createInput.estimated_effort
					});

					return { created: true, task };
				}

				case "create_dual": {
					if (!args.assigned_tenant) return { error: "assigned_tenant is required for action=create_dual" };
					const createInput = validateCreateTaskInput(args, storage);
					if ("error" in createInput) return { error: createInput.error };

					// Executor stays local to the current tenant; only the reviewer task is cross-tenant.
					const executorTask = await storage.createTask({
						title: createInput.title,
						description: createInput.description,
						status: createInput.status,
						priority: createInput.priority,
						scheduled_wake: createInput.scheduled_wake,
						source: createInput.source,
						linked_observation_ids: createInput.linked_observation_ids,
						linked_entity_ids: createInput.linked_entity_ids,
						depends_on: createInput.depends_on,
						estimated_effort: createInput.estimated_effort
					});

					const reviewerTitle = normalizeReviewerTitle(args.reviewer_title, createInput.title);
					if (reviewerTitle.length > MAX_TASK_TITLE_LENGTH) {
						return { error: `reviewer_title too long (max ${MAX_TASK_TITLE_LENGTH} chars)` };
					}
					const reviewerDescriptionLengthError = validateTextLength("reviewer_description", args.reviewer_description, MAX_TASK_DESCRIPTION_LENGTH);
					if (reviewerDescriptionLengthError) return { error: reviewerDescriptionLengthError };
					const reviewerDescription = cleanText(args.reviewer_description)
						?? buildDefaultReviewerDescription(createInput.title, executorTask.id, createInput.description);

					const reviewerTask = await storage.createTask({
						title: reviewerTitle,
						description: reviewerDescription,
						status: "open",
						priority: createInput.priority,
						assigned_tenant: createInput.assigned_tenant,
						source: createInput.source,
						linked_observation_ids: createInput.linked_observation_ids,
						linked_entity_ids: createInput.linked_entity_ids,
						depends_on: [executorTask.id],
						estimated_effort: createInput.estimated_effort
					});

					return {
						created: true,
						dual: true,
						executor_task: executorTask,
						reviewer_task: reviewerTask
					};
				}

				case "list": {
					if (args.status !== undefined && !normalizeTaskStatus(args.status)) {
						return { error: `status must be one of: ${TASK_STATUSES.join(", ")}` };
					}
					if (args.priority !== undefined && !normalizeTaskPriority(args.priority)) {
						return { error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
					}

					const tasks = await storage.listTasks(
						normalizeTaskStatus(args.status),
						normalizeTaskPriority(args.priority),
						args.limit ?? 20,
						args.assigned === true
					);
					return { tasks, count: tasks.length };
				}

				case "get": {
					if (!args.id) return { error: "id is required for action=get" };

					const task = await storage.getTask(args.id, true);
					if (!task) return { error: `Task not found: ${args.id}` };

					return { task };
				}

				case "update": {
					if (!args.id) return { error: "id is required for action=update" };
					const existing = await storage.getTask(args.id, true);
					if (!existing) return { error: `Task not found: ${args.id}` };
					const isAssignedTask = isAssignedTaskForCurrentTenant(existing, storage.getTenant());
					if (args.title !== undefined && !args.title.trim()) {
						return { error: "title cannot be empty" };
					}
					if (args.title !== undefined && args.title.trim().length > MAX_TASK_TITLE_LENGTH) {
						return { error: `title too long (max ${MAX_TASK_TITLE_LENGTH} chars)` };
					}
					if (args.status !== undefined && !normalizeTaskStatus(args.status)) {
						return { error: `status must be one of: ${TASK_STATUSES.join(", ")}` };
					}
					if (args.priority !== undefined && !normalizeTaskPriority(args.priority)) {
						return { error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
					}
					const descriptionLengthError = validateTextLength("description", args.description, MAX_TASK_DESCRIPTION_LENGTH);
					if (descriptionLengthError) return { error: descriptionLengthError };
					const effortLengthError = validateTextLength("estimated_effort", args.estimated_effort, MAX_TASK_ESTIMATED_EFFORT_LENGTH);
					if (effortLengthError) return { error: effortLengthError };
					const artifactPathResult = normalizeArtifactPath(args.artifact_path);
					if (artifactPathResult.error) return { error: artifactPathResult.error };
					const resolvedCompletionNote = buildCompletionNote(args.completion_note, artifactPathResult.value);
					const completionNoteLengthError = validateTextLength("completion_note", resolvedCompletionNote, MAX_TASK_COMPLETION_NOTE_LENGTH);
					if (completionNoteLengthError) return { error: completionNoteLengthError };

					const scheduledWakeResult = normalizeScheduledWake(args.scheduled_wake);
					if (scheduledWakeResult.error) return { error: scheduledWakeResult.error };
					const scheduledWake = args.scheduled_wake !== undefined ? scheduledWakeResult.value : undefined;
					const effectiveScheduledWake = args.scheduled_wake !== undefined
						? scheduledWake
						: existing.scheduled_wake;
					if (args.status === "scheduled" && !isValidScheduledWake(effectiveScheduledWake)) {
						return { error: "scheduled_wake is required and must be a valid timestamp when status is scheduled" };
					}

					if (isAssignedTask) {
						const forbiddenFields = [
							"title",
							"description",
							"priority",
							"estimated_effort",
							"scheduled_wake"
						].filter(field => args[field] !== undefined);

						if (forbiddenFields.length > 0) {
							return { error: `Delegated task assignees cannot update ${forbiddenFields.join(", ")}.` };
						}

						if (args.completion_note !== undefined || args.status === "done" || args.artifact_path !== undefined) {
							return { error: "Use action=complete to finish a delegated task and notify the assigning tenant." };
						}
					}

					const updates: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "estimated_effort" | "scheduled_wake" | "completion_note" | "completed_at">> = {};
					if (args.title !== undefined) updates.title = args.title.trim();
					if (args.description !== undefined) updates.description = args.description;
					if (args.status !== undefined) updates.status = normalizeTaskStatus(args.status);
					if (args.priority !== undefined) updates.priority = normalizeTaskPriority(args.priority);
					if (args.estimated_effort !== undefined) updates.estimated_effort = args.estimated_effort;
					if (args.scheduled_wake !== undefined) updates.scheduled_wake = scheduledWake;
					if (resolvedCompletionNote !== undefined) updates.completion_note = resolvedCompletionNote;

					if (Object.keys(updates).length === 0) return { error: "No fields to update" };

					try {
						const updated = await storage.updateTask(args.id, updates, isAssignedTask);
						return { updated: true, task: updated };
					} catch (err) {
						return { error: err instanceof Error ? err.message : "Failed to update task" };
					}
				}

				case "complete": {
					if (!args.id) return { error: "id is required for action=complete" };
					const artifactPathResult = normalizeArtifactPath(args.artifact_path);
					if (artifactPathResult.error) return { error: artifactPathResult.error };
					const completionNote = buildCompletionNote(args.completion_note, artifactPathResult.value);
					const completionNoteLengthError = validateTextLength("completion_note", completionNote, MAX_TASK_COMPLETION_NOTE_LENGTH);
					if (completionNoteLengthError) return { error: completionNoteLengthError };

					const existing = await storage.getTask(args.id, true);
					if (!existing) return { error: `Task not found: ${args.id}` };
					const isAssignedTask = isAssignedTaskForCurrentTenant(existing, storage.getTenant());

					const updated = await storage.updateTask(args.id, {
						status: "done",
						completion_note: completionNote,
						completed_at: getTimestamp()
					}, isAssignedTask);
					const unblocked = await findUnblockedDependentTasks(storage, args.id);

					// If we're the assignee completing a cross-tenant task, notify the assigner
					if (isAssignedTask) {
						const recipientStorage = storage.forTenant(existing.tenant_id);
						const letter: Letter = {
							id: generateId("letter"),
							from_context: storage.getTenant(),
							to_context: "chat",
							content: `Task completed: "${existing.title}"${completionNote ? ` — ${completionNote}` : ""}`,
							timestamp: getTimestamp(),
							read: false,
							charges: [],
							letter_type: "handoff"
						};
						try {
							await recipientStorage.appendLetter(letter);
							return {
								completed: true,
								task: updated,
								notified: existing.tenant_id,
								unblocked_tasks: unblocked.tasks,
								unblocked_assigned_tenants: unblocked.assigned_tenants
							};
						} catch (err) {
							return {
								completed: true,
								task: updated,
								notification_target: existing.tenant_id,
								notification_error: err instanceof Error ? err.message : "Failed to send completion notification",
								unblocked_tasks: unblocked.tasks,
								unblocked_assigned_tenants: unblocked.assigned_tenants
							};
						}
					}

					return {
						completed: true,
						task: updated,
						unblocked_tasks: unblocked.tasks,
						unblocked_assigned_tenants: unblocked.assigned_tenants
					};
				}

				default:
					return { error: `Unknown action: ${action}. Must be create, create_dual, list, get, update, or complete.` };
			}
		}

		default:
			throw new Error(`Unknown tasks tool: ${name}`);
	}
}

function isAssignedTaskForCurrentTenant(task: Task, tenant: string): boolean {
	return task.assigned_tenant === tenant && task.tenant_id !== tenant;
}

async function findUnblockedDependentTasks(
	storage: ToolContext["storage"],
	completedTaskId: string
): Promise<{ tasks: Task[]; assigned_tenants: string[] }> {
	if (typeof storage.listTasks !== "function") {
		return { tasks: [], assigned_tenants: [] };
	}

	const visibleOpenTasks = await storage.listTasks("open", undefined, 200, true);
	const dependents = visibleOpenTasks.filter(task => task.depends_on?.includes(completedTaskId));
	if (dependents.length === 0) {
		return { tasks: [], assigned_tenants: [] };
	}

	const tasks: Task[] = [];
	for (const task of dependents) {
		if (!task.depends_on || task.depends_on.length === 0) {
			tasks.push(task);
			continue;
		}

		let allDone = true;
		for (const dependencyId of task.depends_on) {
			if (dependencyId === completedTaskId) continue;
			const dependency = await storage.getTask(dependencyId, true);
			if (!dependency || dependency.status !== "done") {
				allDone = false;
				break;
			}
		}

		if (allDone) tasks.push(task);
	}

	const assignedTenants = Array.from(new Set(
		tasks
			.map(task => task.assigned_tenant)
			.filter((tenant): tenant is string => typeof tenant === "string" && tenant.trim().length > 0)
	));

	return { tasks, assigned_tenants: assignedTenants };
}

function validateTextLength(field: string, value: unknown, maxLength: number): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") return `${field} must be a string`;
	if (value.length > maxLength) return `${field} too long (max ${maxLength} chars)`;
	return undefined;
}

function normalizeScheduledWake(value: unknown): { value?: string; error?: string } {
	if (value === undefined) return {};
	if (typeof value !== "string") return { error: "scheduled_wake must be a string" };

	const trimmed = value.trim();
	if (!trimmed) return { error: "scheduled_wake cannot be blank" };

	const timestamp = new Date(trimmed);
	if (Number.isNaN(timestamp.getTime())) {
		return { error: "scheduled_wake must be a valid timestamp" };
	}

	return { value: timestamp.toISOString() };
}

function isValidScheduledWake(value?: string): boolean {
	if (!value) return false;
	return !Number.isNaN(new Date(value).getTime());
}

function normalizeTaskStatus(value: unknown): Task["status"] | undefined {
	if (typeof value !== "string") return undefined;
	return TASK_STATUSES.includes(value as Task["status"]) ? value as Task["status"] : undefined;
}

function normalizeTaskPriority(value: unknown): Task["priority"] | undefined {
	if (typeof value !== "string") return undefined;
	return TASK_PRIORITIES.includes(value as Task["priority"]) ? value as Task["priority"] : undefined;
}

function normalizeArtifactPath(value: unknown): { value?: string; error?: string } {
	if (value === undefined) return {};
	if (typeof value !== "string") return { error: "artifact_path must be a string" };
	const artifactPath = cleanText(value);
	if (!artifactPath) return { error: "artifact_path cannot be blank" };
	if (artifactPath.length > MAX_ARTIFACT_PATH_LENGTH) {
		return { error: `artifact_path too long (max ${MAX_ARTIFACT_PATH_LENGTH} chars)` };
	}
	return { value: artifactPath };
}

function buildCompletionNote(noteValue: unknown, artifactPath?: string): string | undefined {
	const note = cleanText(noteValue);
	if (!note && !artifactPath) return undefined;
	return [note, artifactPath ? `Artifact path: ${artifactPath}` : undefined]
		.filter((value): value is string => Boolean(value))
		.join("\n");
}

function normalizeReviewerTitle(value: unknown, title: string): string {
	const reviewerTitle = cleanText(value);
	return reviewerTitle ?? `Review: ${title}`;
}

function buildDefaultReviewerDescription(title: string, executorTaskId: string, description?: string): string {
	const base = `Review and finalize the artifact produced for "${title}". Wait until executor task ${executorTaskId} is complete, then inspect its completion note for the artifact path before reviewing.`;
	return description ? [base, `Executor brief: ${description}`].join("\n\n") : base;
}

function isAllowedTenant(value: string): value is typeof ALLOWED_TENANTS[number] {
	return ALLOWED_TENANTS.includes(value as typeof ALLOWED_TENANTS[number]);
}

function validateCreateTaskInput(
	args: any,
	storage: ToolContext["storage"]
): {
	title: string;
	description: string | undefined;
	status: Task["status"];
	priority: Task["priority"];
	assigned_tenant: string | undefined;
	scheduled_wake: string | undefined;
	source: string | undefined;
	linked_observation_ids: string[];
	linked_entity_ids: string[];
	depends_on: string[] | undefined;
	estimated_effort: string | undefined;
} | { error: string } {
	if (!args.title?.trim()) return { error: `title is required for action=${args.action === "create_dual" ? "create_dual" : "create"}` };
	const title = args.title.trim();
	if (title.length > MAX_TASK_TITLE_LENGTH) {
		return { error: `title too long (max ${MAX_TASK_TITLE_LENGTH} chars)` };
	}
	const scheduledWakeResult = normalizeScheduledWake(args.scheduled_wake);
	if (scheduledWakeResult.error) return { error: scheduledWakeResult.error };
	const scheduledWake = scheduledWakeResult.value;
	if (args.priority !== undefined && !normalizeTaskPriority(args.priority)) {
		return { error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` };
	}
	const descriptionLengthError = validateTextLength("description", args.description, MAX_TASK_DESCRIPTION_LENGTH);
	if (descriptionLengthError) return { error: descriptionLengthError };
	const sourceLengthError = validateTextLength("source", args.source, MAX_TASK_SOURCE_LENGTH);
	if (sourceLengthError) return { error: sourceLengthError };
	const effortLengthError = validateTextLength("estimated_effort", args.estimated_effort, MAX_TASK_ESTIMATED_EFFORT_LENGTH);
	if (effortLengthError) return { error: effortLengthError };
	if (args.assigned_tenant && (typeof args.assigned_tenant !== "string" || !isAllowedTenant(args.assigned_tenant))) {
		return { error: `Unknown tenant: ${args.assigned_tenant}. Known: ${ALLOWED_TENANTS.join(", ")}` };
	}

	const currentTenant = typeof storage.getTenant === "function" ? storage.getTenant() : undefined;
	if (args.assigned_tenant && currentTenant && args.assigned_tenant === currentTenant) {
		return { error: "assigned_tenant cannot be the current tenant" };
	}

	return {
		title,
		description: args.description,
		status: scheduledWake ? "scheduled" : "open",
		priority: normalizeTaskPriority(args.priority) ?? "normal",
		assigned_tenant: args.assigned_tenant,
		scheduled_wake: scheduledWake,
		source: args.source,
		linked_observation_ids: toStringArray(args.linked_observation_ids),
		linked_entity_ids: toStringArray(args.linked_entity_ids),
		depends_on: args.depends_on ? toStringArray(args.depends_on) : undefined,
		estimated_effort: args.estimated_effort
	};
}
