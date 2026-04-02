import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = resolve(__dirname, "..");

export type ProviderKind = "claude" | "codex" | "anthropic_api" | "auto";

export interface TenantRuntimeConfig {
  tenant: string;
  provider: ProviderKind;
  workspace_path: string;
  enabled: boolean;
  personal_wakes: string[];
  impulse_enabled: boolean;
  telegram_enabled: boolean;
  nightly_dream_enabled: boolean;
  nightly_dream_time: string;
  impulse_check_interval_minutes: number;
  model?: string;
}

export interface TenantConfigFile {
  timezone?: string;
  tenants: Record<string, Omit<TenantRuntimeConfig, "tenant">>;
}

const PROVIDERS = new Set<ProviderKind>(["claude", "codex", "anthropic_api", "auto"]);
const DEFAULT_NIGHTLY_DREAM_TIME = "03:30";
const DEFAULT_IMPULSE_CHECK_INTERVAL_MINUTES = 180;

function requireJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parseClock(value: unknown, label: string, fallback?: string): string {
  const candidate = typeof value === "string" ? value.trim() : fallback;
  if (!candidate) {
    throw new Error(`${label} is required`);
  }
  if (!/^\d{2}:\d{2}$/.test(candidate)) {
    throw new Error(`${label} must use HH:MM 24-hour format`);
  }
  const [hourRaw, minuteRaw] = candidate.split(":");
  if (!hourRaw || !minuteRaw) {
    throw new Error(`${label} must be a valid clock time`);
  }
  const hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`${label} must be a valid clock time`);
  }
  return `${hourRaw}:${minuteRaw}`;
}

function parseIntWithBounds(
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function validateWorkspacePath(tenant: string, workspacePath: unknown): string {
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    throw new Error(`tenants.${tenant}.workspace_path is required`);
  }
  if (workspacePath.includes("\0")) {
    throw new Error(`tenants.${tenant}.workspace_path contains an invalid null byte`);
  }
  if (!isAbsolute(workspacePath)) {
    throw new Error(`tenants.${tenant}.workspace_path must be an absolute path`);
  }
  if (!existsSync(workspacePath)) {
    throw new Error(`tenants.${tenant}.workspace_path does not exist: ${workspacePath}`);
  }
  return workspacePath;
}

export function resolveRunnerPath(candidatePath: string): string {
  if (candidatePath.includes("\0")) {
    throw new Error(`Invalid path contains null byte: ${candidatePath}`);
  }
  return isAbsolute(candidatePath) ? candidatePath : resolve(RUNNER_ROOT, candidatePath);
}

export function loadTenantConfig(configPath = "./config/tenants.json"): {
  timezone: string | null;
  tenants: TenantRuntimeConfig[];
  configPath: string;
} {
  const resolvedPath = resolveRunnerPath(configPath);
  const fallbackPath = resolveRunnerPath("./config/tenants.example.json");
  const effectivePath = existsSync(resolvedPath) ? resolvedPath : fallbackPath;
  if (!existsSync(effectivePath)) {
    throw new Error(`Tenant config not found: ${resolvedPath}`);
  }

  const raw = readFileSync(effectivePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const root = requireJsonObject(parsed, "tenant config");
  const tenantsRoot = requireJsonObject(root.tenants, "tenant config .tenants");

  const tenants = Object.entries(tenantsRoot).map(([tenant, value]) => {
    const entry = requireJsonObject(value, `tenants.${tenant}`);
    const provider = (typeof entry.provider === "string" ? entry.provider : "auto") as ProviderKind;
    if (!PROVIDERS.has(provider)) {
      throw new Error(`tenants.${tenant}.provider must be one of ${Array.from(PROVIDERS).join(", ")}`);
    }

    return {
      tenant,
      provider,
      workspace_path: validateWorkspacePath(tenant, entry.workspace_path),
      enabled: parseBoolean(entry.enabled, true),
      personal_wakes: parseStringArray(entry.personal_wakes, `tenants.${tenant}.personal_wakes`).map((slot) =>
        parseClock(slot, `tenants.${tenant}.personal_wakes[]`)
      ),
      impulse_enabled: parseBoolean(entry.impulse_enabled, false),
      telegram_enabled: parseBoolean(entry.telegram_enabled, false),
      nightly_dream_enabled: parseBoolean(entry.nightly_dream_enabled, true),
      nightly_dream_time: parseClock(
        entry.nightly_dream_time,
        `tenants.${tenant}.nightly_dream_time`,
        DEFAULT_NIGHTLY_DREAM_TIME
      ),
      impulse_check_interval_minutes: parseIntWithBounds(
        entry.impulse_check_interval_minutes,
        `tenants.${tenant}.impulse_check_interval_minutes`,
        DEFAULT_IMPULSE_CHECK_INTERVAL_MINUTES,
        15,
        24 * 60
      ),
      model: typeof entry.model === "string" && entry.model.trim() ? entry.model.trim() : undefined,
    } satisfies TenantRuntimeConfig;
  });

  return {
    timezone: typeof root.timezone === "string" && root.timezone.trim() ? root.timezone.trim() : null,
    tenants,
    configPath: effectivePath,
  };
}
