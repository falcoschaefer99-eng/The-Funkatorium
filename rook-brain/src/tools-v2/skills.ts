// ============ SKILL REGISTRY TOOL (v2) ============
// mind_skill — list/get/review captured skill artifacts.

import type { CapturedSkillArtifact } from "../types";
import type { ToolContext } from "./context";
import { cleanText } from "./utils";

const SKILL_STATUSES = ["candidate", "accepted", "degraded", "retired"] as const;
const SKILL_LAYERS = ["fixed", "captured", "derived"] as const;
const REVIEW_DECISIONS = ["accepted", "degraded", "retired"] as const;

const MAX_REVIEW_NOTE_LENGTH = 2000;
const MAX_REVIEWED_BY_LENGTH = 120;

export const TOOL_DEFS = [
	{
		name: "mind_skill",
		description: "Manage captured skill artifacts. action=list lists skills by status/layer filters. action=get fetches one skill artifact. action=review applies reviewed status transitions (candidate->accepted/retired, accepted->degraded/retired, degraded->accepted/retired).",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "get", "review"],
					description: "list: query captured skills. get: fetch one by id. review: apply lifecycle review decision."
				},
				id: { type: "string", description: "[get/review] Captured skill artifact id." },
				status: {
					type: "string",
					enum: [...SKILL_STATUSES],
					description: "[list] Filter by current lifecycle status."
				},
				layer: {
					type: "string",
					enum: [...SKILL_LAYERS],
					description: "[list] Filter by skill layer."
				},
				agent_tenant: { type: "string", description: "[list] Filter by source agent tenant." },
				task_type: { type: "string", description: "[list] Filter by task_type provenance tag." },
				limit: { type: "number", description: "[list] Max rows (default 20, max 100)." },
				decision: {
					type: "string",
					enum: [...REVIEW_DECISIONS],
					description: "[review] reviewed lifecycle decision."
				},
				review_note: { type: "string", description: "[review] Optional review rationale." },
				reviewed_by: { type: "string", description: "[review] Optional reviewer label." }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_skill": {
			const action = args.action;
			const storage = context.storage;

			switch (action) {
				case "list": {
					const status = normalizeSkillStatus(args.status);
					if (args.status !== undefined && !status) {
						return { error: `status must be one of: ${SKILL_STATUSES.join(", ")}` };
					}
					const layer = normalizeSkillLayer(args.layer);
					if (args.layer !== undefined && !layer) {
						return { error: `layer must be one of: ${SKILL_LAYERS.join(", ")}` };
					}
					const limit = normalizeLimit(args.limit);
					if ("error" in limit) return limit;
					const agentTenant = cleanText(args.agent_tenant);
					if (agentTenant && agentTenant.length > 120) return { error: "agent_tenant too long (max 120 chars)" };
					const taskType = cleanText(args.task_type);
					if (taskType && taskType.length > 120) return { error: "task_type too long (max 120 chars)" };

					const skills = await storage.listCapturedSkillArtifacts({
						status,
						layer,
						agent_tenant: agentTenant,
						task_type: taskType,
						limit: limit.value
					});

					return { count: skills.length, skills };
				}

				case "get": {
					const id = cleanText(args.id);
					if (!id) return { error: "id is required for action=get" };
					const skill = await storage.getCapturedSkillArtifact(id);
					if (!skill) return { error: `Captured skill not found: ${id}` };
					return { skill };
				}

				case "review": {
					const id = cleanText(args.id);
					if (!id) return { error: "id is required for action=review" };
					const decision = normalizeReviewDecision(args.decision);
					if (!decision) {
						return { error: `decision must be one of: ${REVIEW_DECISIONS.join(", ")}` };
					}
					const reviewNote = cleanText(args.review_note);
					if (reviewNote && reviewNote.length > MAX_REVIEW_NOTE_LENGTH) {
						return { error: `review_note too long (max ${MAX_REVIEW_NOTE_LENGTH} chars)` };
					}
					const reviewedBy = cleanText(args.reviewed_by);
					if (reviewedBy && reviewedBy.length > MAX_REVIEWED_BY_LENGTH) {
						return { error: `reviewed_by too long (max ${MAX_REVIEWED_BY_LENGTH} chars)` };
					}

					const current = await storage.getCapturedSkillArtifact(id);
					if (!current) return { error: `Captured skill not found: ${id}` };
					const transitionValidation = validateTransition(current.status, decision);
					if (transitionValidation) return { error: transitionValidation };

					const reviewed = await storage.reviewCapturedSkillArtifact(id, decision, reviewedBy, reviewNote);
					return {
						reviewed: true,
						previous_status: current.status,
						promoted: current.status === "candidate" && decision === "accepted",
						skill: reviewed
					};
				}

				default:
					return { error: `Unknown action: ${action}. Must be list, get, or review.` };
			}
		}

		default:
			throw new Error(`Unknown skill tool: ${name}`);
	}
}

function normalizeSkillStatus(value: unknown): CapturedSkillArtifact["status"] | undefined {
	if (typeof value !== "string") return undefined;
	return SKILL_STATUSES.includes(value as CapturedSkillArtifact["status"])
		? value as CapturedSkillArtifact["status"]
		: undefined;
}

function normalizeSkillLayer(value: unknown): CapturedSkillArtifact["layer"] | undefined {
	if (typeof value !== "string") return undefined;
	return SKILL_LAYERS.includes(value as CapturedSkillArtifact["layer"])
		? value as CapturedSkillArtifact["layer"]
		: undefined;
}

function normalizeReviewDecision(value: unknown): typeof REVIEW_DECISIONS[number] | undefined {
	if (typeof value !== "string") return undefined;
	return REVIEW_DECISIONS.includes(value as typeof REVIEW_DECISIONS[number])
		? value as typeof REVIEW_DECISIONS[number]
		: undefined;
}

function normalizeLimit(value: unknown): { value: number } | { error: string } {
	if (value === undefined) return { value: 20 };
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
		return { error: "limit must be an integer" };
	}
	if (value < 1 || value > 100) return { error: "limit must be between 1 and 100" };
	return { value };
}

function validateTransition(from: CapturedSkillArtifact["status"], to: CapturedSkillArtifact["status"]): string | undefined {
	if (from === to) return `skill already in status=${to}`;
	if (from === "retired") return "retired skills cannot be reviewed to a new status";

	if (from === "candidate" && (to === "accepted" || to === "retired")) return undefined;
	if (from === "accepted" && (to === "degraded" || to === "retired")) return undefined;
	if (from === "degraded" && (to === "accepted" || to === "retired")) return undefined;

	return `invalid status transition: ${from} -> ${to}`;
}
