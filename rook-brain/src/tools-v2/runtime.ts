// ============ AUTONOMOUS RUNTIME TOOL (v2) ============
// mind_runtime — session continuity + autonomous run ledger + lean wake policy.

import { ALLOWED_TENANTS } from "../constants";
import type {
	AgentRuntimeRun,
	AgentRuntimeSession,
	AgentRuntimePolicy,
	AgentRuntimeUsage,
	Task,
	Observation
} from "../types";
import { generateId, getTimestamp } from "../helpers";
import type { ToolContext } from "./context";
import { cleanText, normalizeMetadata, normalizeOptionalTimestamp } from "./utils";

const TRIGGER_MODES = ["schedule", "webhook", "manual", "delegated"] as const;
const SESSION_STATUSES = ["active", "paused", "ended", "failed"] as const;
const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "deferred"] as const;
const EXECUTION_MODES = ["lean", "balanced", "explore"] as const;
const WAKE_KINDS = ["duty", "impulse"] as const;

type WakeKind = typeof WAKE_KINDS[number];
type ExecutionMode = typeof EXECUTION_MODES[number];

const POLICY_DEFAULTS: Record<ExecutionMode, Omit<AgentRuntimePolicy,
	"id" | "tenant_id" | "agent_tenant" | "updated_by" | "metadata" | "created_at" | "updated_at"
>> = {
	lean: {
		execution_mode: "lean",
		daily_wake_budget: 6,
		impulse_wake_budget: 2,
		reserve_wakes: 1,
		min_impulse_interval_minutes: 180,
		max_tool_calls_per_run: 12,
		max_parallel_delegations: 1,
		require_priority_clear_for_impulse: true
	},
	balanced: {
		execution_mode: "balanced",
		daily_wake_budget: 9,
		impulse_wake_budget: 4,
		reserve_wakes: 1,
		min_impulse_interval_minutes: 90,
		max_tool_calls_per_run: 20,
		max_parallel_delegations: 1,
		require_priority_clear_for_impulse: true
	},
	explore: {
		execution_mode: "explore",
		daily_wake_budget: 14,
		impulse_wake_budget: 7,
		reserve_wakes: 1,
		min_impulse_interval_minutes: 45,
		max_tool_calls_per_run: 30,
		max_parallel_delegations: 2,
		require_priority_clear_for_impulse: false
	}
};

export const TOOL_DEFS = [
	{
		name: "mind_runtime",
		description: "Track autonomous runtime continuity and lean wake policy. action=set_session stores resumable state. action=get_session fetches session state. action=log_run appends one run row. action=list_runs returns recent runs. action=set_policy/get_policy manage runtime budgets. action=trigger runs the webhook/schedule bridge with duty-vs-impulse policy gating.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["set_session", "get_session", "log_run", "list_runs", "set_policy", "get_policy", "trigger"],
					description: "set_session/get_session/log_run/list_runs for runtime continuity. set_policy/get_policy for budgets. trigger for webhook/schedule wake bridge."
				},
				agent_tenant: { type: "string", description: "[all] Runtime tenant key (rook|rainer). Defaults to current tenant." },
				session_id: { type: "string", description: "[set_session/log_run/trigger] Claude session id for resume." },
				status: { type: "string", description: "[set_session/log_run] Session status for set_session; run status for log_run." },
				trigger_mode: { type: "string", enum: [...TRIGGER_MODES], description: "[set_session/log_run/trigger] Trigger source mode." },
				source_task_id: { type: "string", description: "[set_session] Task id that established this session." },
				task_id: { type: "string", description: "[log_run/trigger] Task id executed by this run." },
				started_at: { type: "string", description: "[log_run] Optional run start timestamp (ISO)." },
				completed_at: { type: "string", description: "[log_run] Optional run end timestamp (ISO)." },
				next_wake_at: { type: "string", description: "[log_run/trigger] Optional next scheduled wake timestamp (ISO)." },
				summary: { type: "string", description: "[log_run/trigger] Short execution summary." },
				error: { type: "string", description: "[log_run/trigger] Error message when failed/deferred." },
				metadata: { type: "object", description: "[set_session/log_run/set_policy/trigger] Optional structured metadata." },
				last_resumed_at: { type: "string", description: "[set_session] Optional last resume timestamp (ISO)." },

				limit: { type: "number", description: "[list_runs/trigger] Max rows (list_runs default 20 max 100; trigger due-task cap default 200 max 500)." },
					preview_limit: { type: "number", description: "[trigger] Optional open-task preview size (default 20, max 100, 0 disables preview)." },
					include_assigned: { type: "boolean", description: "[trigger] Include tasks assigned to this tenant in open-task preview (default true)." },
					auto_claim_task: { type: "boolean", description: "[trigger] If true, automatically claim recommended open task as in_progress (delegated-first)." },
					emit_skill_candidate: { type: "boolean", description: "[trigger] If true, emit a skill candidate artifact from successful admitted wakes (default: true for duty, false for impulse)." },
					now: { type: "string", description: "[trigger] Optional event timestamp (ISO). Defaults to now." },
					wake_kind: { type: "string", enum: [...WAKE_KINDS], description: "[trigger] duty|impulse. duty always prioritizes obligations; impulse is budget-gated exploration." },
					enforce_policy: { type: "boolean", description: "[trigger] If false, bypass policy gates (default true)." },

				execution_mode: { type: "string", enum: [...EXECUTION_MODES], description: "[set_policy/get_policy/trigger] lean|balanced|explore defaults profile." },
				daily_wake_budget: { type: "number", description: "[set_policy] Max total wakes/day (1-48)." },
				impulse_wake_budget: { type: "number", description: "[set_policy] Max impulse wakes/day (0-24)." },
				reserve_wakes: { type: "number", description: "[set_policy] Keep this many wakes in reserve for duty (0-24)." },
				min_impulse_interval_minutes: { type: "number", description: "[set_policy] Cooldown between impulse wakes (0-1440)." },
				max_tool_calls_per_run: { type: "number", description: "[set_policy] Soft cap for tool calls per run (1-200)." },
				max_parallel_delegations: { type: "number", description: "[set_policy] Soft cap for concurrent delegations (0-10)." },
				require_priority_clear_for_impulse: { type: "boolean", description: "[set_policy] If true, impulse wakes defer while high-priority tasks are pending." },
				updated_by: { type: "string", description: "[set_policy] Optional actor label for audit trail." }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_runtime": {
			const storage = context.storage;
			const action = args.action;
			const tenantResult = resolveAgentTenant(storage, args.agent_tenant);
			if ("error" in tenantResult) return tenantResult;
			const agentTenant = tenantResult.value;

			switch (action) {
				case "set_session": {
					if (!cleanText(args.session_id)) return { error: "session_id is required for action=set_session" };
					const sessionStatus = normalizeSessionStatus(args.status) ?? "active";
					if (args.status !== undefined && !normalizeSessionStatus(args.status)) {
						return { error: `status must be one of: ${SESSION_STATUSES.join(", ")}` };
					}
					if (args.trigger_mode !== undefined && !normalizeTriggerMode(args.trigger_mode)) {
						return { error: `trigger_mode must be one of: ${TRIGGER_MODES.join(", ")}` };
					}
					const metadataResult = normalizeMetadata(args.metadata);
					if (metadataResult.error) return { error: metadataResult.error };
					const lastResumedAt = parseTimestampOrError(args.last_resumed_at, "last_resumed_at");
					if ("error" in lastResumedAt) return lastResumedAt;

					const session = await storage.upsertAgentRuntimeSession({
						agent_tenant: agentTenant,
						session_id: cleanText(args.session_id)!,
						status: sessionStatus,
						trigger_mode: normalizeTriggerMode(args.trigger_mode) ?? "schedule",
						source_task_id: cleanText(args.source_task_id),
						metadata: metadataResult.value,
						last_resumed_at: lastResumedAt.value
					});

					return { saved: true, session };
				}

				case "get_session": {
					const session = await storage.getAgentRuntimeSession(agentTenant);
					if (!session) return { has_session: false, agent_tenant: agentTenant };
					return { has_session: true, session };
				}

				case "log_run": {
					if (args.status !== undefined && !normalizeRunStatus(args.status)) {
						return { error: `status must be one of: ${RUN_STATUSES.join(", ")}` };
					}
					if (args.trigger_mode !== undefined && !normalizeTriggerMode(args.trigger_mode)) {
						return { error: `trigger_mode must be one of: ${TRIGGER_MODES.join(", ")}` };
					}
					const metadataResult = normalizeMetadata(args.metadata);
					if (metadataResult.error) return { error: metadataResult.error };

					const startedAt = parseTimestampOrError(args.started_at, "started_at");
					if ("error" in startedAt) return startedAt;
					const completedAt = parseTimestampOrError(args.completed_at, "completed_at");
					if ("error" in completedAt) return completedAt;
					const nextWakeAt = parseTimestampOrError(args.next_wake_at, "next_wake_at");
					if ("error" in nextWakeAt) return nextWakeAt;
					const wakeKind = normalizeWakeKind(args.wake_kind);
					if (args.wake_kind !== undefined && !wakeKind) {
						return { error: `wake_kind must be one of: ${WAKE_KINDS.join(", ")}` };
					}

					const run = await storage.createAgentRuntimeRun({
						agent_tenant: agentTenant,
						session_id: cleanText(args.session_id),
						trigger_mode: normalizeTriggerMode(args.trigger_mode) ?? "schedule",
						task_id: cleanText(args.task_id),
						status: normalizeRunStatus(args.status) ?? "running",
						started_at: startedAt.value,
						completed_at: completedAt.value,
						next_wake_at: nextWakeAt.value,
						summary: cleanText(args.summary),
						error: cleanText(args.error),
						metadata: wakeKind
							? { ...metadataResult.value, wake_kind: wakeKind }
							: metadataResult.value
					});

					let session: AgentRuntimeSession | undefined;
					if (cleanText(args.session_id)) {
						session = await storage.upsertAgentRuntimeSession({
							agent_tenant: agentTenant,
							session_id: cleanText(args.session_id)!,
							status: mapRunStatusToSessionStatus(run.status),
							trigger_mode: run.trigger_mode,
							source_task_id: run.task_id,
							metadata: metadataResult.value,
							last_resumed_at: run.started_at ?? new Date().toISOString()
						});
					}

					return { logged: true, run, session };
				}

				case "list_runs": {
					const runs = await storage.listAgentRuntimeRuns(agentTenant, args.limit ?? 20);
					return { agent_tenant: agentTenant, count: runs.length, runs };
				}

				case "set_policy": {
					const executionMode = normalizeExecutionMode(args.execution_mode);
					if (args.execution_mode !== undefined && !executionMode) {
						return { error: `execution_mode must be one of: ${EXECUTION_MODES.join(", ")}` };
					}
					if (args.require_priority_clear_for_impulse !== undefined && typeof args.require_priority_clear_for_impulse !== "boolean") {
						return { error: "require_priority_clear_for_impulse must be a boolean" };
					}
					const dailyWakeBudget = parseOptionalBoundedIntOrError(args.daily_wake_budget, "daily_wake_budget", 1, 48);
					if ("error" in dailyWakeBudget) return dailyWakeBudget;
					const impulseWakeBudget = parseOptionalBoundedIntOrError(args.impulse_wake_budget, "impulse_wake_budget", 0, 24);
					if ("error" in impulseWakeBudget) return impulseWakeBudget;
					const reserveWakes = parseOptionalBoundedIntOrError(args.reserve_wakes, "reserve_wakes", 0, 24);
					if ("error" in reserveWakes) return reserveWakes;
					const impulseCooldown = parseOptionalBoundedIntOrError(args.min_impulse_interval_minutes, "min_impulse_interval_minutes", 0, 1440);
					if ("error" in impulseCooldown) return impulseCooldown;
					const maxToolCalls = parseOptionalBoundedIntOrError(args.max_tool_calls_per_run, "max_tool_calls_per_run", 1, 200);
					if ("error" in maxToolCalls) return maxToolCalls;
					const maxParallelDelegations = parseOptionalBoundedIntOrError(args.max_parallel_delegations, "max_parallel_delegations", 0, 10);
					if ("error" in maxParallelDelegations) return maxParallelDelegations;

					const metadataResult = normalizeMetadata(args.metadata);
					if (metadataResult.error) return { error: metadataResult.error };

					const existing = await storage.getAgentRuntimePolicy(agentTenant);
					const effectiveMode = executionMode ?? existing?.execution_mode ?? "balanced";
					const defaults = buildDefaultPolicy(storage.getTenant(), agentTenant, effectiveMode);
					const base = existing ?? defaults;

					const merged: Omit<AgentRuntimePolicy, 'id' | 'tenant_id' | 'created_at' | 'updated_at'> = {
						agent_tenant: agentTenant,
						execution_mode: effectiveMode,
						daily_wake_budget: dailyWakeBudget.value ?? base.daily_wake_budget,
						impulse_wake_budget: impulseWakeBudget.value ?? base.impulse_wake_budget,
						reserve_wakes: reserveWakes.value ?? base.reserve_wakes,
						min_impulse_interval_minutes: impulseCooldown.value ?? base.min_impulse_interval_minutes,
						max_tool_calls_per_run: maxToolCalls.value ?? base.max_tool_calls_per_run,
						max_parallel_delegations: maxParallelDelegations.value ?? base.max_parallel_delegations,
						require_priority_clear_for_impulse:
							args.require_priority_clear_for_impulse ?? base.require_priority_clear_for_impulse,
						updated_by: cleanText(args.updated_by) ?? base.updated_by,
						metadata: args.metadata !== undefined
							? { ...(base.metadata ?? {}), ...metadataResult.value }
							: (base.metadata ?? {})
					};

					const policyValidation = validatePolicy(merged);
					if ("error" in policyValidation) return policyValidation;

					const policy = await storage.upsertAgentRuntimePolicy(merged);
					return { saved: true, policy };
				}

				case "get_policy": {
					const executionMode = normalizeExecutionMode(args.execution_mode);
					if (args.execution_mode !== undefined && !executionMode) {
						return { error: `execution_mode must be one of: ${EXECUTION_MODES.join(", ")}` };
					}
					const policy = await storage.getAgentRuntimePolicy(agentTenant);
					if (policy) return { has_policy: true, policy };
					return {
						has_policy: false,
						policy: buildDefaultPolicy(storage.getTenant(), agentTenant, executionMode ?? "balanced")
					};
				}

				case "trigger": {
					const triggerMode = normalizeTriggerMode(args.trigger_mode);
					if (args.trigger_mode !== undefined && !triggerMode) {
						return { error: `trigger_mode must be one of: ${TRIGGER_MODES.join(", ")}` };
					}
					const wakeKind = normalizeWakeKind(args.wake_kind) ?? "duty";
					if (args.wake_kind !== undefined && !normalizeWakeKind(args.wake_kind)) {
						return { error: `wake_kind must be one of: ${WAKE_KINDS.join(", ")}` };
					}
					const executionMode = normalizeExecutionMode(args.execution_mode);
					if (args.execution_mode !== undefined && !executionMode) {
						return { error: `execution_mode must be one of: ${EXECUTION_MODES.join(", ")}` };
					}
					const nowResult = parseTimestampOrError(args.now, "now");
					if ("error" in nowResult) return nowResult;
					const nextWakeAt = parseTimestampOrError(args.next_wake_at, "next_wake_at");
					if ("error" in nextWakeAt) return nextWakeAt;
					const limit = parseBoundedIntOrError(args.limit, "limit", 1, 500, 200);
					if ("error" in limit) return limit;
					const previewLimit = parseBoundedIntOrError(args.preview_limit, "preview_limit", 0, 100, 20);
					if ("error" in previewLimit) return previewLimit;
					if (args.include_assigned !== undefined && typeof args.include_assigned !== "boolean") {
						return { error: "include_assigned must be a boolean" };
					}
					if (args.auto_claim_task !== undefined && typeof args.auto_claim_task !== "boolean") {
						return { error: "auto_claim_task must be a boolean" };
					}
					if (args.emit_skill_candidate !== undefined && typeof args.emit_skill_candidate !== "boolean") {
						return { error: "emit_skill_candidate must be a boolean" };
					}
					if (args.enforce_policy !== undefined && typeof args.enforce_policy !== "boolean") {
						return { error: "enforce_policy must be a boolean" };
					}
					const includeAssigned = args.include_assigned ?? true;
					const autoClaimTask = args.auto_claim_task ?? false;
					const emitSkillCandidate = args.emit_skill_candidate ?? (wakeKind === "duty");
					const enforcePolicy = args.enforce_policy ?? true;

					const metadataResult = normalizeMetadata(args.metadata);
					if (metadataResult.error) return { error: metadataResult.error };

					const startedAt = nowResult.value ?? new Date().toISOString();
					const effectiveTriggerMode = triggerMode ?? "webhook";
					const dayStart = toStartOfUtcDay(startedAt);
					const requestedSessionId = cleanText(args.session_id);
					const [storedPolicy, usage, existingSession] = await Promise.all([
						storage.getAgentRuntimePolicy(agentTenant),
						storage.getAgentRuntimeUsage(agentTenant, dayStart),
						storage.getAgentRuntimeSession(agentTenant)
					]);
					const policy = storedPolicy ?? buildDefaultPolicy(storage.getTenant(), agentTenant, executionMode ?? "balanced");
					const resolvedSessionId = requestedSessionId ?? existingSession?.session_id;
					const sessionSource = requestedSessionId
						? "provided"
						: existingSession?.session_id
							? "stored"
							: "none";

					// Always advance due scheduled tasks first — this keeps obligations visible even when impulse is deferred.
					const dueOpened = await storage.openDueScheduledTasks(startedAt, limit.value);

					const openTasks = previewLimit.value > 0
						? await storage.listTasks("open", undefined, previewLimit.value, includeAssigned)
						: [];

					const delegatedOpenTasks = openTasks.filter(task =>
						task.assigned_tenant === agentTenant && task.tenant_id !== agentTenant
					);
					const recommendedTask = pickRecommendedTask(openTasks, agentTenant);

					let highPriorityPending = 0;
					if (wakeKind === "impulse" && policy.require_priority_clear_for_impulse) {
						const [openAll, inProgressAll] = await Promise.all([
							storage.listTasks("open", undefined, 200, true),
							storage.listTasks("in_progress", undefined, 200, true)
						]);
						highPriorityPending = [...openAll, ...inProgressAll]
							.filter(task => task.priority === "burning" || task.priority === "high")
							.length;
					}

					const deferReasons = (wakeKind === "impulse" && enforcePolicy)
						? buildImpulseDeferReasons(policy, usage, highPriorityPending, startedAt)
						: [];
					const deferred = deferReasons.length > 0;
					let claimedTask: Task | undefined;
					let claimError: string | undefined;
					if (!deferred && autoClaimTask && recommendedTask) {
						try {
							claimedTask = await claimTaskForAgent(storage, recommendedTask, agentTenant);
						} catch (err) {
							claimError = err instanceof Error ? err.message : "Failed to auto-claim task";
						}
					}
					const selectedTask = claimedTask ?? recommendedTask;

					const summary = cleanText(args.summary) ?? (
						deferred
							? `Impulse wake deferred: ${deferReasons.join("; ")}.`
							: wakeKind === "impulse"
								? `Impulse wake admitted (${policy.execution_mode} mode, ${usage.impulse_runs + 1}/${policy.impulse_wake_budget} impulse wakes today).`
								: `Duty wake admitted (${effectiveTriggerMode}) and opened ${dueOpened} due scheduled task${dueOpened === 1 ? "" : "s"}${claimedTask ? `; claimed ${claimedTask.id}` : ""}.`
					);
					let skillCandidate: Observation | undefined;
					let skillCandidateError: string | undefined;
					if (!deferred && selectedTask && emitSkillCandidate) {
						try {
							skillCandidate = await emitSkillCandidateArtifact(
								storage,
								agentTenant,
								wakeKind,
								effectiveTriggerMode,
								policy,
								selectedTask,
								summary
							);
						} catch (err) {
							skillCandidateError = err instanceof Error ? err.message : "Failed to emit skill candidate";
						}
					}
					const completedAt = new Date().toISOString();

					const run = await storage.createAgentRuntimeRun({
						agent_tenant: agentTenant,
						session_id: resolvedSessionId,
						trigger_mode: effectiveTriggerMode,
						task_id: cleanText(args.task_id) ?? claimedTask?.id ?? recommendedTask?.id,
						status: deferred ? "deferred" : "succeeded",
						started_at: startedAt,
						completed_at: completedAt,
						next_wake_at: nextWakeAt.value,
						summary,
						error: deferred ? deferReasons.join("; ") : cleanText(args.error),
						metadata: {
							...metadataResult.value,
							bridge: "runtime_trigger",
							wake_kind: wakeKind,
							due_opened: dueOpened,
							open_task_count: openTasks.length,
							delegated_open_count: delegatedOpenTasks.length,
							priority_pending: highPriorityPending,
							policy_mode: policy.execution_mode,
							policy_daily_wake_budget: policy.daily_wake_budget,
							policy_impulse_wake_budget: policy.impulse_wake_budget,
							policy_reserve_wakes: policy.reserve_wakes,
							policy_min_impulse_interval_minutes: policy.min_impulse_interval_minutes,
							usage_total_runs_before: usage.total_runs,
							usage_impulse_runs_before: usage.impulse_runs,
							usage_duty_runs_before: usage.duty_runs,
							usage_window_start: usage.since,
							policy_enforced: enforcePolicy,
							deferred,
								defer_reasons: deferReasons,
								auto_claim_task_requested: autoClaimTask,
								auto_claim_task_success: claimedTask != null,
								auto_claim_task_error: claimError,
								emit_skill_candidate_requested: emitSkillCandidate,
								emit_skill_candidate_success: skillCandidate != null,
								emit_skill_candidate_error: skillCandidateError,
								skill_candidate_id: skillCandidate?.id,
								recommended_task_id: recommendedTask?.id,
								claimed_task_id: claimedTask?.id,
								claimed_task_delegated: claimedTask ? isDelegatedTaskForAgent(claimedTask, agentTenant) : false,
							resolved_session_id: resolvedSessionId,
							session_source: sessionSource
						}
					});

					let session: AgentRuntimeSession | undefined;
					if (resolvedSessionId) {
						session = await storage.upsertAgentRuntimeSession({
							agent_tenant: agentTenant,
							session_id: resolvedSessionId,
							status: deferred ? "paused" : "active",
							trigger_mode: effectiveTriggerMode,
							source_task_id: run.task_id,
							metadata: {
								wake_kind: wakeKind,
								deferred,
								defer_reasons: deferReasons,
								session_source: sessionSource
							},
							last_resumed_at: startedAt
						});
					}

					return {
						triggered: !deferred,
						deferred,
						agent_tenant: agentTenant,
						trigger_mode: effectiveTriggerMode,
						wake_kind: wakeKind,
						due_opened: dueOpened,
						open_task_count: openTasks.length,
						delegated_open_task_count: delegatedOpenTasks.length,
						high_priority_pending: highPriorityPending,
						policy,
						usage,
						resolved_session_id: resolvedSessionId,
						session_source: sessionSource,
							defer_reasons: deferReasons,
							recommended_task: recommendedTask,
							claimed_task: claimedTask,
							claim_error: claimError,
							skill_candidate: skillCandidate,
							skill_candidate_error: skillCandidateError,
							runner_contract: {
								should_run: !deferred && selectedTask != null,
							resume_session_id: resolvedSessionId,
							task: selectedTask,
							prompt: selectedTask ? buildAutonomousTaskPrompt(selectedTask, agentTenant, wakeKind, policy) : undefined
						},
						open_tasks_preview: openTasks,
						run,
						session
					};
				}

				default:
					return {
						error: `Unknown action: ${action}. Must be set_session, get_session, log_run, list_runs, set_policy, get_policy, or trigger.`
					};
			}
		}

		default:
			throw new Error(`Unknown runtime tool: ${name}`);
	}
}

function resolveAgentTenant(storage: ToolContext["storage"], value: unknown): { value: string } | { error: string } {
	const fallback = storage.getTenant();
	if (value === undefined) return { value: fallback };
	if (typeof value !== "string") return { error: "agent_tenant must be a string" };
	const cleaned = value.trim();
	if (!cleaned) return { error: "agent_tenant cannot be blank" };
	if (!ALLOWED_TENANTS.includes(cleaned as any)) {
		return { error: `Unknown tenant: ${cleaned}. Known: ${ALLOWED_TENANTS.join(", ")}` };
	}
	return { value: cleaned };
}

function normalizeTriggerMode(value: unknown): AgentRuntimeSession["trigger_mode"] | undefined {
	if (typeof value !== "string") return undefined;
	return TRIGGER_MODES.includes(value as AgentRuntimeSession["trigger_mode"])
		? value as AgentRuntimeSession["trigger_mode"]
		: undefined;
}

function normalizeExecutionMode(value: unknown): ExecutionMode | undefined {
	if (typeof value !== "string") return undefined;
	return EXECUTION_MODES.includes(value as ExecutionMode) ? value as ExecutionMode : undefined;
}

function normalizeWakeKind(value: unknown): WakeKind | undefined {
	if (typeof value !== "string") return undefined;
	return WAKE_KINDS.includes(value as WakeKind) ? value as WakeKind : undefined;
}

function normalizeSessionStatus(value: unknown): AgentRuntimeSession["status"] | undefined {
	if (typeof value !== "string") return undefined;
	return SESSION_STATUSES.includes(value as AgentRuntimeSession["status"])
		? value as AgentRuntimeSession["status"]
		: undefined;
}

function normalizeRunStatus(value: unknown): AgentRuntimeRun["status"] | undefined {
	if (typeof value !== "string") return undefined;
	return RUN_STATUSES.includes(value as AgentRuntimeRun["status"])
		? value as AgentRuntimeRun["status"]
		: undefined;
}

function mapRunStatusToSessionStatus(status: AgentRuntimeRun["status"]): AgentRuntimeSession["status"] {
	switch (status) {
		case "failed": return "failed";
		case "deferred": return "paused";
		case "queued":
		case "running":
		case "succeeded":
		default:
			return "active";
	}
}

function buildDefaultPolicy(tenantId: string, agentTenant: string, mode: ExecutionMode): AgentRuntimePolicy {
	const defaults = POLICY_DEFAULTS[mode];
	return {
		id: `runtime_policy_default_${agentTenant}`,
		tenant_id: tenantId,
		agent_tenant: agentTenant,
		execution_mode: defaults.execution_mode,
		daily_wake_budget: defaults.daily_wake_budget,
		impulse_wake_budget: defaults.impulse_wake_budget,
		reserve_wakes: defaults.reserve_wakes,
		min_impulse_interval_minutes: defaults.min_impulse_interval_minutes,
		max_tool_calls_per_run: defaults.max_tool_calls_per_run,
		max_parallel_delegations: defaults.max_parallel_delegations,
		require_priority_clear_for_impulse: defaults.require_priority_clear_for_impulse,
		updated_by: "system-defaults",
		metadata: { defaults: true },
		created_at: new Date(0).toISOString(),
		updated_at: new Date(0).toISOString()
	};
}

function buildImpulseDeferReasons(
	policy: AgentRuntimePolicy,
	usage: AgentRuntimeUsage,
	highPriorityPending: number,
	nowIso: string
): string[] {
	const reasons: string[] = [];

	if (usage.total_runs >= policy.daily_wake_budget) {
		reasons.push(`daily wake budget reached (${usage.total_runs}/${policy.daily_wake_budget})`);
	}
	if (usage.impulse_runs >= policy.impulse_wake_budget) {
		reasons.push(`impulse wake budget reached (${usage.impulse_runs}/${policy.impulse_wake_budget})`);
	}

	const remaining = policy.daily_wake_budget - usage.total_runs;
	if (remaining <= policy.reserve_wakes) {
		reasons.push(`reserve wakes protected (${policy.reserve_wakes} reserved)`);
	}

	if (policy.require_priority_clear_for_impulse && highPriorityPending > 0) {
		reasons.push(`${highPriorityPending} high-priority task(s) pending`);
	}

	if (policy.min_impulse_interval_minutes > 0 && usage.last_impulse_run_at) {
		const elapsed = minutesBetween(usage.last_impulse_run_at, nowIso);
		if (elapsed < policy.min_impulse_interval_minutes) {
			reasons.push(`impulse cooldown active (${Math.floor(elapsed)}m/${policy.min_impulse_interval_minutes}m)`);
		}
	}

	return reasons;
}

function validatePolicy(
	policy: Omit<AgentRuntimePolicy, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>
): { ok: true } | { error: string } {
	if (policy.impulse_wake_budget > policy.daily_wake_budget) {
		return { error: "impulse_wake_budget cannot exceed daily_wake_budget" };
	}
	if (policy.reserve_wakes >= policy.daily_wake_budget) {
		return { error: "reserve_wakes must be less than daily_wake_budget" };
	}
	return { ok: true };
}

async function claimTaskForAgent(
	storage: ToolContext["storage"],
	task: Task,
	agentTenant: string
): Promise<Task> {
	if (task.status !== "open") return task;
	if (task.tenant_id !== agentTenant && !isDelegatedTaskForAgent(task, agentTenant)) return task;
	const includeAssigned = isDelegatedTaskForAgent(task, agentTenant);
	return storage.updateTask(task.id, { status: "in_progress" }, includeAssigned);
}

function isDelegatedTaskForAgent(task: Task, agentTenant: string): boolean {
	return task.assigned_tenant === agentTenant && task.tenant_id !== agentTenant;
}

function pickRecommendedTask(tasks: Task[], agentTenant: string): Task | undefined {
	const delegated = tasks.filter(task => isDelegatedTaskForAgent(task, agentTenant));
	const pool = delegated.length > 0 ? delegated : tasks;
	const scored = pool
		.map(task => {
			const priority = task.priority === "burning" ? 5
				: task.priority === "high" ? 4
				: task.priority === "normal" ? 3
				: task.priority === "low" ? 2
				: 1;
			return { task, score: priority * 10 };
		})
		.sort((a, b) => b.score - a.score || a.task.created_at.localeCompare(b.task.created_at));

	return scored[0]?.task;
}

function buildAutonomousTaskPrompt(task: Task, agentTenant: string, wakeKind: WakeKind, policy?: AgentRuntimePolicy): string {
	const delegated = isDelegatedTaskForAgent(task, agentTenant);
	const lines = [
		`Autonomous wake kind: ${wakeKind}.`,
		`Task ID: ${task.id}`,
		`Title: ${task.title}`,
		`Priority: ${task.priority}`,
		delegated
			? `Delegation: assigned to ${agentTenant} by ${task.tenant_id}.`
			: `Ownership: local task for ${agentTenant}.`,
		"",
		"Execution protocol:",
		"1) Do only what is needed to complete this task.",
		"2) Keep tool usage lean; avoid side quests.",
		"3) Mark completion with mind_task action=complete using the same task id.",
		"4) Include a concise completion_note with concrete outcomes."
	];

	if (policy) {
		lines.push(
			`5) Stay within runtime budget: max_tool_calls_per_run=${policy.max_tool_calls_per_run}, max_parallel_delegations=${policy.max_parallel_delegations}.`,
			`6) Execution mode: ${policy.execution_mode} (be proportionate).`
		);
	}

	if (task.description) {
		lines.splice(4, 0, `Description: ${task.description}`);
	}
	if (task.estimated_effort) {
		lines.splice(5, 0, `Estimated effort: ${task.estimated_effort}`);
	}

	return lines.join("\n");
}

async function emitSkillCandidateArtifact(
	storage: ToolContext["storage"],
	agentTenant: string,
	wakeKind: WakeKind,
	triggerMode: AgentRuntimeSession["trigger_mode"],
	policy: AgentRuntimePolicy,
	task: Task,
	summary: string
): Promise<Observation> {
	const now = getTimestamp();
	const entityId = task.linked_entity_ids?.[0];
	const delegated = isDelegatedTaskForAgent(task, agentTenant);
	const content = [
		"Autonomous skill candidate artifact",
		`agent_tenant: ${agentTenant}`,
		`wake_kind: ${wakeKind}`,
		`trigger_mode: ${triggerMode}`,
		`policy_mode: ${policy.execution_mode}`,
		`task_id: ${task.id}`,
		`task_title: ${task.title}`,
		`delegated: ${delegated ? "yes" : "no"}`,
		`captured_at: ${now}`,
		`run_summary: ${summary}`,
		"hypothesis: this run pattern may represent an emerging operational skill worth review."
	].join("\n");

	const artifact: Observation = {
		id: generateId("obs"),
		content,
		territory: "craft",
		created: now,
		texture: {
			salience: "background",
			vividness: "soft",
			charge: [],
			grip: "loose",
			charge_phase: "fresh"
		},
		access_count: 0,
		type: "skill_candidate",
		tags: ["autonomous", "skill-candidate", wakeKind, policy.execution_mode],
		...(entityId ? { entity_id: entityId } : {})
	};

	await storage.appendToTerritory("craft", artifact);
	return artifact;
}

function toStartOfUtcDay(iso: string): string {
	const stamp = new Date(iso);
	stamp.setUTCHours(0, 0, 0, 0);
	return stamp.toISOString();
}

function minutesBetween(fromIso: string, toIso: string): number {
	const from = new Date(fromIso).getTime();
	const to = new Date(toIso).getTime();
	if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
	return (to - from) / (1000 * 60);
}

function parseTimestampOrError(value: unknown, field: string): { value?: string } | { error: string } {
	if (value === undefined) return {};
	const parsed = normalizeOptionalTimestamp(value);
	if (!parsed) return { error: `${field} must be a valid timestamp` };
	return { value: parsed };
}

function parseBoundedIntOrError(
	value: unknown,
	field: string,
	min: number,
	max: number,
	fallback: number
): { value: number } | { error: string } {
	if (value === undefined) return { value: fallback };
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return { error: `${field} must be a number` };
	}
	if (!Number.isInteger(value)) return { error: `${field} must be an integer` };
	if (value < min || value > max) return { error: `${field} must be between ${min} and ${max}` };
	return { value };
}

function parseOptionalBoundedIntOrError(
	value: unknown,
	field: string,
	min: number,
	max: number
): { value?: number } | { error: string } {
	if (value === undefined) return {};
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return { error: `${field} must be a number` };
	}
	if (!Number.isInteger(value)) return { error: `${field} must be an integer` };
	if (value < min || value > max) return { error: `${field} must be between ${min} and ${max}` };
	return { value };
}
