import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = join(TEST_DIR, "..");
const RUN_SCRIPT = join(RUNNER_ROOT, "run.sh");

type StubClaudePayload = {
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  result: string;
};

function writeStubClaude(binDir: string, payload: StubClaudePayload, exitCode = 0): void {
  const scriptPath = join(binDir, "claude");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash\necho '${JSON.stringify(payload)}'\nexit ${exitCode}\n`,
    "utf-8"
  );
  chmodSync(scriptPath, 0o755);
}

function runRunner(
  tempRoot: string,
  workspacePath: string,
  binDir: string,
  envOverrides: Record<string, string | undefined>
) {
  const auditPath = join(tempRoot, "audit.jsonl");
  const resultPath = join(tempRoot, "result.json");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    RUNNER_PROVIDER: "claude",
    TENANT_ID: "rainer",
    CLAUDE_MODEL: "claude-test-model",
    WORKSPACE_PATH: workspacePath,
    AUDIT_PATH: auditPath,
    RUNNER_RESULT_PATH: resultPath,
    ...envOverrides,
  };

  const proc = spawnSync("bash", [RUN_SCRIPT], {
    cwd: RUNNER_ROOT,
    env,
    encoding: "utf-8",
  });

  const parsedResult = JSON.parse(readFileSync(resultPath, "utf-8")) as {
    status: string;
    provider: string;
    summary: string;
    tenant: string;
  };

  const auditLines = readFileSync(auditPath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { status: string; provider: string; summary: string; tenant: string; timestamp: string });

  return { proc, parsedResult, auditLines };
}

test("run.sh happy path writes result payload + sane audit line", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runner-script-gauntlet-happy-"));
  const workspace = mkdtempSync(join(tmpdir(), "runner-script-workspace-"));
  const binDir = mkdtempSync(join(tmpdir(), "runner-script-bin-"));

  try {
    writeStubClaude(
      binDir,
      {
        is_error: false,
        num_turns: 4,
        total_cost_usd: 0.42,
        result: "RUN_STATUS=completed | completed stub wake",
      },
      0
    );

    const { proc, parsedResult, auditLines } = runRunner(tempRoot, workspace, binDir, {});

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.equal(parsedResult.status, "completed");
    assert.equal(parsedResult.provider, "claude");
    assert.equal(parsedResult.tenant, "rainer");
    assert.match(parsedResult.summary, /RUN_STATUS=completed/i);

    assert.equal(auditLines.length, 1);
    assert.equal(auditLines[0]?.status, "completed");
    assert.equal(auditLines[0]?.provider, "claude");
    assert.equal(auditLines[0]?.tenant, "rainer");
    assert.match(auditLines[0]?.summary ?? "", /completed stub wake/i);
    assert.ok(/\d{4}-\d{2}-\d{2}T/.test(auditLines[0]?.timestamp ?? ""), "timestamp should be ISO-like");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("run.sh failure path still writes error result + audit", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runner-script-gauntlet-fail-"));
  const workspace = mkdtempSync(join(tmpdir(), "runner-script-workspace-"));
  const binDir = mkdtempSync(join(tmpdir(), "runner-script-bin-"));

  try {
    writeStubClaude(
      binDir,
      {
        is_error: true,
        num_turns: 2,
        total_cost_usd: 0.11,
        result: "RUN_STATUS=blocked | stubbed failure",
      },
      1
    );

    const { proc, parsedResult, auditLines } = runRunner(tempRoot, workspace, binDir, {});

    assert.notEqual(proc.status, 0);
    assert.equal(parsedResult.status, "error");
    assert.equal(parsedResult.provider, "claude");
    assert.match(parsedResult.summary, /blocked|failure/i);

    assert.equal(auditLines.length, 1);
    assert.equal(auditLines[0]?.status, "error");
    assert.equal(auditLines[0]?.provider, "claude");
    assert.match(auditLines[0]?.summary ?? "", /blocked|failure/i);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("run.sh replay with same inputs keeps stable status/summary while appending audit", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runner-script-gauntlet-replay-"));
  const workspace = mkdtempSync(join(tmpdir(), "runner-script-workspace-"));
  const binDir = mkdtempSync(join(tmpdir(), "runner-script-bin-"));

  try {
    writeStubClaude(
      binDir,
      {
        is_error: false,
        num_turns: 3,
        total_cost_usd: 0.2,
        result: "RUN_STATUS=completed | replay stable run",
      },
      0
    );

    const first = runRunner(tempRoot, workspace, binDir, {});
    const second = runRunner(tempRoot, workspace, binDir, {});

    assert.equal(first.proc.status, 0);
    assert.equal(second.proc.status, 0);
    assert.equal(first.parsedResult.status, "completed");
    assert.equal(second.parsedResult.status, "completed");
    assert.equal(first.parsedResult.summary, second.parsedResult.summary);

    assert.equal(second.auditLines.length, 2);
    assert.equal(second.auditLines[0]?.status, "completed");
    assert.equal(second.auditLines[1]?.status, "completed");
    assert.equal(second.auditLines[0]?.summary, second.auditLines[1]?.summary);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
