import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderExecutionEnv } from "../src/provider-executor.ts";

test("buildProviderExecutionEnv maps codex model and resume session", () => {
  const env = buildProviderExecutionEnv(
    {
      tenant: "rainer",
      provider: "codex",
      workspacePath: "/tmp/work",
      prompt: "do work",
      wakeType: "duty",
      model: "gpt-5.4",
      resumeSessionId: "sess_123",
      allowArtifactWrites: true,
    },
    "/tmp/prompt.txt",
    "/tmp/result.json",
    { BASE: "1" }
  );

  assert.equal(env.BASE, "1");
  assert.equal(env.TENANT_ID, "rainer");
  assert.equal(env.RUNNER_PROVIDER, "codex");
  assert.equal(env.CODEX_MODEL, "gpt-5.4");
  assert.equal(env.RUNNER_RESUME_SESSION_ID, "sess_123");
  assert.equal(env.ALLOW_ARTIFACT_WRITES, "true");
});

test("buildProviderExecutionEnv maps claude and anthropic_api models correctly", () => {
  const claudeEnv = buildProviderExecutionEnv(
    {
      tenant: "rainer",
      provider: "claude",
      workspacePath: "/tmp/work",
      prompt: "do work",
      wakeType: "duty",
      model: "claude-sonnet-test",
    },
    "/tmp/prompt.txt",
    "/tmp/result.json"
  );

  assert.equal(claudeEnv.CLAUDE_MODEL, "claude-sonnet-test");
  assert.equal(claudeEnv.CODEX_MODEL, undefined);

  const apiEnv = buildProviderExecutionEnv(
    {
      tenant: "rainer",
      provider: "anthropic_api",
      workspacePath: "/tmp/work",
      prompt: "do work",
      wakeType: "duty",
      model: "claude-api-model",
    },
    "/tmp/prompt.txt",
    "/tmp/result.json"
  );

  assert.equal(apiEnv.MODEL, "claude-api-model");
  assert.equal(apiEnv.CLAUDE_MODEL, undefined);
  assert.equal(apiEnv.CODEX_MODEL, undefined);
});
