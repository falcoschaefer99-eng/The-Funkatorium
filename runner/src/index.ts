import { loadConfig } from "./config.js";
import { startDaemon, executeRun } from "./schedule.js";
import { loadOrchestratorConfig, runOrchestratorTick } from "./orchestrator.js";

// Load .env manually if not in a process that already loaded it
// (node-cron daemon mode, system cron both need this)
const envPath = new URL("../.env", import.meta.url).pathname;
try {
  const { readFileSync, existsSync } = await import("fs");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      // Only set if not already set — system env takes precedence
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  // .env absent or unreadable — rely entirely on process env
}

const isDaemon = process.argv.includes("--daemon");
const isOrchestrator = process.argv.includes("--orchestrator");

if (isOrchestrator) {
  try {
    const orchestratorConfig = loadOrchestratorConfig();
    await runOrchestratorTick(orchestratorConfig);
    process.exit(0);
  } catch (err: unknown) {
    console.error("[orchestrator] Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

let config;
try {
  config = loadConfig();
} catch (err: unknown) {
  console.error("[runner] Config error:", err instanceof Error ? err.message : err);
  process.exit(1);
}

if (isDaemon) {
  startDaemon(config);
  // Keep process alive — node-cron handles the scheduling
} else {
  // Single run mode — used by system cron or manual invocation
  try {
    await executeRun(config);
    process.exit(0);
  } catch (err: unknown) {
    console.error("[runner] Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
