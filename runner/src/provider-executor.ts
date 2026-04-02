import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawn } from "child_process";
import type { ProviderKind } from "./tenants.js";

export interface ProviderExecutionInput {
  tenant: string;
  provider: ProviderKind;
  workspacePath: string;
  prompt: string;
  wakeType: "duty" | "personal" | "impulse";
  model?: string;
  resumeSessionId?: string;
  allowArtifactWrites?: boolean;
}

export interface ProviderExecutionResult {
  provider: string;
  status: "completed" | "error";
  summary: string;
  model: string;
  tenant: string;
  turns: number;
  cost_usd: number;
  workspace_path: string;
  raw_output?: string;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

export function buildProviderExecutionEnv(
  input: ProviderExecutionInput,
  promptPath: string,
  resultPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    TENANT_ID: input.tenant,
    RUNNER_PROVIDER: input.provider,
    WORKSPACE_PATH: input.workspacePath,
    RUNNER_PROMPT_FILE: promptPath,
    RUNNER_RESULT_PATH: resultPath,
    ALLOW_ARTIFACT_WRITES: input.allowArtifactWrites ? "true" : "false",
  };

  if (input.resumeSessionId) {
    env["RUNNER_RESUME_SESSION_ID"] = input.resumeSessionId;
  }

  if (input.model) {
    if (input.provider === "codex") env["CODEX_MODEL"] = input.model;
    else if (input.provider === "claude") env["CLAUDE_MODEL"] = input.model;
    else env["MODEL"] = input.model;
  }

  return env;
}

export async function executeProviderRun(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "muse-runner-"));
  const promptPath = join(tempDir, "prompt.txt");
  const resultPath = join(tempDir, "result.json");
  const runScriptPath = resolve(new URL("../run.sh", import.meta.url).pathname);

  try {
    writeFileSync(promptPath, input.prompt, "utf-8");

    const env = buildProviderExecutionEnv(input, promptPath, resultPath);

    const { code, stdout, stderr } = await runCommand("bash", [runScriptPath], env);

    let parsed: ProviderExecutionResult | null = null;
    try {
      parsed = JSON.parse(readFileSync(resultPath, "utf-8")) as ProviderExecutionResult;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return {
        provider: input.provider,
        status: code === 0 ? "completed" : "error",
        summary: (stderr || stdout || "Runner did not produce a result payload").trim().slice(0, 500),
        model: input.model ?? "unknown",
        tenant: input.tenant,
        turns: 0,
        cost_usd: 0,
        workspace_path: input.workspacePath,
        raw_output: `${stdout}\n${stderr}`.trim(),
      };
    }

    return {
      ...parsed,
      raw_output: `${stdout}\n${stderr}`.trim() || parsed.raw_output,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
