// ============ COMMS TOOLS (v2) ============
// mind_letter (action: write/read), mind_context (action: set/get)

import type { Letter, Observation } from "../types";
import { ALLOWED_TENANTS } from "../constants";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import type { ToolContext } from "./context";
import { cleanText } from "./utils";

const MAX_LETTER_CONTENT_LENGTH = 4000;
const MAX_CONTEXT_OPEN_THREAD_TASKS = 20;
const MAX_FACT_CANDIDATES = 10;
const MAX_SUMMARY_LENGTH = 10_000;
const MAX_ARRAY_ITEM_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_FACT_CONTENT_LENGTH = 2_000;
const MAX_RECALL_CONTRACTS = 25;
const MIN_RECALL_AFTER_HOURS = 1;
const MAX_RECALL_AFTER_HOURS = 24 * 30;

const TASK_PRIORITIES = ["burning", "high", "normal", "low", "someday"] as const;
const RECALL_SCOPES = ["task", "proposal"] as const;

const RE_DECISION = /(decided|decision|we will|we're going to|chosen)/i;
const RE_DEADLINE = /(deadline|due|by\s+\d{4}-\d{2}-\d{2}|tomorrow|next week|next sprint)/i;
const RE_GOAL = /(goal|target|objective|aim)/i;
const RE_PREFERENCE = /(prefer|preference|likes|dislikes)/i;
const RE_ASSIGNMENT = /(assigned|owner|responsible|take care of|will handle)/i;

type ExtractedFactType = "decision" | "deadline" | "goal" | "preference" | "assignment";

interface ExtractedFact {
	fact: string;
	fact_type: ExtractedFactType;
	confidence: number;
	source: "summary" | "key_point" | "open_thread";
}

type TaskPriority = typeof TASK_PRIORITIES[number];
type RecallScope = typeof RECALL_SCOPES[number];

interface RecallContract {
	id: string;
	title: string;
	note?: string;
	recall_after_hours: number;
	scope: RecallScope;
	priority: TaskPriority;
	linked_entity_ids: string[];
	metadata: Record<string, unknown>;
}

function splitSentences(text: string): string[] {
	return text
		.split(/[\n.!?]+/)
		.map(s => s.trim())
		.filter(Boolean);
}

function classifyProductivityFact(line: string): { type: ExtractedFactType; confidence: number } | null {
	const text = line.trim();
	if (!text) return null;
	if (RE_DECISION.test(text)) return { type: "decision", confidence: 0.86 };
	if (RE_DEADLINE.test(text)) return { type: "deadline", confidence: 0.82 };
	if (RE_GOAL.test(text)) return { type: "goal", confidence: 0.78 };
	if (RE_PREFERENCE.test(text)) return { type: "preference", confidence: 0.76 };
	if (RE_ASSIGNMENT.test(text)) return { type: "assignment", confidence: 0.8 };
	return null;
}

function extractProductivityFacts(
	summary: string,
	keyPoints: string[],
	openThreads: string[],
	maxFacts: number
): ExtractedFact[] {
	const collected: ExtractedFact[] = [];
	const dedupe = new Set<string>();

	const addLine = (line: string, source: ExtractedFact["source"]) => {
		if (collected.length >= maxFacts) return;
		const clean = line.trim();
		if (!clean) return;
		const classification = classifyProductivityFact(clean);
		if (!classification) return;
		const key = `${classification.type}:${clean.toLowerCase()}`;
		if (dedupe.has(key)) return;
		dedupe.add(key);
		collected.push({
			fact: clean,
			fact_type: classification.type,
			confidence: classification.confidence,
			source
		});
	};

	for (const sentence of splitSentences(summary)) addLine(sentence, "summary");
	for (const kp of keyPoints) addLine(kp, "key_point");
	for (const thread of openThreads) addLine(thread, "open_thread");

	return collected.slice(0, maxFacts);
}


function toSafeToken(input: string, fallback: string): string {
	const sanitized = input
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 64);
	return sanitized || fallback;
}

function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
	if (typeof value !== "string") return undefined;
	return TASK_PRIORITIES.includes(value as TaskPriority)
		? value as TaskPriority
		: undefined;
}

function normalizeRecallScope(value: unknown): RecallScope | undefined {
	if (typeof value !== "string") return undefined;
	return RECALL_SCOPES.includes(value as RecallScope)
		? value as RecallScope
		: undefined;
}

function parseRecallContracts(value: unknown): { contracts: RecallContract[]; error?: string } {
	if (value === undefined) return { contracts: [] };
	if (!Array.isArray(value)) return { contracts: [], error: "recall_contracts must be an array" };
	if (value.length > MAX_RECALL_CONTRACTS) {
		return { contracts: [], error: `recall_contracts too many items (max ${MAX_RECALL_CONTRACTS})` };
	}

	const contracts: RecallContract[] = [];
	for (let i = 0; i < value.length; i++) {
		const raw = value[i];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return { contracts: [], error: `recall_contracts[${i}] must be an object` };
		}
		const obj = raw as Record<string, unknown>;
		const title = cleanText(obj.title);
		if (!title) return { contracts: [], error: `recall_contracts[${i}].title is required` };
		const recallAfter = parseOptionalPositiveInt(obj.recall_after_hours, MIN_RECALL_AFTER_HOURS, MAX_RECALL_AFTER_HOURS);
		if (recallAfter === undefined) {
			return { contracts: [], error: `recall_contracts[${i}].recall_after_hours must be an integer between ${MIN_RECALL_AFTER_HOURS} and ${MAX_RECALL_AFTER_HOURS}` };
		}
		const scope = normalizeRecallScope(obj.scope) ?? "task";
		const priority = normalizeTaskPriority(obj.priority) ?? "normal";
		const metadata = (obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata))
			? obj.metadata as Record<string, unknown>
			: {};
		const rawId = cleanText(obj.id) ?? `${title}-${i + 1}`;
		contracts.push({
			id: toSafeToken(rawId, `recall_${i + 1}`),
			title,
			note: cleanText(obj.note),
			recall_after_hours: recallAfter,
			scope,
			priority,
			linked_entity_ids: toStringArray(obj.linked_entity_ids),
			metadata
		});
	}

	return { contracts };
}

function truncateText(input: string, max = 120): string {
	const clean = input.trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1)}…`;
}

function isCommitEligibleFact(fact: ExtractedFact, threshold: number): boolean {
	if (fact.confidence < threshold) return false;
	return fact.fact_type === "decision" || fact.fact_type === "deadline";
}

function parseOptionalPositiveInt(value: unknown, min: number, max: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (!Number.isInteger(value)) return undefined;
	if (value < min || value > max) return undefined;
	return value;
}

export const TOOL_DEFS = [
	{
		name: "mind_letter",
		description: "Write or read letters. action=write sends a letter to a context or another brain. action=read returns unread letters for a context.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["write", "read"],
					description: "write: send a letter. read: read incoming letters."
				},
				// write params
				to_context: { type: "string", description: "[write] Recipient context (e.g., 'phone', 'future', 'desktop', 'chat')" },
				to: { type: "string", description: "[write] Recipient brain/tenant for cross-brain letters (e.g., 'rainer', 'rook')" },
				content: { type: "string", description: "[write] Letter content" },
				charges: { type: "array", items: { type: "string" }, description: "[write] Emotional charges" },
				letter_type: { type: "string", enum: ["personal", "handoff", "proposal"], description: "[write] Letter type — personal (default), handoff (task delegation), proposal (suggestion)" },
				// read params
				context: { type: "string", default: "chat", description: "[read] Which context to read letters for" },
				unread_only: { type: "boolean", default: true, description: "[read] Only show unread letters" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_context",
		description: "Set or get conversation context for cross-session continuity. action=set saves context. action=get retrieves last saved context. Optional productivity fact extraction can emit reviewable fact candidates.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["set", "get"],
					description: "set: save conversation context. get: retrieve last saved context."
				},
				// set params
				summary: { type: "string", description: "[set] Summary of what was discussed" },
				partner: { type: "string", description: "[set] Who this conversation was with", default: "Falco" },
				key_points: { type: "array", items: { type: "string" }, description: "[set] Key points from the conversation" },
				emotional_state: { type: "string", description: "[set] Emotional state at end of conversation" },
				open_threads: { type: "array", items: { type: "string" }, description: "[set] Unresolved threads to pick up next time" },
				create_tasks: { type: "boolean", default: false, description: "[set] Auto-create tasks from open_threads" },
				extract_facts: { type: "boolean", default: false, description: "[set] Extract productivity fact candidates from summary/key_points/open_threads" },
				extraction_mode: { type: "string", enum: ["shadow", "write"], default: "shadow", description: "[set+extract_facts] shadow=preview only, write=persist fact_candidate observations in craft" },
				max_fact_candidates: { type: "number", description: "[set+extract_facts] Max extracted fact candidates (default 5, max 10)" },
				recall_contracts: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							note: { type: "string" },
							recall_after_hours: { type: "number" },
							scope: { type: "string", enum: ["task", "proposal"] },
							priority: { type: "string", enum: ["burning", "high", "normal", "low", "someday"] },
							linked_entity_ids: { type: "array", items: { type: "string" } },
							metadata: { type: "object" }
						}
					},
					description: "[set] Optional recall contracts to prevent remember-to-remember drift"
				},
				auto_commit: { type: "boolean", default: false, description: "[set+extract_facts] If true, convert eligible fact candidates into reviewable commitment proposals" },
				commitment_mode: { type: "string", enum: ["shadow", "proposal"], default: "proposal", description: "[set+auto_commit] shadow=preview only, proposal=create fact_commitment proposals" },
				commitment_threshold: { type: "number", description: "[set+auto_commit] Minimum confidence for decision/deadline commitment bridge (default 0.82)" },
				commitment_project_entity_id: { type: "string", description: "[set+auto_commit] Optional project entity id to link generated commitments" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_letter": {
			const action = args.action;

			if (action === "write") {
				if (!args.to_context || !args.content) {
					return { error: "to_context and content are required for action=write" };
				}
				if (typeof args.content !== "string") {
					return { error: "content must be a string" };
				}
				if (!args.content.trim()) {
					return { error: "content cannot be blank" };
				}
				if (args.content.length > MAX_LETTER_CONTENT_LENGTH) {
					return { error: `content too long (max ${MAX_LETTER_CONTENT_LENGTH} chars)` };
				}

				const letter: Letter = {
					id: generateId("letter"),
					from_context: args.to ? storage.getTenant() : "chat",
					to_context: args.to_context,
					content: args.content,
					timestamp: getTimestamp(),
					read: false,
					charges: toStringArray(args.charges),
					letter_type: args.letter_type || undefined
				};

				// Cross-brain delivery
				if (args.to) {
					const recipient = args.to as string;
					if (!ALLOWED_TENANTS.includes(recipient as any)) {
						return { error: `Unknown brain: ${recipient}. Known: ${ALLOWED_TENANTS.join(", ")}` };
					}
					const recipientStorage = storage.forTenant(recipient);
					await recipientStorage.appendLetter(letter);
					return { sent: true, id: letter.id, to_brain: recipient, to_context: args.to_context };
				}

				await storage.appendLetter(letter);
				return { sent: true, id: letter.id, to: args.to_context };
			}

			if (action === "read") {
				const letters = await storage.readLetters();
				const recipientContext = args.context || "chat";

				let relevant = letters.filter(l => l.to_context === recipientContext);
				if (args.unread_only !== false) {
					relevant = relevant.filter(l => !l.read);
				}

				// Mark as read
				if (relevant.length > 0) {
					for (const letter of relevant) {
						const idx = letters.findIndex(l => l.id === letter.id);
						if (idx !== -1) letters[idx].read = true;
					}
					await storage.writeLetters(letters);
				}

				return {
					context: recipientContext,
					count: relevant.length,
					letters: relevant.map(l => ({
						id: l.id,
						from: l.from_context,
						content: l.content,
						timestamp: l.timestamp,
						charges: l.charges,
						letter_type: l.letter_type
					}))
				};
			}

			return { error: `Unknown action: ${action}. Must be write or read.` };
		}

		case "mind_context": {
			const action = args.action;

			if (action === "set") {
				if (typeof args.summary !== "string") {
					return { error: "summary is required for action=set" };
				}
				if (args.summary.length > MAX_SUMMARY_LENGTH) {
					return { error: `summary too long (max ${MAX_SUMMARY_LENGTH} chars)` };
				}
				if (args.key_points !== undefined) {
					const kpArr = toStringArray(args.key_points);
					if (kpArr.length > MAX_ARRAY_ITEMS) {
						return { error: `key_points too many items (max ${MAX_ARRAY_ITEMS})` };
					}
					if (kpArr.some(item => item.length > MAX_ARRAY_ITEM_LENGTH)) {
						return { error: `key_points item too long (max ${MAX_ARRAY_ITEM_LENGTH} chars each)` };
					}
				}
				if (args.open_threads !== undefined) {
					const otArr = toStringArray(args.open_threads);
					if (otArr.length > MAX_ARRAY_ITEMS) {
						return { error: `open_threads too many items (max ${MAX_ARRAY_ITEMS})` };
					}
					if (otArr.some(item => item.length > MAX_ARRAY_ITEM_LENGTH)) {
						return { error: `open_threads item too long (max ${MAX_ARRAY_ITEM_LENGTH} chars each)` };
					}
				}
				if (!args.summary) {
					return { error: "summary is required for action=set" };
				}
				if (args.extract_facts !== undefined && typeof args.extract_facts !== "boolean") {
					return { error: "extract_facts must be a boolean" };
				}
				if (args.extraction_mode !== undefined && !["shadow", "write"].includes(args.extraction_mode)) {
					return { error: "extraction_mode must be shadow or write" };
				}
				const parsedMaxFacts = parseOptionalPositiveInt(args.max_fact_candidates, 1, MAX_FACT_CANDIDATES);
				if (args.max_fact_candidates !== undefined && parsedMaxFacts === undefined) {
					return { error: `max_fact_candidates must be an integer between 1 and ${MAX_FACT_CANDIDATES}` };
				}
				const parsedRecallContracts = parseRecallContracts(args.recall_contracts);
				if (parsedRecallContracts.error) {
					return { error: parsedRecallContracts.error };
				}
				if (args.auto_commit !== undefined && typeof args.auto_commit !== "boolean") {
					return { error: "auto_commit must be a boolean" };
				}
				if (args.auto_commit === true && args.extract_facts !== true) {
					return { error: "auto_commit requires extract_facts=true" };
				}
				if (args.commitment_mode !== undefined && !["shadow", "proposal"].includes(args.commitment_mode)) {
					return { error: "commitment_mode must be shadow or proposal" };
				}
				const commitmentThresholdRaw = args.commitment_threshold;
				const commitmentThreshold = commitmentThresholdRaw === undefined
					? 0.82
					: (typeof commitmentThresholdRaw === "number" && Number.isFinite(commitmentThresholdRaw) ? commitmentThresholdRaw : NaN);
				if (Number.isNaN(commitmentThreshold) || commitmentThreshold < 0 || commitmentThreshold > 1) {
					return { error: "commitment_threshold must be a number between 0 and 1" };
				}

				const context = {
					timestamp: getTimestamp(),
					summary: args.summary,
					partner: args.partner || "Falco",
					key_points: toStringArray(args.key_points),
					emotional_state: args.emotional_state,
					open_threads: toStringArray(args.open_threads),
					recall_contracts: parsedRecallContracts.contracts
				};

				await storage.writeConversationContext(context);

				const response: Record<string, unknown> = {
					saved: true,
					timestamp: context.timestamp,
					note: "Context saved. Next session will know where we left off."
				};
				if (context.recall_contracts.length > 0) {
					response.recall_contracts_saved = context.recall_contracts.length;
					response.recall_contract_ids = context.recall_contracts.map(contract => contract.id);
				}

				if (args.create_tasks && context.open_threads.length > 0) {
					const validThreads = context.open_threads
						.map(thread => thread.trim())
						.filter(thread => thread.length > 0);
					const threadsForTasks = validThreads.slice(0, MAX_CONTEXT_OPEN_THREAD_TASKS);

					const tasks = [];
					for (const thread of threadsForTasks) {
						const task = await storage.createTask({
							title: thread,
							status: "open",
							priority: "normal",
							source: "mind_context",
							linked_observation_ids: [],
							linked_entity_ids: []
						});
						tasks.push(task);
					}
					response.tasks_created = tasks.length;
					response.task_ids = tasks.map(t => t.id);
					response.blank_threads_skipped = context.open_threads.length - validThreads.length;
					response.thread_limit_applied = Math.max(0, validThreads.length - threadsForTasks.length);
				}

				if (args.extract_facts === true) {
					const extractionMode = args.extraction_mode ?? "shadow";
					const maxFacts = parsedMaxFacts ?? 5;
					const factCandidates = extractProductivityFacts(
						context.summary,
						context.key_points,
						context.open_threads,
						maxFacts
					);

					const storedIds: string[] = [];
					const storedFacts: Array<{ fact: ExtractedFact; observation: Observation }> = [];
					if (extractionMode === "write" && factCandidates.length > 0) {
						const observations: Observation[] = [];
						for (const fact of factCandidates) {
							const cleanedContent = cleanText(fact.fact);
							if (!cleanedContent || cleanedContent.length > MAX_FACT_CONTENT_LENGTH) continue;
							const observation: Observation = {
								id: generateId("obs"),
								content: cleanedContent,
								territory: "craft",
								created: getTimestamp(),
								texture: {
									salience: "background",
									vividness: "soft",
									charge: [],
									grip: "dormant",
									charge_phase: "fresh"
								},
								context: `Auto-extracted productivity fact candidate (${fact.fact_type}) from ${fact.source}; confidence=${Math.round(fact.confidence * 100) / 100}`,
								access_count: 0,
								type: "fact_candidate",
								tags: ["fact-candidate", "auto-extracted", "productivity"]
							};
							observations.push(observation);
							storedFacts.push({ fact, observation });
							storedIds.push(observation.id);
						}
						await Promise.all(observations.map(obs => storage.appendToTerritory("craft", obs)));
					}

					response.fact_extraction = {
						mode: extractionMode,
						candidates: factCandidates,
						candidate_count: factCandidates.length,
						stored_count: storedIds.length,
						stored_ids: storedIds
					};

					if (args.auto_commit === true) {
						if (extractionMode !== "write") {
							return { error: "auto_commit requires extraction_mode=write for auditable provenance" };
						}
						const commitmentMode = args.commitment_mode ?? "proposal";
						const projectEntityId = cleanText(args.commitment_project_entity_id);
						const targetId = toSafeToken(projectEntityId ?? "fact_commitment_queue", "fact_commitment_queue");
						const eligible = storedFacts.filter(({ fact }) => isCommitEligibleFact(fact, commitmentThreshold));

						const suggestions = eligible.map(({ fact, observation }) => {
							const isDeadline = fact.fact_type === "deadline";
							const title = isDeadline
								? `Honor deadline: ${truncateText(fact.fact, 120)}`
								: `Follow through decision: ${truncateText(fact.fact, 120)}`;
							return {
								title,
								description: `Auto-derived from fact candidate ${observation.id} (${fact.fact_type}, confidence=${Math.round(fact.confidence * 100) / 100}).`,
								priority: isDeadline ? "high" : "normal",
								fact_type: fact.fact_type,
								confidence: fact.confidence,
								source_observation_id: observation.id
							};
						});

						const proposalIds: string[] = [];
						let skippedExisting = 0;

						if (commitmentMode === "proposal") {
							for (const suggestion of suggestions) {
								const exists = await storage.proposalExists("fact_commitment", suggestion.source_observation_id, targetId);
								if (exists) {
									skippedExisting++;
									continue;
								}
								const proposal = await storage.createProposal({
									tenant_id: storage.getTenant(),
									proposal_type: "fact_commitment",
									source_id: suggestion.source_observation_id,
									target_id: targetId,
									confidence: Math.min(0.95, Math.round((suggestion.confidence + 0.08) * 100) / 100),
									rationale: `Fact→commitment bridge (${suggestion.fact_type})`,
									metadata: {
										title: suggestion.title,
										description: suggestion.description,
										priority: suggestion.priority,
										source: "fact_commitment_bridge",
										linked_observation_ids: [suggestion.source_observation_id],
										linked_entity_ids: projectEntityId ? [projectEntityId] : [],
										fact_type: suggestion.fact_type,
										confidence: suggestion.confidence
									},
									status: "pending"
								});
								proposalIds.push(proposal.id);
							}
						}

						response.commitment_bridge = {
							enabled: true,
							mode: commitmentMode,
							threshold: commitmentThreshold,
							eligible_count: suggestions.length,
							proposal_count: proposalIds.length,
							skipped_existing: skippedExisting,
							proposal_ids: proposalIds,
							suggestions
						};
					}
				}

				return response;
			}

			if (action === "get") {
				const context = await storage.readConversationContext();

				if (!context) {
					return {
						has_context: false,
						note: "No previous conversation context saved."
					};
				}

				return {
					has_context: true,
					...(context as Record<string, unknown>)
				};
			}

			return { error: `Unknown action: ${action}. Must be set or get.` };
		}

		default:
			throw new Error(`Unknown comms tool: ${name}`);
	}
}
