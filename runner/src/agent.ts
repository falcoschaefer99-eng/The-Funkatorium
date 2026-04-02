import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import { BrainClient } from "./brain.js";
import { loadHarnessDefinition } from "./harness/contracts.js";
import {
  buildPlanPrompt,
  buildExecutePrompt,
  buildRepairPrompt,
  type StageArtifact,
  type StageName,
} from "./harness/stages.js";
import { HarnessFailure, type FailureCode } from "./harness/failures.js";
import { runValidationGates } from "./harness/validate.js";
import { appendArtifactLedger, writeStageArtifact } from "./harness/artifacts.js";
import { runSelfImprovement, type SelfImprovementResult } from "./self-improvement.js";

const DEFAULT_SYSTEM = `You are an autonomous AI running a harnessed duty cycle.
Respect stage boundaries.
Use tools truthfully and efficiently.
Never fabricate tool outcomes.
Return concise, actionable outputs.`;

interface StageExecutionResult {
  finalText: string;
  iterations: number;
  toolCalls: string[];
  toolErrors: string[];
}

export interface AgentResult {
  iterations: number;
  toolCallsMade: string[];
  status: "completed" | "budget_exceeded" | "validation_failed" | "error";
  summary: string;
  failureCode?: FailureCode;
  error?: string;
  artifactPaths: string[];
  selfImprovement?: SelfImprovementResult;
}

function makeRunId(): string {
  return `run_${new Date().toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeOutput(parsedOutput: Record<string, unknown> | null, rawText: string): string {
  if (parsedOutput && typeof parsedOutput["run_summary"] === "string") {
    return parsedOutput["run_summary"].slice(0, 500);
  }
  return (rawText || "(no final text)").slice(0, 500);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: StageName): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HarnessFailure("timeout", `Stage ${stage} timed out after ${timeoutMs}ms`, stage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runTextStage(
  anthropic: Anthropic,
  model: string,
  systemPrompt: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
  stage: StageName
): Promise<string> {
  const response = await withTimeout(
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
    timeoutMs,
    stage
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text;
}

async function runToolStage(params: {
  anthropic: Anthropic;
  model: string;
  systemPrompt: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  iterationBudget: number;
  tools: Anthropic.Tool[];
  brain: BrainClient;
  stage: StageName;
}): Promise<StageExecutionResult> {
  const {
    anthropic,
    model,
    systemPrompt,
    prompt,
    maxTokens,
    timeoutMs,
    iterationBudget,
    tools,
    brain,
    stage,
  } = params;

  type Message = Anthropic.MessageParam;
  const messages: Message[] = [{ role: "user", content: prompt }];

  let iterations = 0;
  let finalText = "";
  const toolCalls: string[] = [];
  const toolErrors: string[] = [];

  while (iterations < iterationBudget) {
    const response = await withTimeout(
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools,
        messages,
      }),
      timeoutMs,
      stage
    );

    if (response.stop_reason === "end_turn") {
      finalText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        toolCalls.push(toolUse.name);
        try {
          const resultText = await brain.callTool(toolUse.name, toolUse.input as Record<string, unknown>);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: resultText,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          toolErrors.push(`${toolUse.name}: ${msg}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: ${msg}`,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
      iterations += 1;
      continue;
    }

    finalText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    break;
  }

  return {
    finalText,
    iterations,
    toolCalls,
    toolErrors,
  };
}

function persistStageArtifact(
  config: Config,
  artifact: StageArtifact,
  artifactPaths: string[]
): void {
  const written = writeStageArtifact(config.artifactDir, artifact);
  artifactPaths.push(written.path);
  appendArtifactLedger(config.artifactDir, {
    timestamp: artifact.completed_at,
    run_id: artifact.run_id,
    stage: artifact.stage,
    attempt: artifact.attempt,
    status: artifact.status,
    failure_code: artifact.failure_code,
    artifact_path: written.path,
  });
}

export async function runAgent(config: Config, brain: BrainClient): Promise<AgentResult> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const artifactPaths: string[] = [];
  const toolCallsMade: string[] = [];
  const runId = makeRunId();
  let totalIterations = 0;
  let status: AgentResult["status"] = "completed";
  let failureCode: FailureCode | undefined;
  let finalSummary = "(no final text)";
  let selfImprovement: SelfImprovementResult | undefined;

  try {
    const harness = loadHarnessDefinition(config.harnessAgentPath);
    const model = harness.model ?? config.model;
    const system = config.systemPrompt ?? DEFAULT_SYSTEM;
    const tools = await brain.listTools();

    const wakeResult = await brain.callTool("mind_wake", { depth: "full" });
    toolCallsMade.push("mind_wake");

    const planPrompt = buildPlanPrompt(
      wakeResult,
      harness.contract.required_outputs,
      harness.prompt_body
    );

    const planStart = new Date().toISOString();
    const planText = await runTextStage(
      anthropic,
      model,
      system,
      planPrompt,
      config.maxTokens,
      config.stageTimeoutMs,
      "plan"
    );
    const planDone = new Date().toISOString();
    if (!planText) {
      throw new HarnessFailure("empty_output", "Plan stage returned empty output", "plan");
    }

    persistStageArtifact(
      config,
      {
        run_id: runId,
        stage: "plan",
        attempt: 1,
        started_at: planStart,
        completed_at: planDone,
        status: "completed",
        input: {
          required_outputs: harness.contract.required_outputs,
        },
        output: {
          text: planText,
        },
      },
      artifactPaths
    );

    const repairAllowedByFlow = harness.contract.stage_flow.includes("repair");
    const maxRepairs = repairAllowedByFlow
      ? Math.min(config.maxRepairs, harness.contract.stop_conditions.max_repairs)
      : 0;

    let executeAttempt = 0;
    let lastExecuteText = "";
    let parsedOutput: Record<string, unknown> | null = null;
    let validationPassed = false;
    let validationFailureReasons: string[] = [];

    while (executeAttempt <= maxRepairs && !validationPassed) {
      const isRepair = executeAttempt > 0;
      const stage: StageName = isRepair ? "repair" : "execute";
      const stageStart = new Date().toISOString();

      const remainingIterations = config.maxIterations - totalIterations;
      if (remainingIterations <= 0) {
        throw new HarnessFailure(
          "budget_exceeded",
          `No iteration budget left before ${stage} stage`,
          stage
        );
      }

      const prompt = isRepair
        ? buildRepairPrompt(
            wakeResult,
            planText,
            lastExecuteText,
            validationFailureReasons,
            harness.contract.required_outputs,
            harness.prompt_body
          )
        : buildExecutePrompt(
            wakeResult,
            planText,
            harness.contract.required_outputs,
            harness.prompt_body
          );

      const executeResult = await runToolStage({
        anthropic,
        model,
        systemPrompt: system,
        prompt,
        maxTokens: config.maxTokens,
        timeoutMs: config.stageTimeoutMs,
        iterationBudget: remainingIterations,
        tools,
        brain,
        stage,
      });

      totalIterations += executeResult.iterations;
      toolCallsMade.push(...executeResult.toolCalls);
      lastExecuteText = executeResult.finalText;
      parsedOutput = parseJsonObject(lastExecuteText);

      const executeDone = new Date().toISOString();
      persistStageArtifact(
        config,
        {
          run_id: runId,
          stage,
          attempt: executeAttempt + 1,
          started_at: stageStart,
          completed_at: executeDone,
          status: "completed",
          input: {
            plan: planText,
            required_outputs: harness.contract.required_outputs,
            failure_reasons: isRepair ? validationFailureReasons : [],
          },
          output: {
            text: executeResult.finalText,
            parsed_output: parsedOutput,
            tool_calls: executeResult.toolCalls,
            tool_errors: executeResult.toolErrors,
            iterations: executeResult.iterations,
          },
        },
        artifactPaths
      );

      if (!executeResult.finalText.trim()) {
        throw new HarnessFailure(
          executeResult.toolErrors.length > 0 ? "tool_fail" : "empty_output",
          `${stage} stage produced empty output`,
          stage
        );
      }

      if (totalIterations >= config.maxIterations && !parsedOutput) {
        throw new HarnessFailure(
          "budget_exceeded",
          `Iteration budget exhausted during ${stage} stage`,
          stage
        );
      }

      const verifyStart = new Date().toISOString();
      const validation = runValidationGates(harness.contract, {
        parsed_output: parsedOutput,
        raw_output: executeResult.finalText,
        tool_calls: toolCallsMade,
        iterations: totalIterations,
        max_iterations: config.maxIterations,
      });
      const verifyDone = new Date().toISOString();

      validationPassed = validation.passed;
      validationFailureReasons = validation.failure_reasons;

      persistStageArtifact(
        config,
        {
          run_id: runId,
          stage: "verify",
          attempt: executeAttempt + 1,
          started_at: verifyStart,
          completed_at: verifyDone,
          status: validation.passed ? "completed" : "failed",
          failure_code: validation.passed ? undefined : "validation_fail",
          input: {
            output_preview: executeResult.finalText.slice(0, 3000),
            tool_calls: toolCallsMade,
          },
          output: {
            passed: validation.passed,
            gate_results: validation.results,
            failure_reasons: validation.failure_reasons,
          },
        },
        artifactPaths
      );

      executeAttempt += 1;
    }

    if (!validationPassed) {
      status = "validation_failed";
      failureCode = "validation_fail";
    }

    finalSummary = summarizeOutput(parsedOutput, lastExecuteText);

    selfImprovement = await runSelfImprovement({
      config,
      brain,
      runId,
      harnessName: harness.name,
      runSummary: finalSummary,
    });
    if (selfImprovement.toolCalls.length > 0) {
      toolCallsMade.push(...selfImprovement.toolCalls);
    }
    if (selfImprovement.error && status === "completed") {
      // Telemetry issues should not fail the run, but we surface them.
      finalSummary = `${finalSummary} | self-improvement warning: ${selfImprovement.error}`.slice(0, 500);
    }

    try {
      await brain.callTool("mind_runtime", {
        action: "log_run",
        status: status === "completed" ? "completed" : "failed",
        summary: finalSummary,
        trigger_mode: "duty",
        wake_kind: "duty",
        metadata: selfImprovement
          ? {
              self_improvement: {
                enabled: selfImprovement.enabled,
                pending: selfImprovement.pending,
                reviewed: selfImprovement.reviewed,
                accepted: selfImprovement.accepted,
                rejected: selfImprovement.rejected,
                reviewed_ids: selfImprovement.reviewedIds,
                error: selfImprovement.error,
              },
            }
          : undefined,
      });
      toolCallsMade.push("mind_runtime");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toolCallsMade.push("mind_runtime");
      if (status === "completed") {
        status = "error";
        failureCode = "tool_fail";
      }
      return {
        iterations: totalIterations,
        toolCallsMade,
        status,
        summary: finalSummary,
        failureCode,
        error: `mind_runtime log_run failed: ${msg}`,
        artifactPaths,
        selfImprovement,
      };
    }

    return {
      iterations: totalIterations,
      toolCallsMade,
      status,
      summary: finalSummary,
      failureCode,
      artifactPaths,
      selfImprovement,
    };
  } catch (err: unknown) {
    if (err instanceof HarnessFailure) {
      return {
        iterations: totalIterations,
        toolCallsMade,
        status: err.code === "budget_exceeded" ? "budget_exceeded" : "error",
        summary: finalSummary,
        failureCode: err.code,
        error: err.message,
        artifactPaths,
        selfImprovement,
      };
    }

    return {
      iterations: totalIterations,
      toolCallsMade,
      status: "error",
      summary: finalSummary,
      failureCode,
      error: err instanceof Error ? err.message : String(err),
      artifactPaths,
      selfImprovement,
    };
  }
}
