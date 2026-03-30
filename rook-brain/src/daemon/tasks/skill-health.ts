// ============ DAEMON TASK: SKILL HEALTH ============ 
// Monitors captured skill registry for stale accepted skills and candidate drift.
// Emits reviewable proposals only (no automatic promotion/degradation):
// - skill_recapture    (accepted skill appears stale)
// - skill_supersession (newer candidate exists over accepted version)
// - skill_promotion    (candidate has no accepted lineage yet)

import type { CapturedSkillArtifact, DaemonProposal } from "../../types";
import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const MAX_SCAN_PER_STATUS = 200;
const STALE_ACCEPTED_DAYS = 30;
const PROMOTION_MIN_AGE_HOURS = 4;

interface SkillProposalAction {
	type: Extract<DaemonProposal["proposal_type"], "skill_recapture" | "skill_supersession" | "skill_promotion">;
	sourceId: string;
	targetId: string;
	confidence: number;
	rationale: string;
	metadata: Record<string, unknown>;
}

export async function runSkillHealthTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let proposals_created = 0;

	const [acceptedSkills, candidateSkills] = await Promise.all([
		storage.listCapturedSkillArtifacts({ status: "accepted", limit: MAX_SCAN_PER_STATUS }),
		storage.listCapturedSkillArtifacts({ status: "candidate", limit: MAX_SCAN_PER_STATUS })
	]);

	if (acceptedSkills.length === 0 && candidateSkills.length === 0) {
		return { task: "skill-health", changes: 0, proposals_created: 0 };
	}

	const latestAcceptedByKey = buildLatestVersionMap(acceptedSkills);
	const now = Date.now();
	const actions: SkillProposalAction[] = [];

	// A) stale accepted skills => recapture proposal
	for (const accepted of acceptedSkills) {
		const daysSinceUpdate = daysSince(accepted.updated_at, now);
		if (daysSinceUpdate < STALE_ACCEPTED_DAYS) continue;

		actions.push({
			type: "skill_recapture",
			sourceId: accepted.id,
			targetId: accepted.id,
			confidence: 0.78,
			rationale: `Accepted skill ${accepted.skill_key} looks stale (${Math.floor(daysSinceUpdate)} days since update).`,
			metadata: {
				skill_key: accepted.skill_key,
				accepted_version: accepted.version,
				days_since_update: Math.floor(daysSinceUpdate),
				recommended_action: "recapture"
			}
		});
	}

	// B) candidate drift/new lineage => supersession or promotion proposal
	for (const candidate of candidateSkills) {
		const accepted = latestAcceptedByKey.get(candidate.skill_key);

		if (accepted && candidate.version > accepted.version) {
			actions.push({
				type: "skill_supersession",
				sourceId: accepted.id,
				targetId: candidate.id,
				confidence: 0.8,
				rationale: `Candidate v${candidate.version} may supersede accepted v${accepted.version} for ${candidate.skill_key}.`,
				metadata: {
					skill_key: candidate.skill_key,
					accepted_id: accepted.id,
					accepted_version: accepted.version,
					candidate_id: candidate.id,
					candidate_version: candidate.version,
					recommended_action: "supersede_if_reviewed"
				}
			});
			continue;
		}

		// No accepted lineage yet — propose promotion after minimal soak window.
		if (!accepted && hoursSince(candidate.created_at, now) >= PROMOTION_MIN_AGE_HOURS) {
			actions.push({
				type: "skill_promotion",
				sourceId: candidate.id,
				targetId: candidate.id,
				confidence: 0.72,
				rationale: `Candidate ${candidate.skill_key} has no accepted lineage and is ready for promotion review.`,
				metadata: {
					skill_key: candidate.skill_key,
					candidate_version: candidate.version,
					hours_since_created: Math.floor(hoursSince(candidate.created_at, now)),
					recommended_action: "promote_if_reviewed"
				}
			});
		}
	}

	if (actions.length === 0) {
		return { task: "skill-health", changes: 0, proposals_created: 0 };
	}

	// Deduplicate within this run.
	const deduped = new Map<string, SkillProposalAction>();
	for (const action of actions) {
		deduped.set(`${action.type}:${action.sourceId}:${action.targetId}`, action);
	}
	const uniqueActions = [...deduped.values()];

	const checks = uniqueActions.map(action => ({
		type: action.type,
		sourceId: action.sourceId,
		targetId: action.targetId
	}));
	const existing = await storage.batchProposalExists(checks);

	for (const action of uniqueActions) {
		const key = `${action.type}:${action.sourceId}:${action.targetId}`;
		if (existing.has(key)) continue;

		await storage.createProposal({
			tenant_id: storage.getTenant(),
			proposal_type: action.type,
			source_id: action.sourceId,
			target_id: action.targetId,
			confidence: action.confidence,
			rationale: action.rationale,
			metadata: action.metadata,
			status: "pending"
		});
		proposals_created++;
	}

	return {
		task: "skill-health",
		changes: proposals_created,
		proposals_created
	};
}

function buildLatestVersionMap(skills: CapturedSkillArtifact[]): Map<string, CapturedSkillArtifact> {
	const map = new Map<string, CapturedSkillArtifact>();
	for (const skill of skills) {
		const existing = map.get(skill.skill_key);
		if (!existing || skill.version > existing.version) {
			map.set(skill.skill_key, skill);
		}
	}
	return map;
}

function daysSince(iso: string, nowMs: number): number {
	const stamp = new Date(iso).getTime();
	if (Number.isNaN(stamp)) return 0;
	return (nowMs - stamp) / (1000 * 60 * 60 * 24);
}

function hoursSince(iso: string, nowMs: number): number {
	const stamp = new Date(iso).getTime();
	if (Number.isNaN(stamp)) return 0;
	return (nowMs - stamp) / (1000 * 60 * 60);
}
