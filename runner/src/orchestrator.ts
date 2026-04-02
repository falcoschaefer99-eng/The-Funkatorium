import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { BrainClient } from "./brain.js";
import { logRun } from "./audit.js";
import type { NotificationEvent, Notifier } from "./notifier.js";
import { CompositeNotifier, NullNotifier } from "./notifier.js";
import { createTelegramNotifierFromEnv } from "./notifiers/telegram.js";
import {
  buildImpulseWakePrompt,
  buildNightlyDreamRecord,
  buildPersonalWakePrompt,
} from "./personal-planner.js";
import { executeProviderRun } from "./provider-executor.js";
import { loadTenantConfig, type TenantRuntimeConfig, type ProviderKind, resolveRunnerPath } from "./tenants.js";

interface RuntimeTriggerResult {
  triggered?: boolean;
  deferred?: boolean;
  defer_reasons?: string[];
  runner_contract?: {
    should_run?: boolean;
    resume_session_id?: string;
    prompt?: string;
    task?: { id?: string; title?: string };
  };
}

export interface RunnerExecutionPlan {
  shouldRun: boolean;
  prompt?: string;
  resumeSessionId?: string;
  taskId?: string;
  taskTitle?: string;
}

export function buildRunnerExecutionPlan(trigger: RuntimeTriggerResult): RunnerExecutionPlan {
  const contract = trigger.runner_contract;
  if (!contract?.should_run || !contract.prompt || trigger.deferred) {
    return {
      shouldRun: false,
      resumeSessionId: contract?.resume_session_id,
      taskId: contract?.task?.id,
      taskTitle: contract?.task?.title,
    };
  }

  return {
    shouldRun: true,
    prompt: contract.prompt,
    resumeSessionId: contract.resume_session_id,
    taskId: contract.task?.id,
    taskTitle: contract.task?.title,
  };
}

interface OrchestratorState {
  personal_slots: Record<string, string>;
  nightly_slots: Record<string, string>;
  impulse_runs: Record<string, string>;
}

export interface OrchestratorConfig {
  brainUrl: string;
  brainApiKey: string;
  tenantConfigPath: string;
  statePath: string;
  auditPath: string;
  timezone: string;
  slotGraceMinutes: number;
  maxDutyPasses: number;
}

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function intEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function loadOrchestratorConfig(): OrchestratorConfig {
  return {
    brainUrl: optionalEnv("BRAIN_URL", "https://rook.funkatorium.org/mcp"),
    brainApiKey: requireEnv("BRAIN_API_KEY"),
    tenantConfigPath: resolveRunnerPath(optionalEnv("TENANT_CONFIG_PATH", "./config/tenants.json")),
    statePath: resolveRunnerPath(optionalEnv("ORCHESTRATOR_STATE_PATH", "./state/orchestrator-state.json")),
    auditPath: resolveRunnerPath(optionalEnv("AUDIT_PATH", "./audit-orchestrator.jsonl")),
    timezone: optionalEnv("ORCHESTRATOR_TIMEZONE", "Europe/Berlin"),
    slotGraceMinutes: intEnv("ORCHESTRATOR_SLOT_GRACE_MINUTES", 10, 1, 60),
    maxDutyPasses: intEnv("ORCHESTRATOR_MAX_DUTY_PASSES", 8, 1, 50),
  };
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function loadState(statePath: string): OrchestratorState {
  if (!existsSync(statePath)) {
    return { personal_slots: {}, nightly_slots: {}, impulse_runs: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as Partial<OrchestratorState>;
    return {
      personal_slots: parsed.personal_slots ?? {},
      nightly_slots: parsed.nightly_slots ?? {},
      impulse_runs: parsed.impulse_runs ?? {},
    };
  } catch {
    return { personal_slots: {}, nightly_slots: {}, impulse_runs: {} };
  }
}

function saveState(statePath: string, state: OrchestratorState): void {
  ensureParentDir(statePath);
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function createNotifier(): Notifier {
  const notifiers = [];
  const telegram = createTelegramNotifierFromEnv();
  if (telegram) notifiers.push(telegram);
  if (notifiers.length === 0) return new NullNotifier();
  return new CompositeNotifier(notifiers);
}

function zonedParts(now: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string | undefined>;
  const year = map["year"];
  const month = map["month"];
  const day = map["day"];
  const hour = map["hour"];
  const minute = map["minute"];
  if (!year || !month || !day || !hour || !minute) {
    throw new Error(`Failed to resolve zoned time parts for timezone ${timezone}`);
  }
  return {
    year,
    month,
    day,
    hour: Number.parseInt(hour, 10),
    minute: Number.parseInt(minute, 10),
  };
}

function dayKey(now: Date, timezone: string): string {
  const parts = zonedParts(now, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesOfDay(clock: string): number {
  const [hourRaw, minuteRaw] = clock.split(":");
  if (!hourRaw || !minuteRaw) {
    throw new Error(`Invalid clock value: ${clock}`);
  }
  return Number.parseInt(hourRaw, 10) * 60 + Number.parseInt(minuteRaw, 10);
}

function isSlotDue(slot: string, now: Date, timezone: string, graceMinutes: number): boolean {
  const parts = zonedParts(now, timezone);
  const current = parts.hour * 60 + parts.minute;
  const target = minutesOfDay(slot);
  return current >= target && current <= target + graceMinutes;
}

function isImpulseDue(tenant: TenantRuntimeConfig, state: OrchestratorState, now: Date): boolean {
  const lastRun = state.impulse_runs[tenant.tenant];
  if (!lastRun) return true;
  const elapsedMinutes = (now.getTime() - new Date(lastRun).getTime()) / 60_000;
  return elapsedMinutes >= tenant.impulse_check_interval_minutes;
}

function peerWorkspace(
  tenant: TenantRuntimeConfig,
  tenants: TenantRuntimeConfig[]
): string | undefined {
  return tenants.find((candidate) => candidate.tenant !== tenant.tenant && candidate.enabled)?.workspace_path;
}

function emitAudit(auditPath: string, tenant: string, status: "completed" | "error", summary: string, startedAt: number): void {
  logRun(auditPath, {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    iterations: 0,
    tool_calls: [],
    model: "orchestrator",
    tenant,
    status,
    summary,
  });
}

async function maybeNotify(
  notifier: Notifier,
  tenant: TenantRuntimeConfig,
  event: NotificationEvent
): Promise<void> {
  if (!tenant.telegram_enabled || !event.user_visible) return;
  await notifier.send(event);
}

async function runTriggeredTask(
  config: OrchestratorConfig,
  notifier: Notifier,
  tenant: TenantRuntimeConfig,
  tenants: TenantRuntimeConfig[],
  wakeKind: "duty" | "impulse"
): Promise<boolean> {
  const startedAt = Date.now();
  const brain = new BrainClient(config.brainUrl, config.brainApiKey, tenant.tenant);
  const metadata = {
    local_workspace: tenant.workspace_path,
    artifact_workspace: tenant.workspace_path,
    peer_workspace: peerWorkspace(tenant, tenants),
  };

  const trigger = await brain.callToolJson<RuntimeTriggerResult>("mind_runtime", {
    action: "trigger",
    agent_tenant: tenant.tenant,
    trigger_mode: "schedule",
    wake_kind: wakeKind,
    auto_claim_task: true,
    include_assigned: true,
    emit_skill_candidate: wakeKind === "duty",
    metadata,
  });

  if (trigger.deferred) {
    emitAudit(
      config.auditPath,
      tenant.tenant,
      "completed",
      `${wakeKind} deferred: ${(trigger.defer_reasons ?? []).join("; ") || "policy gate"}`,
      startedAt
    );
    return false;
  }

  const runnerPlan = buildRunnerExecutionPlan(trigger);
  if (!runnerPlan.shouldRun || !runnerPlan.prompt) {
    emitAudit(config.auditPath, tenant.tenant, "completed", `${wakeKind} tick: no runnable contract`, startedAt);
    return false;
  }

  const isReview = (runnerPlan.taskTitle ?? "").toLowerCase().startsWith("review:");
  const finalWakeType = wakeKind === "duty" && isReview ? "baton" : wakeKind;
  const execution = await executeProviderRun({
    tenant: tenant.tenant,
    provider: tenant.provider,
    workspacePath: tenant.workspace_path,
    prompt: runnerPlan.prompt,
    wakeType: wakeKind,
    model: tenant.model,
    resumeSessionId: runnerPlan.resumeSessionId,
    allowArtifactWrites: true,
  });

  const eventType =
    wakeKind === "impulse"
      ? "impulse_wake_completed"
      : isReview
        ? "review_completed"
        : "task_completed";

  if (execution.status === "completed") {
    await maybeNotify(notifier, tenant, {
      event_type: eventType,
      tenant: tenant.tenant,
      wake_type: finalWakeType,
      summary: execution.summary,
      timestamp: new Date().toISOString(),
      user_visible: true,
    });
    emitAudit(config.auditPath, tenant.tenant, "completed", `${wakeKind}: ${execution.summary}`, startedAt);
    return true;
  }

  await maybeNotify(notifier, tenant, {
    event_type: "wake_failed",
    tenant: tenant.tenant,
    wake_type: finalWakeType,
    summary: execution.summary,
    timestamp: new Date().toISOString(),
    user_visible: true,
  });
  emitAudit(config.auditPath, tenant.tenant, "error", `${wakeKind} failed: ${execution.summary}`, startedAt);
  return false;
}

async function runPersonalWake(
  config: OrchestratorConfig,
  notifier: Notifier,
  tenant: TenantRuntimeConfig,
  now: Date
): Promise<void> {
  const startedAt = Date.now();
  const brain = new BrainClient(config.brainUrl, config.brainApiKey, tenant.tenant);
  const { prompt, artifactPath, summary } = await buildPersonalWakePrompt(brain, tenant, now);
  const execution = await executeProviderRun({
    tenant: tenant.tenant,
    provider: tenant.provider,
    workspacePath: tenant.workspace_path,
    prompt,
    wakeType: "personal",
    model: tenant.model,
    allowArtifactWrites: true,
  });

  await maybeNotify(notifier, tenant, {
    event_type: execution.status === "completed" ? "personal_wake_completed" : "wake_failed",
    tenant: tenant.tenant,
    wake_type: "personal",
    summary: execution.status === "completed" ? execution.summary : `${summary} failed: ${execution.summary}`,
    artifact_path: execution.status === "completed" ? artifactPath : undefined,
    timestamp: new Date().toISOString(),
    user_visible: true,
  });

  emitAudit(
    config.auditPath,
    tenant.tenant,
    execution.status === "completed" ? "completed" : "error",
    `${summary}: ${execution.summary}`,
    startedAt
  );
}

async function runImpulseWake(
  config: OrchestratorConfig,
  notifier: Notifier,
  tenant: TenantRuntimeConfig,
  now: Date
): Promise<void> {
  const startedAt = Date.now();
  const brain = new BrainClient(config.brainUrl, config.brainApiKey, tenant.tenant);
  const trigger = await brain.callToolJson<RuntimeTriggerResult>("mind_runtime", {
    action: "trigger",
    agent_tenant: tenant.tenant,
    trigger_mode: "schedule",
    wake_kind: "impulse",
    auto_claim_task: true,
    include_assigned: true,
    emit_skill_candidate: false,
    metadata: {
      local_workspace: tenant.workspace_path,
      artifact_workspace: tenant.workspace_path,
    },
  });

  if (trigger.deferred) {
    emitAudit(
      config.auditPath,
      tenant.tenant,
      "completed",
      `impulse deferred: ${(trigger.defer_reasons ?? []).join("; ") || "policy gate"}`,
      startedAt
    );
    return;
  }

  const runnerPlan = buildRunnerExecutionPlan(trigger);
  if (runnerPlan.shouldRun && runnerPlan.prompt) {
    const execution = await executeProviderRun({
      tenant: tenant.tenant,
      provider: tenant.provider,
      workspacePath: tenant.workspace_path,
      prompt: runnerPlan.prompt,
      wakeType: "impulse",
      model: tenant.model,
      resumeSessionId: runnerPlan.resumeSessionId,
      allowArtifactWrites: true,
    });

    await maybeNotify(notifier, tenant, {
      event_type: execution.status === "completed" ? "impulse_wake_completed" : "wake_failed",
      tenant: tenant.tenant,
      wake_type: "impulse",
      summary: execution.summary,
      timestamp: new Date().toISOString(),
      user_visible: true,
    });

    emitAudit(
      config.auditPath,
      tenant.tenant,
      execution.status === "completed" ? "completed" : "error",
      `impulse task: ${execution.summary}`,
      startedAt
    );
    return;
  }

  const { prompt, artifactPath, summary } = await buildImpulseWakePrompt(brain, tenant, now);
  const execution = await executeProviderRun({
    tenant: tenant.tenant,
    provider: tenant.provider,
    workspacePath: tenant.workspace_path,
    prompt,
    wakeType: "impulse",
    model: tenant.model,
    allowArtifactWrites: true,
  });

  await maybeNotify(notifier, tenant, {
    event_type: execution.status === "completed" ? "impulse_wake_completed" : "wake_failed",
    tenant: tenant.tenant,
    wake_type: "impulse",
    summary: execution.status === "completed" ? execution.summary : `${summary} failed: ${execution.summary}`,
    artifact_path: execution.status === "completed" ? artifactPath : undefined,
    timestamp: new Date().toISOString(),
    user_visible: true,
  });

  emitAudit(
    config.auditPath,
    tenant.tenant,
    execution.status === "completed" ? "completed" : "error",
    `${summary}: ${execution.summary}`,
    startedAt
  );
}

export async function runOrchestratorTick(config: OrchestratorConfig): Promise<void> {
  const loaded = loadTenantConfig(config.tenantConfigPath);
  const timezone = loaded.timezone ?? config.timezone;
  const tenants = loaded.tenants.filter((tenant) => tenant.enabled);
  const state = loadState(config.statePath);
  const notifier = createNotifier();
  const now = new Date();
  const today = dayKey(now, timezone);

  for (const tenant of tenants) {
    if (!tenant.nightly_dream_enabled) continue;
    const slotKey = `${tenant.tenant}:${today}:${tenant.nightly_dream_time}`;
    if (state.nightly_slots[slotKey]) continue;
    if (!isSlotDue(tenant.nightly_dream_time, now, timezone, config.slotGraceMinutes)) continue;

    const startedAt = Date.now();
    const brain = new BrainClient(config.brainUrl, config.brainApiKey, tenant.tenant);
    const dream = await buildNightlyDreamRecord(brain, tenant, now);
    state.nightly_slots[slotKey] = now.toISOString();
    emitAudit(config.auditPath, tenant.tenant, "completed", dream.summary, startedAt);
  }

  for (let pass = 0; pass < config.maxDutyPasses; pass += 1) {
    let progressed = false;
    for (const tenant of tenants) {
      const ran = await runTriggeredTask(config, notifier, tenant, tenants, "duty");
      progressed = progressed || ran;
    }
    if (!progressed) break;
  }

  for (const tenant of tenants) {
    for (const slot of tenant.personal_wakes) {
      const slotKey = `${tenant.tenant}:${today}:${slot}`;
      if (state.personal_slots[slotKey]) continue;
      if (!isSlotDue(slot, now, timezone, config.slotGraceMinutes)) continue;

      await runPersonalWake(config, notifier, tenant, now);
      state.personal_slots[slotKey] = now.toISOString();
    }
  }

  for (const tenant of tenants) {
    if (!tenant.impulse_enabled) continue;
    if (!isImpulseDue(tenant, state, now)) continue;
    await runImpulseWake(config, notifier, tenant, now);
    state.impulse_runs[tenant.tenant] = now.toISOString();
  }

  saveState(config.statePath, state);
}
