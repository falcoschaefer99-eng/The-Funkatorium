import { describe, expect, it, vi } from "vitest";
import { runSkillHealthTask } from "../src/daemon/tasks/skill-health";
import type { CapturedSkillArtifact } from "../src/types";

function makeSkill(overrides: Partial<CapturedSkillArtifact>): CapturedSkillArtifact {
	return {
		id: overrides.id ?? "skill_1",
		tenant_id: overrides.tenant_id ?? "rainer",
		skill_key: overrides.skill_key ?? "captured:rainer:example",
		version: overrides.version ?? 1,
		layer: overrides.layer ?? "captured",
		status: overrides.status ?? "candidate",
		name: overrides.name ?? "Example Skill",
		domain: overrides.domain,
		environment: overrides.environment,
		task_type: overrides.task_type,
		agent_tenant: overrides.agent_tenant ?? "rainer",
		source_runtime_run_id: overrides.source_runtime_run_id,
		source_task_id: overrides.source_task_id,
		source_observation_id: overrides.source_observation_id,
		provenance: overrides.provenance ?? {},
		metadata: overrides.metadata ?? {},
		review_note: overrides.review_note,
		reviewed_by: overrides.reviewed_by,
		reviewed_at: overrides.reviewed_at,
		created_at: overrides.created_at ?? new Date().toISOString(),
		updated_at: overrides.updated_at ?? new Date().toISOString()
	};
}

describe("daemon skill-health task", () => {
	it("creates recapture, supersession, and promotion proposals", async () => {
		const now = Date.now();
		const acceptedStale = makeSkill({
			id: "skill_acc_old",
			skill_key: "captured:rainer:autonomous-loop",
			status: "accepted",
			version: 1,
			updated_at: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString()
		});
		const candidateNewer = makeSkill({
			id: "skill_cand_newer",
			skill_key: "captured:rainer:autonomous-loop",
			status: "candidate",
			version: 2,
			created_at: new Date(now - 8 * 60 * 60 * 1000).toISOString()
		});
		const candidatePromotable = makeSkill({
			id: "skill_cand_promote",
			skill_key: "captured:rainer:new-lineage",
			status: "candidate",
			version: 1,
			created_at: new Date(now - 10 * 60 * 60 * 1000).toISOString()
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [acceptedStale];
				if (filter?.status === "candidate") return [candidateNewer, candidatePromotable];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>()),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		expect(result.task).toBe("skill-health");
		expect(result.proposals_created).toBe(3);
		expect(createProposal).toHaveBeenCalledTimes(3);
		expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposal_type: "skill_recapture",
			source_id: "skill_acc_old",
			target_id: "skill_acc_old"
		}));
		expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposal_type: "skill_supersession",
			source_id: "skill_acc_old",
			target_id: "skill_cand_newer"
		}));
		expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposal_type: "skill_promotion",
			source_id: "skill_cand_promote",
			target_id: "skill_cand_promote"
		}));
	});

	it("skips proposals that already exist and avoids too-fresh promotions", async () => {
		const now = Date.now();
		const acceptedStale = makeSkill({
			id: "skill_acc_existing",
			skill_key: "captured:rainer:existing",
			status: "accepted",
			version: 1,
			updated_at: new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString()
		});
		const candidateFresh = makeSkill({
			id: "skill_cand_fresh",
			skill_key: "captured:rainer:fresh",
			status: "candidate",
			version: 1,
			created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString()
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [acceptedStale];
				if (filter?.status === "candidate") return [candidateFresh];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>([
				"skill_recapture:skill_acc_existing:skill_acc_existing"
			])),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		expect(result.proposals_created).toBe(0);
		expect(createProposal).not.toHaveBeenCalled();
	});

	it("returns zero proposals when skill registry is empty", async () => {
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async () => []),
			batchProposalExists: vi.fn(),
			createProposal: vi.fn()
		};

		const result = await runSkillHealthTask(storage as any);

		expect(result.proposals_created).toBe(0);
		expect(result.changes).toBe(0);
		expect(storage.batchProposalExists).not.toHaveBeenCalled();
		expect(storage.createProposal).not.toHaveBeenCalled();
	});

	it("does not propose recapture for accepted skill updated within 30 days", async () => {
		const now = Date.now();
		const freshAccepted = makeSkill({
			id: "skill_acc_fresh",
			skill_key: "captured:rainer:recent",
			status: "accepted",
			version: 1,
			updated_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [freshAccepted];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>()),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		expect(result.proposals_created).toBe(0);
		expect(createProposal).not.toHaveBeenCalled();
	});

	it("does not propose supersession when candidate version is not higher than accepted", async () => {
		const now = Date.now();
		const accepted = makeSkill({
			id: "skill_acc_v2",
			skill_key: "captured:rainer:same-version",
			status: "accepted",
			version: 2,
			updated_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
		});
		const candidateSameVersion = makeSkill({
			id: "skill_cand_v1",
			skill_key: "captured:rainer:same-version",
			status: "candidate",
			version: 1,
			created_at: new Date(now - 8 * 60 * 60 * 1000).toISOString()
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [accepted];
				if (filter?.status === "candidate") return [candidateSameVersion];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>()),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		expect(result.proposals_created).toBe(0);
		expect(createProposal).not.toHaveBeenCalled();
	});

	it("does not propose promotion for candidate that has accepted lineage", async () => {
		const now = Date.now();
		const accepted = makeSkill({
			id: "skill_acc_lineage",
			skill_key: "captured:rainer:has-lineage",
			status: "accepted",
			version: 1,
			updated_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
		});
		const candidateWithLineage = makeSkill({
			id: "skill_cand_lineage",
			skill_key: "captured:rainer:has-lineage",
			status: "candidate",
			version: 1,
			created_at: new Date(now - 10 * 60 * 60 * 1000).toISOString()
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [accepted];
				if (filter?.status === "candidate") return [candidateWithLineage];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>()),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		// Candidate v1 with accepted v1 = same version, not supersession. Has lineage, not promotion.
		expect(result.proposals_created).toBe(0);
		expect(createProposal).not.toHaveBeenCalled();
	});

	it("picks highest version when multiple accepted skills share a key", async () => {
		const now = Date.now();
		const acceptedV1 = makeSkill({
			id: "skill_acc_v1",
			skill_key: "captured:rainer:multi-version",
			status: "accepted",
			version: 1,
			updated_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
		});
		const acceptedV2 = makeSkill({
			id: "skill_acc_v2_latest",
			skill_key: "captured:rainer:multi-version",
			status: "accepted",
			version: 2,
			updated_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
		});
		const candidateV3 = makeSkill({
			id: "skill_cand_v3",
			skill_key: "captured:rainer:multi-version",
			status: "candidate",
			version: 3,
			created_at: new Date(now - 8 * 60 * 60 * 1000).toISOString()
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [acceptedV1, acceptedV2];
				if (filter?.status === "candidate") return [candidateV3];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>()),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		// Supersession should target v2 (latest accepted), not v1
		expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposal_type: "skill_supersession",
			source_id: "skill_acc_v2_latest",
			target_id: "skill_cand_v3"
		}));
	});

	it("handles invalid dates in accepted skills without crashing", async () => {
		const badDateAccepted = makeSkill({
			id: "skill_bad_date",
			skill_key: "captured:rainer:bad-date",
			status: "accepted",
			version: 1,
			updated_at: "not-a-date"
		});

		const createProposal = vi.fn(async () => {});
		const storage = {
			getTenant: () => "rainer",
			listCapturedSkillArtifacts: vi.fn(async (filter: any) => {
				if (filter?.status === "accepted") return [badDateAccepted];
				return [];
			}),
			batchProposalExists: vi.fn(async () => new Set<string>()),
			createProposal
		};

		const result = await runSkillHealthTask(storage as any);

		// daysSince returns 0 for invalid dates, so no recapture proposal
		expect(result.proposals_created).toBe(0);
		expect(createProposal).not.toHaveBeenCalled();
	});
});
