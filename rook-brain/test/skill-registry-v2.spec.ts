import { describe, expect, it, vi } from "vitest";
import { handleTool as handleRuntimeTool } from "../src/tools-v2/runtime";
import { handleTool as handleSkillTool } from "../src/tools-v2/skills";
import { handleTool as handleHealthTool } from "../src/tools-v2/health";
import type { CapturedSkillArtifact, CapturedSkillRegistryHealth } from "../src/types";

describe("sprint 9 captured skill registry", () => {
	it("persists captured skill artifact with runtime/task provenance from trigger", async () => {
		const openDueScheduledTasks = vi.fn(async () => 0);
		const listTasks = vi.fn(async () => ([
			{
				id: "task_skill_1",
				tenant_id: "rainer",
				priority: "high",
				status: "open",
				title: "Audit trigger provenance",
				created_at: "2026-03-29T18:00:00.000Z",
				source: "runtime-proof"
			}
		]));
		const createAgentRuntimeRun = vi.fn(async (payload: any) => ({
			id: "runtime_run_skill_1",
			tenant_id: "rainer",
			...payload,
			created_at: "2026-03-29T18:01:00.000Z"
		}));
		const appendToTerritory = vi.fn(async () => {});
		const createCapturedSkillArtifact = vi.fn(async (payload: any): Promise<CapturedSkillArtifact> => ({
			id: "skill_1",
			tenant_id: "rainer",
			version: 1,
			created_at: "2026-03-29T18:01:01.000Z",
			updated_at: "2026-03-29T18:01:01.000Z",
			provenance: {},
			metadata: {},
			layer: "captured",
			status: "candidate",
			name: payload.name,
			skill_key: payload.skill_key,
			agent_tenant: payload.agent_tenant,
			task_type: payload.task_type,
			source_runtime_run_id: payload.source_runtime_run_id,
			source_task_id: payload.source_task_id,
			source_observation_id: payload.source_observation_id
		}));

		const storage = {
			getTenant: () => "rainer",
			getAgentRuntimePolicy: vi.fn(async () => null),
			getAgentRuntimeUsage: vi.fn(async () => ({
				agent_tenant: "rainer",
				since: "2026-03-29T00:00:00.000Z",
				total_runs: 0,
				duty_runs: 0,
				impulse_runs: 0
			})),
			getAgentRuntimeSession: vi.fn(async () => null),
			openDueScheduledTasks,
			listTasks,
			createAgentRuntimeRun,
			appendToTerritory,
			createCapturedSkillArtifact
		};

		const result = await handleRuntimeTool("mind_runtime", {
			action: "trigger",
			wake_kind: "duty",
			now: "2026-03-29T18:01:00.000Z",
			preview_limit: 5,
			emit_skill_candidate: true
		}, { storage: storage as any });

		expect(result.triggered).toBe(true);
		expect(result.skill_candidate?.type).toBe("skill_candidate");
		expect(result.captured_skill?.status).toBe("candidate");
		expect(createCapturedSkillArtifact).toHaveBeenCalledWith(expect.objectContaining({
			source_runtime_run_id: "runtime_run_skill_1",
			source_task_id: "task_skill_1",
			status: "candidate",
			layer: "captured"
		}));
	});

	it("promotes candidate skill to accepted via review flow", async () => {
		const candidate: CapturedSkillArtifact = {
			id: "skill_candidate_1",
			tenant_id: "rainer",
			skill_key: "captured:rainer:autonomous-trigger",
			version: 1,
			layer: "captured",
			status: "candidate",
			name: "Autonomous trigger loop",
			provenance: {},
			metadata: {},
			created_at: "2026-03-29T18:00:00.000Z",
			updated_at: "2026-03-29T18:00:00.000Z"
		};
		const accepted: CapturedSkillArtifact = {
			...candidate,
			status: "accepted",
			reviewed_by: "rook",
			review_note: "Proven in production loop.",
			reviewed_at: "2026-03-29T18:30:00.000Z",
			updated_at: "2026-03-29T18:30:00.000Z"
		};

		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => candidate),
			reviewCapturedSkillArtifact: vi.fn(async () => accepted)
		};

		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_candidate_1",
			decision: "accepted",
			reviewed_by: "rook",
			review_note: "Proven in production loop."
		}, { storage: storage as any });

		expect(result.reviewed).toBe(true);
		expect(result.promoted).toBe(true);
		expect(result.previous_status).toBe("candidate");
		expect(storage.reviewCapturedSkillArtifact).toHaveBeenCalledWith(
			"skill_candidate_1",
			"accepted",
			"rook",
			"Proven in production loop."
		);
	});

	it("rejects invalid review transitions", async () => {
		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => ({
				id: "skill_candidate_2",
				tenant_id: "rainer",
				skill_key: "captured:rainer:invalid-transition",
				version: 1,
				layer: "captured",
				status: "candidate",
				name: "Invalid transition sample",
				provenance: {},
				metadata: {},
				created_at: "2026-03-29T18:00:00.000Z",
				updated_at: "2026-03-29T18:00:00.000Z"
			}))
		};

		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_candidate_2",
			decision: "degraded"
		}, { storage: storage as any });

		expect(result.error).toMatch(/invalid status transition/i);
	});

	it("lists skills filtered by status", async () => {
		const skills = [
			{ id: "skill_1", status: "candidate", name: "A" },
			{ id: "skill_2", status: "candidate", name: "B" }
		];
		const storage = {
			listCapturedSkillArtifacts: vi.fn(async () => skills)
		};

		const result = await handleSkillTool("mind_skill", {
			action: "list",
			status: "candidate",
			limit: 10
		}, { storage: storage as any });

		expect(result.count).toBe(2);
		expect(storage.listCapturedSkillArtifacts).toHaveBeenCalledWith(expect.objectContaining({
			status: "candidate",
			limit: 10
		}));
	});

	it("returns empty list when no skills match", async () => {
		const storage = {
			listCapturedSkillArtifacts: vi.fn(async () => [])
		};

		const result = await handleSkillTool("mind_skill", {
			action: "list",
			status: "accepted"
		}, { storage: storage as any });

		expect(result.count).toBe(0);
		expect(result.skills).toEqual([]);
	});

	it("rejects invalid status in list", async () => {
		const storage = {};
		const result = await handleSkillTool("mind_skill", {
			action: "list",
			status: "bogus"
		}, { storage: storage as any });

		expect(result.error).toMatch(/status must be one of/i);
	});

	it("rejects out-of-range limit in list", async () => {
		const storage = {};
		const result = await handleSkillTool("mind_skill", {
			action: "list",
			limit: 0
		}, { storage: storage as any });

		expect(result.error).toMatch(/limit must be between/i);
	});

	it("returns skill by id via get", async () => {
		const skill = { id: "skill_get_1", name: "Found" };
		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => skill)
		};

		const result = await handleSkillTool("mind_skill", {
			action: "get",
			id: "skill_get_1"
		}, { storage: storage as any });

		expect(result.skill.id).toBe("skill_get_1");
	});

	it("returns error for get with missing id", async () => {
		const storage = {};
		const result = await handleSkillTool("mind_skill", {
			action: "get"
		}, { storage: storage as any });

		expect(result.error).toMatch(/id is required/i);
	});

	it("returns error for get with nonexistent skill", async () => {
		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => null)
		};

		const result = await handleSkillTool("mind_skill", {
			action: "get",
			id: "skill_nope"
		}, { storage: storage as any });

		expect(result.error).toMatch(/not found/i);
	});

	it("blocks review of retired skills (terminal state)", async () => {
		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => ({
				id: "skill_retired_1", status: "retired", name: "Done"
			})),
			reviewCapturedSkillArtifact: vi.fn()
		};

		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_retired_1",
			decision: "accepted"
		}, { storage: storage as any });

		expect(result.error).toMatch(/retired/i);
		expect(storage.reviewCapturedSkillArtifact).not.toHaveBeenCalled();
	});

	it("blocks same-status review transition", async () => {
		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => ({
				id: "skill_same_1", status: "accepted", name: "Same"
			})),
			reviewCapturedSkillArtifact: vi.fn()
		};

		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_same_1",
			decision: "accepted"
		}, { storage: storage as any });

		expect(result.error).toMatch(/already in status/i);
		expect(storage.reviewCapturedSkillArtifact).not.toHaveBeenCalled();
	});

	it("blocks backwards transition accepted→candidate", async () => {
		const storage = {
			getCapturedSkillArtifact: vi.fn(async () => ({
				id: "skill_back_1", status: "accepted", name: "Back"
			}))
		};

		// "candidate" is not a valid review decision, so this gets caught at normalizeReviewDecision
		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_back_1",
			decision: "candidate"
		}, { storage: storage as any });

		expect(result.error).toMatch(/decision must be one of/i);
	});

	it("rejects review with missing decision", async () => {
		const storage = {};
		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_no_decision"
		}, { storage: storage as any });

		expect(result.error).toMatch(/decision must be one of/i);
	});

	it("rejects review with overly long review_note", async () => {
		const storage = {
			getCapturedSkillArtifact: vi.fn()
		};

		const result = await handleSkillTool("mind_skill", {
			action: "review",
			id: "skill_long_note",
			decision: "accepted",
			review_note: "x".repeat(2001)
		}, { storage: storage as any });

		expect(result.error).toMatch(/review_note too long/i);
	});

	it("surfaces captured skill registry diagnostics in health", async () => {
		const registry: CapturedSkillRegistryHealth = {
			total: 4,
			by_status: {
				candidate: 2,
				accepted: 1,
				degraded: 1,
				retired: 0
			},
			by_layer: {
				fixed: 0,
				captured: 4,
				derived: 0
			},
			with_runtime_provenance: 4,
			with_task_provenance: 4,
			with_observation_provenance: 3,
			pending_review: 2
		};
		const storage = {
			getTenant: () => "rainer",
			getCapturedSkillRegistryHealth: vi.fn(async () => registry),
			listCapturedSkillArtifacts: vi.fn(async () => ([
				{
					id: "skill_candidate_3",
					tenant_id: "rainer",
					skill_key: "captured:rainer:loop",
					version: 2,
					layer: "captured",
					status: "candidate",
					name: "Loop",
					agent_tenant: "rainer",
					source_runtime_run_id: "runtime_run_9",
					source_task_id: "task_9",
					provenance: {},
					metadata: {},
					created_at: "2026-03-29T18:45:00.000Z",
					updated_at: "2026-03-29T18:45:00.000Z"
				}
			]))
		};

		const result = await handleHealthTool("mind_health", {
			section: "skills"
		}, { storage: storage as any });

		expect(result.tenant).toBe("rainer");
		expect(result.skills.registry.pending_review).toBe(2);
		expect(result.skills.recent_candidates[0].id).toBe("skill_candidate_3");
	});
});
