import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOrchestratorTick, type OrchestratorConfig } from "../src/orchestrator.ts";

function makeConfig(tenantConfigPath: string, statePath: string, auditPath: string): OrchestratorConfig {
  return {
    brainUrl: "https://example.invalid/mcp",
    brainApiKey: "test-api-key",
    tenantConfigPath,
    statePath,
    auditPath,
    timezone: "Europe/Berlin",
    slotGraceMinutes: 10,
    maxDutyPasses: 2,
  };
}

test("orchestrator kill switch: disabled tenants skip execution and keep state replay-stable", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runner-orchestrator-gauntlet-"));
  const workspace = mkdtempSync(join(tmpdir(), "runner-orchestrator-workspace-"));
  const tenantConfigPath = join(tempRoot, "tenants.json");
  const statePath = join(tempRoot, "orchestrator-state.json");
  const auditPath = join(tempRoot, "orchestrator-audit.jsonl");

  try {
    writeFileSync(
      tenantConfigPath,
      JSON.stringify(
        {
          timezone: "Europe/Berlin",
          tenants: {
            rook: {
              provider: "claude",
              workspace_path: workspace,
              enabled: false,
              personal_wakes: ["09:00"],
              impulse_enabled: true,
              telegram_enabled: false,
              nightly_dream_enabled: true,
              nightly_dream_time: "03:30",
              impulse_check_interval_minutes: 180,
            },
            rainer: {
              provider: "codex",
              workspace_path: workspace,
              enabled: false,
              personal_wakes: ["06:00"],
              impulse_enabled: false,
              telegram_enabled: false,
              nightly_dream_enabled: false,
              nightly_dream_time: "03:45",
              impulse_check_interval_minutes: 180,
            },
          },
        },
        null,
        2
      )
    );

    const config = makeConfig(tenantConfigPath, statePath, auditPath);

    await runOrchestratorTick(config);

    assert.equal(existsSync(statePath), true);
    assert.equal(existsSync(auditPath), false, "no tenants enabled should produce no audit entries");

    const firstState = JSON.parse(readFileSync(statePath, "utf-8")) as {
      personal_slots?: Record<string, string>;
      nightly_slots?: Record<string, string>;
      impulse_runs?: Record<string, string>;
    };

    assert.deepEqual(firstState.personal_slots ?? {}, {});
    assert.deepEqual(firstState.nightly_slots ?? {}, {});
    assert.deepEqual(firstState.impulse_runs ?? {}, {});

    await runOrchestratorTick(config);

    const secondState = JSON.parse(readFileSync(statePath, "utf-8"));
    assert.deepEqual(secondState, firstState, "disabled-tenant ticks should be replay-stable");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
