import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";
import { loadTenantConfig } from "../src/tenants.ts";

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const snapshot = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    process.env = snapshot;
  }
}

test("loadConfig parses env and clamps numeric limits", () => {
  withEnv(
    {
      ANTHROPIC_API_KEY: "ant-key",
      BRAIN_API_KEY: "brain-key",
      BRAIN_URL: "https://brain.example/mcp",
      TENANT_ID: "rainer",
      MODEL: "claude-test",
      MAX_ITERATIONS: "999",
      MAX_TOKENS: "10",
      MAX_REPAIRS: "99",
      STAGE_TIMEOUT_MS: "5",
      ENABLE_SELF_IMPROVEMENT: "true",
      PROPOSAL_REVIEW_LIMIT: "999",
      PROPOSAL_ACCEPT_THRESHOLD: "2",
      SCHEDULE: "*/10 * * * *",
      AUDIT_PATH: "./state/test-audit.jsonl",
      ARTIFACT_DIR: "./state/test-artifacts",
      HARNESS_AGENT_PATH: "./harness/rainer.md",
      SYSTEM_PROMPT_PATH: "./system-prompt.txt",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.anthropicApiKey, "ant-key");
      assert.equal(config.brainApiKey, "brain-key");
      assert.equal(config.brainUrl, "https://brain.example/mcp");
      assert.equal(config.tenantId, "rainer");
      assert.equal(config.model, "claude-test");
      assert.equal(config.maxIterations, 100);
      assert.equal(config.maxTokens, 256);
      assert.equal(config.maxRepairs, 5);
      assert.equal(config.stageTimeoutMs, 10_000);
      assert.equal(config.enableSelfImprovement, true);
      assert.equal(config.proposalReviewLimit, 50);
      assert.equal(config.proposalAcceptThreshold, 1);
      assert.match(config.auditPath, /state\/test-audit\.jsonl$/);
      assert.match(config.artifactDir, /state\/test-artifacts$/);
      assert.match(config.harnessAgentPath, /harness\/rainer\.md$/);
      assert.ok(config.systemPrompt && config.systemPrompt.length > 0);
    }
  );
});

test("loadConfig rejects missing required env vars", () => {
  withEnv(
    {
      ANTHROPIC_API_KEY: undefined,
      BRAIN_API_KEY: "brain-key",
    },
    () => {
      assert.throws(() => loadConfig(), /Missing required env var: ANTHROPIC_API_KEY/);
    }
  );
});

test("loadConfig blocks path traversal outside runner root", () => {
  withEnv(
    {
      ANTHROPIC_API_KEY: "ant-key",
      BRAIN_API_KEY: "brain-key",
      AUDIT_PATH: "../escape.jsonl",
    },
    () => {
      assert.throws(() => loadConfig(), /AUDIT_PATH must resolve within runner directory/);
    }
  );
});

test("loadTenantConfig parses providers and validates invalid provider values", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runner-tenant-config-"));
  const workspace = mkdtempSync(join(tmpdir(), "runner-workspace-"));
  const configPath = join(tempRoot, "tenants.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          timezone: "Europe/Berlin",
          tenants: {
            rainer: {
              provider: "codex",
              workspace_path: workspace,
              enabled: true,
              personal_wakes: ["08:00"],
              impulse_enabled: true,
              telegram_enabled: false,
              nightly_dream_enabled: true,
              nightly_dream_time: "03:30",
              impulse_check_interval_minutes: 180,
            },
          },
        },
        null,
        2
      )
    );

    const parsed = loadTenantConfig(configPath);
    assert.equal(parsed.timezone, "Europe/Berlin");
    assert.equal(parsed.tenants.length, 1);
    assert.equal(parsed.tenants[0]?.provider, "codex");

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          tenants: {
            rainer: {
              provider: "not-a-provider",
              workspace_path: workspace,
            },
          },
        },
        null,
        2
      )
    );

    assert.throws(() => loadTenantConfig(configPath), /provider must be one of/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
