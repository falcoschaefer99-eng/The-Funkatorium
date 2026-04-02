import type { BrainClient } from "./brain.js";
import type { TenantRuntimeConfig } from "./tenants.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function stringifyContext(label: string, value: JsonValue): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `${label}:\n${rendered}`.trim();
}

function personalArtifactPath(tenant: TenantRuntimeConfig, now: Date): string {
  const stamp = now.toISOString().replace(/[:]/g, "").replace(/\..+$/, "Z");
  return `${tenant.workspace_path}/personal/${stamp}-${tenant.tenant}.md`;
}

function impulseArtifactPath(tenant: TenantRuntimeConfig, now: Date): string {
  const stamp = now.toISOString().replace(/[:]/g, "").replace(/\..+$/, "Z");
  return `${tenant.workspace_path}/impulses/${stamp}-${tenant.tenant}.md`;
}

export async function buildNightlyDreamRecord(
  brain: BrainClient,
  tenant: TenantRuntimeConfig,
  now: Date
): Promise<{ summary: string; rawDream: string }> {
  const rawDream = await brain.callTool("mind_dream", {
    mode: "dream",
    dream_mode: "deep_dream",
    depth: 4,
  });

  const summary = `Nightly deep dream for ${tenant.tenant} at ${now.toISOString()}`;
  await brain.callTool("mind_observe", {
    mode: "observe",
    territory: "episodic",
    salience: "background",
    grip: "loose",
    vividness: "soft",
    content: `${summary}\n\n${rawDream}`,
    context: "orchestrator_nightly_deep_dream",
  });

  return { summary, rawDream };
}

export async function buildPersonalWakePrompt(
  brain: BrainClient,
  tenant: TenantRuntimeConfig,
  now: Date
): Promise<{ prompt: string; artifactPath: string; summary: string }> {
  const artifactPath = personalArtifactPath(tenant, now);

  const [state, desires, loops, subconscious, recentDream] = await Promise.all([
    brain.callToolJson<JsonValue>("mind_state", {}),
    brain.callToolJson<JsonValue>("mind_desire", { action: "list", include_fulfilled: false }),
    brain.callToolJson<JsonValue>("mind_loop", { action: "list" }),
    brain.callToolJson<JsonValue>("mind_subconscious", { action: "patterns" }),
    brain.callToolJson<JsonValue>("mind_query", {
      query: "Nightly deep dream",
      limit: 1,
      full: true,
      territory: "episodic",
    }),
  ]);

  const summary = `Personal recurring wake for ${tenant.tenant}`;
  const prompt = [
    `You are running a personal recurring wake for tenant ${tenant.tenant}.`,
    `Write one meaningful local artifact to: ${artifactPath}`,
    `The artifact can be a reflection, poem, note, voice-note prep, or short synthesis.`,
    `Ground the wake in the supplied dream/desire/paradox/subconscious context.`,
    `If a runnable task already exists in the system, that duty should take precedence over personal wandering.`,
    `If outside research is genuinely needed, do at most one lightweight Scout-on-Haiku style research pass.`,
    `If you produce meaningful writing, use the relevant writing/editorial protocol rather than vague freeform drafting.`,
    `Use the brain truthfully. Start with mind_wake(depth=\"quick\") if useful, then do the work.`,
    `Before finishing, record what mattered with mind_observe.`,
    `End with one line exactly in this format: RUN_STATUS=completed | <very short summary>`,
    "",
    stringifyContext("Current state", state),
    "",
    stringifyContext("Active desires", desires),
    "",
    stringifyContext("Active loops", loops),
    "",
    stringifyContext("Subconscious patterns", subconscious),
    "",
    stringifyContext("Most recent nightly dream", recentDream),
  ].join("\n");

  return { prompt, artifactPath, summary };
}

export async function buildImpulseWakePrompt(
  brain: BrainClient,
  tenant: TenantRuntimeConfig,
  now: Date
): Promise<{ prompt: string; artifactPath: string; summary: string }> {
  const artifactPath = impulseArtifactPath(tenant, now);
  const [desires, loops, subconscious, recentDream] = await Promise.all([
    brain.callToolJson<JsonValue>("mind_desire", { action: "list", include_fulfilled: false }),
    brain.callToolJson<JsonValue>("mind_loop", { action: "list" }),
    brain.callToolJson<JsonValue>("mind_subconscious", { action: "patterns" }),
    brain.callToolJson<JsonValue>("mind_query", {
      query: "Nightly deep dream",
      limit: 1,
      full: true,
      territory: "episodic",
    }),
  ]);

  const summary = `Impulse wake for ${tenant.tenant}`;
  const prompt = [
    `You are running an autonomous impulse/explore wake for tenant ${tenant.tenant}.`,
    `Write one concrete local artifact to: ${artifactPath}`,
    `Follow the strongest live thread from desire, paradox, subconscious heat, or recent dream residue.`,
    `Keep the scope modest but real. Research, synthesize, sketch, or draft something useful.`,
    `Use at most one lightweight Scout-on-Haiku style research pass if web retrieval is truly needed.`,
    `If the output becomes serious writing or review work, shift into the relevant writing/editorial protocol so the artifact earns its keep.`,
    `Record the wake with mind_observe before you finish.`,
    `End with one line exactly in this format: RUN_STATUS=completed | <very short summary>`,
    "",
    stringifyContext("Active desires", desires),
    "",
    stringifyContext("Active loops", loops),
    "",
    stringifyContext("Subconscious patterns", subconscious),
    "",
    stringifyContext("Most recent nightly dream", recentDream),
  ].join("\n");

  return { prompt, artifactPath, summary };
}
