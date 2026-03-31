// ============ PROPOSE TOOL (v2) ============
// mind_propose — review and manage daemon-generated proposals.
// action=list: list pending proposals (filterable by type, including skill lifecycle proposals)
// action=review: accept or reject. Accept + link → create bidirectional link.
//   Accept + orphan_rescue + archive → metabolize + update orphan status.
//   Accept + orphan_rescue (rescue) → create link + update orphan status.
//   Accept + consolidation → create skill observation, metabolize sources, accept candidate.
// action=stats: return proposal statistics

import { generateId, getTimestamp, toStringArray } from "../helpers";
import { RESONANCE_TYPES } from "../constants";
import type { Link, Observation } from "../types";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_propose",
		description: "Review and manage daemon-generated proposals. action=list: see pending proposals (types: link, orphan_rescue, consolidation, dedup, cross_agent, cross_tenant, paradox_detected, skill_recapture, skill_supersession, skill_promotion, recall_contract, fact_commitment). action=review: accept or reject a proposal (link → bidirectional link; orphan_rescue → rescue or archive; consolidation → skill observation + metabolize sources). action=stats: acceptance statistics.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "review", "stats"],
					description: "list: view proposals. review: accept/reject. stats: acceptance statistics."
				},
				// list params
				type: {
					type: "string",
					enum: ["link", "orphan_rescue", "consolidation", "dedup", "cross_agent", "cross_tenant", "paradox_detected", "skill_recapture", "skill_supersession", "skill_promotion", "recall_contract", "fact_commitment"],
					description: "[list] Filter by proposal type"
				},
				status: {
					type: "string",
					enum: ["pending", "accepted", "rejected"],
					description: "[list] Filter by status. Defaults to 'pending'."
				},
				limit: {
					type: "number",
					default: 20,
					description: "[list] Max proposals to return"
				},
				// review params
				proposal_id: {
					type: "string",
					description: "[review] ID of the proposal to review"
				},
				decision: {
					type: "string",
					enum: ["accepted", "rejected"],
					description: "[review] Accept or reject the proposal"
				},
				feedback_note: {
					type: "string",
					description: "[review] Optional note on the decision"
				},
				resonance_type: {
					type: "string",
					description: "[review] Override resonance_type for accepted link proposals"
				}
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;

	switch (name) {
		case "mind_propose": {
			const action = args.action;

			// --- list ---
			if (action === "list") {
				const status = args.status ?? "pending";
				const type = args.type ?? undefined;
				const limit = Math.min(args.limit ?? 20, 100);

				const proposals = await storage.listProposals(type, status, limit);
				return {
					total: proposals.length,
					proposals: proposals.map(p => ({
						id: p.id,
						type: p.proposal_type,
						source_id: p.source_id,
						target_id: p.target_id,
						confidence: Math.round(p.confidence * 100) / 100,
						similarity: p.similarity !== undefined ? Math.round(p.similarity * 100) / 100 : undefined,
						rationale: p.rationale,
						metadata: p.metadata,
						status: p.status,
						proposed_at: p.proposed_at
					}))
				};
			}

			// --- review ---
			if (action === "review") {
				if (!args.proposal_id) {
					return { error: "proposal_id is required for action=review" };
				}
				if (!args.decision || !["accepted", "rejected"].includes(args.decision)) {
					return { error: "decision must be 'accepted' or 'rejected'" };
				}

				// Fix 5: cap feedback_note to 1000 characters
				if (args.feedback_note && args.feedback_note.length > 1000) {
					return { error: "feedback_note must be 1000 characters or fewer" };
				}

				// Fix 8: direct PK lookup instead of loading 200 rows to find one
				const proposal = await storage.getProposalById(args.proposal_id);
				if (!proposal || proposal.status !== "pending") {
					return { error: `Proposal ${args.proposal_id} not found or not in pending state` };
				}

				// Validate IDs contain only safe characters
				if (!/^[a-zA-Z0-9_-]+$/.test(proposal.source_id) || !/^[a-zA-Z0-9_-]+$/.test(proposal.target_id)) {
					return { error: "Invalid observation IDs in proposal" };
				}

				const reviewed = await storage.reviewProposal(
					args.proposal_id,
					args.decision,
					args.feedback_note
				);

				if (args.decision === "accepted") {
					// --- link proposal: create bidirectional link ---
					if (proposal.proposal_type === "link") {
						const resonanceType = args.resonance_type ?? proposal.resonance_type ?? "semantic";

						// Fix 4: validate resonance_type against the allowlist
						if (!RESONANCE_TYPES.includes(resonanceType)) {
							return { error: `Invalid resonance_type '${resonanceType}'. Must be one of: ${RESONANCE_TYPES.join(", ")}` };
						}
						const now = getTimestamp();

						const fwdLink: Link = {
							id: generateId("link"),
							source_id: proposal.source_id,
							target_id: proposal.target_id,
							resonance_type: resonanceType,
							strength: "present",
							origin: "daemon",
							created: now,
							last_activated: now
						};
						const revLink: Link = {
							id: generateId("link"),
							source_id: proposal.target_id,
							target_id: proposal.source_id,
							resonance_type: resonanceType,
							strength: "present",
							origin: "daemon",
							created: now,
							last_activated: now
						};

						await Promise.all([
							storage.appendLink(fwdLink),
							storage.appendLink(revLink)
						]);

						return {
							reviewed: true,
							decision: "accepted",
							proposal_id: reviewed.id,
							action_taken: "created_bidirectional_link",
							link_ids: [fwdLink.id, revLink.id]
						};
					}

					// --- orphan_rescue proposal ---
					if (proposal.proposal_type === "orphan_rescue") {
						const meta = proposal.metadata as Record<string, unknown>;

						if (meta.action === "archive") {
							// Metabolize the observation + update orphan status
							const found = await storage.findObservation(proposal.source_id);
							if (found) {
								const texture = { ...found.observation.texture, charge_phase: "metabolized" as const };
								await storage.updateObservationTexture(proposal.source_id, texture);
							}
							await storage.updateOrphanStatus(proposal.source_id, "archived");

							return {
								reviewed: true,
								decision: "accepted",
								proposal_id: reviewed.id,
								action_taken: "metabolized_and_archived_orphan",
								observation_id: proposal.source_id
							};
						} else {
							// Rescue: create link between orphan and its rescuer + update orphan status
							const now = getTimestamp();
							const fwdLink: Link = {
								id: generateId("link"),
								source_id: proposal.source_id,
								target_id: proposal.target_id,
								resonance_type: "semantic",
								strength: "present",
								origin: "daemon",
								created: now,
								last_activated: now
							};
							const revLink: Link = {
								id: generateId("link"),
								source_id: proposal.target_id,
								target_id: proposal.source_id,
								resonance_type: "semantic",
								strength: "present",
								origin: "daemon",
								created: now,
								last_activated: now
							};

							await Promise.all([
								storage.appendLink(fwdLink),
								storage.appendLink(revLink),
								storage.updateOrphanStatus(proposal.source_id, "rescued")
							]);

							return {
								reviewed: true,
								decision: "accepted",
								proposal_id: reviewed.id,
								action_taken: "rescued_orphan",
								observation_id: proposal.source_id,
								linked_to: proposal.target_id,
								link_ids: [fwdLink.id, revLink.id]
							};
						}
					}

					// --- consolidation proposal: create skill obs, metabolize sources ---
					if (proposal.proposal_type === "consolidation") {
						const meta = proposal.metadata as Record<string, unknown>;
						const agentId = meta.agent_id as string | undefined;

						// Find pending consolidation candidates linked to this agent
						const candidates = await storage.listConsolidationCandidates("pending", 10);
						const agentCandidates = agentId
							? candidates.filter(c => {
								// Candidates created by kit-hygiene store agent obs IDs.
								// Cross-agent candidates store obs from multiple agents.
								// We match on any candidate whose pattern_description mentions the agent.
								return c.pattern_description.includes(agentId) || c.pattern_description.includes(meta.agent_name as string ?? "");
							})
							: candidates;

						const candidate = agentCandidates[0]; // Take the first matching candidate
						let sourceObsIds: string[] = [];
						let candidateId: string | undefined;

						if (candidate) {
							sourceObsIds = candidate.source_observation_ids;
							candidateId = candidate.id;
							await storage.reviewConsolidationCandidate(candidate.id, "accepted");
						}

						// Mark source observations as metabolized
						const metabolized: string[] = [];
						for (const obsId of sourceObsIds) {
							const found = await storage.findObservation(obsId);
							if (found) {
								const texture = { ...found.observation.texture, charge_phase: "metabolized" as const };
								await storage.updateObservationTexture(obsId, texture);
								metabolized.push(obsId);
							}
						}

						// Create skill observation for the agent
						const now = getTimestamp();
						const agentName = (meta.agent_name as string) ?? "unknown agent";
						const skillObs: Observation = {
							id: generateId("obs"),
							content: `Skill distilled from ${metabolized.length} observations by ${agentName}. Pattern: ${candidate?.pattern_description ?? proposal.rationale ?? "consolidation"}`,
							territory: "craft",
							created: now,
							texture: {
								salience: "active",
								vividness: "vivid",
								charge: [],
								grip: "present",
								charge_phase: "fresh"
							},
							access_count: 0,
							type: "skill",
							...(agentId ? { entity_id: agentId } : {})
						};

						await storage.appendToTerritory("craft", skillObs);

						// Update the agent entity's primary_context if we have an agent ID
						if (agentId) {
							await storage.updateEntity(agentId, {
								primary_context: `Last skill distilled: ${now.slice(0, 10)} (${metabolized.length} observations consolidated)`
							});
						}

						return {
							reviewed: true,
							decision: "accepted",
							proposal_id: reviewed.id,
							action_taken: "created_skill_observation",
							skill_observation_id: skillObs.id,
							metabolized_count: metabolized.length,
							metabolized_ids: metabolized,
							candidate_id: candidateId
						};
					}

					// --- recall/fact commitment proposals: review-gated task materialization ---
					if (proposal.proposal_type === "recall_contract" || proposal.proposal_type === "fact_commitment") {
						const metadata = (proposal.metadata ?? {}) as Record<string, unknown>;
						const title = typeof metadata.title === "string" ? metadata.title.trim() : "Review follow-up";
						const description = typeof metadata.description === "string"
							? metadata.description
							: (typeof proposal.rationale === "string" ? proposal.rationale : undefined);
						const priority = normalizeTaskPriority(metadata.priority);
						const source = typeof metadata.source === "string"
							? metadata.source
							: (proposal.proposal_type === "recall_contract" ? "recall_contract" : "fact_commitment_bridge");
						const linkedEntityIds = toStringArray(metadata.linked_entity_ids);
						const linkedObservationIds = toStringArray(metadata.linked_observation_ids);

						const task = await storage.createTask({
							title: title.length > 0 ? title.slice(0, 200) : "Review follow-up",
							description,
							status: "open",
							priority: priority ?? (proposal.proposal_type === "fact_commitment" ? "high" : "normal"),
							source,
							linked_entity_ids: linkedEntityIds,
							linked_observation_ids: linkedObservationIds
						});

						return {
							reviewed: true,
							decision: "accepted",
							proposal_id: reviewed.id,
							action_taken: "created_task",
							proposal_type: proposal.proposal_type,
							task_id: task.id,
							task
						};
					}

				// Rejection or unknown type — just return the reviewed status
				return {
					reviewed: true,
					decision: args.decision,
					proposal_id: reviewed.id,
					action_taken: args.decision === "rejected" ? "rejected" : "none"
				};
			}

			// --- stats ---
			if (action === "stats") {
				const [stats, config] = await Promise.all([
					storage.getProposalStats(),
					storage.readDaemonConfig()
				]);

				return {
					current_threshold: config.link_proposal_threshold,
					last_threshold_update: config.last_threshold_update,
					stats_by_type: stats
				};
			}

			return { error: `Unknown action: ${action}. Must be list, review, or stats.` };
		}

		default:
			throw new Error(`Unknown propose tool: ${name}`);
	}
}


function normalizeTaskPriority(value: unknown): "burning" | "high" | "normal" | "low" | "someday" | undefined {
	if (typeof value !== "string") return undefined;
	return ["burning", "high", "normal", "low", "someday"].includes(value)
		? value as "burning" | "high" | "normal" | "low" | "someday"
		: undefined;
}
