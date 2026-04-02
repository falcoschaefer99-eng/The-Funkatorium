import assert from "node:assert/strict";
import test from "node:test";
import { buildRunnerExecutionPlan } from "../src/orchestrator.ts";

test("buildRunnerExecutionPlan blocks deferred triggers", () => {
  const plan = buildRunnerExecutionPlan({
    deferred: true,
    runner_contract: {
      should_run: true,
      prompt: "run it",
      resume_session_id: "sess_abc",
      task: { id: "task_1", title: "Review: thing" },
    },
  });

  assert.equal(plan.shouldRun, false);
  assert.equal(plan.resumeSessionId, "sess_abc");
  assert.equal(plan.taskId, "task_1");
});

test("buildRunnerExecutionPlan blocks incomplete contracts", () => {
  const missingPrompt = buildRunnerExecutionPlan({
    runner_contract: {
      should_run: true,
      task: { id: "task_2", title: "Task" },
    },
  });

  assert.equal(missingPrompt.shouldRun, false);
});

test("buildRunnerExecutionPlan returns runnable contract details", () => {
  const plan = buildRunnerExecutionPlan({
    deferred: false,
    runner_contract: {
      should_run: true,
      prompt: "follow this contract",
      resume_session_id: "sess_resume",
      task: { id: "task_9", title: "Review: contract" },
    },
  });

  assert.equal(plan.shouldRun, true);
  assert.equal(plan.prompt, "follow this contract");
  assert.equal(plan.resumeSessionId, "sess_resume");
  assert.equal(plan.taskId, "task_9");
  assert.equal(plan.taskTitle, "Review: contract");
});
