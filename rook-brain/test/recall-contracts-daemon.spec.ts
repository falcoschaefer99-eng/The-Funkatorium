import { describe, expect, it, vi } from "vitest";
import { runRecallContractsTask } from "../src/daemon/tasks/recall-contracts";

describe("daemon recall-contracts task", () => {
	it("creates open task for due task-scope context recall contract", async () => {
		const createTask = vi.fn(async (task: any) => ({
			id: "task_recall_1",
			tenant_id: "rainer",
			...task,
			created_at: "2026-03-31T00:00:00.000Z",
			updated_at: "2026-03-31T00:00:00.000Z"
		}));
		const storage = {
			readConversationContext: vi.fn(async () => ({
				timestamp: "2026-03-29T00:00:00.000Z",
				recall_contracts: [
					{
						id: "daily_release_check",
						title: "Re-check release readiness",
						recall_after_hours: 24,
						scope: "task",
						priority: "high"
					}
				]
			})),
			listProjectDossiers: vi.fn(async () => []),
			listTasks: vi.fn(async () => []),
			createTask,
			proposalExists: vi.fn(async () => false),
			createProposal: vi.fn(async () => undefined),
			getTenant: () => "rainer"
		};

		const result = await runRecallContractsTask(storage as any);

		expect(result.task).toBe("recall-contracts");
		expect(result.changes).toBe(1);
		expect(result.proposals_created).toBe(0);
		expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
			title: "Re-check release readiness",
			priority: "high",
			source: "recall_contract:daily_release_check"
		}));
	});

	it("creates review proposal for due proposal-scope project recall contract", async () => {
		const createProposal = vi.fn(async (proposal: any) => ({
			id: "proposal_recall_project_1",
			...proposal
		}));
		const storage = {
			readConversationContext: vi.fn(async () => null),
			listProjectDossiers: vi.fn(async () => ([
				{
					id: "proj_dossier_1",
					tenant_id: "rainer",
					project_entity_id: "entity_project_1",
					lifecycle_status: "active",
					summary: "test",
					goals: [],
					constraints: [],
					decisions: [],
					open_questions: [],
					next_actions: ["ship"],
					metadata: {
						recall_contract: {
							id: "project_sync",
							title: "Project sync review",
							recall_after_hours: 24,
							scope: "proposal",
							priority: "normal"
						}
					},
					last_active_at: "2026-03-28T00:00:00.000Z",
					created_at: "2026-03-27T00:00:00.000Z",
					updated_at: "2026-03-28T00:00:00.000Z"
				}
			])),
			listTasks: vi.fn(async () => []),
			createTask: vi.fn(async () => undefined),
			proposalExists: vi.fn(async () => false),
			createProposal,
			getTenant: () => "rainer"
		};

		const result = await runRecallContractsTask(storage as any);

		expect(result.proposals_created).toBe(1);
		expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposal_type: "recall_contract",
			status: "pending"
		}));
	});

	it("skips duplicate proposal contracts when a pending one already exists", async () => {
		const createProposal = vi.fn(async () => undefined);
		const storage = {
			readConversationContext: vi.fn(async () => null),
			listProjectDossiers: vi.fn(async () => ([
				{
					id: "proj_dossier_2",
					tenant_id: "rainer",
					project_entity_id: "entity_project_2",
					lifecycle_status: "active",
					summary: "test",
					goals: [],
					constraints: [],
					decisions: [],
					open_questions: [],
					next_actions: ["ship"],
					metadata: {
						recall_contract: {
							id: "project_sync_dup",
							title: "Project sync review",
							recall_after_hours: 24,
							scope: "proposal",
							priority: "normal"
						}
					},
					last_active_at: "2026-03-28T00:00:00.000Z",
					created_at: "2026-03-27T00:00:00.000Z",
					updated_at: "2026-03-28T00:00:00.000Z"
				}
			])),
			listTasks: vi.fn(async () => []),
			createTask: vi.fn(async () => undefined),
			proposalExists: vi.fn(async () => true),
			createProposal,
			getTenant: () => "rainer"
		};

		const result = await runRecallContractsTask(storage as any);

		expect(result.proposals_created).toBe(0);
		expect(createProposal).not.toHaveBeenCalled();
	});
});
