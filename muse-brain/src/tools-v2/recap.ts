// ============ RECAP TOOL (v2) ============
// mind_recap      — generate / get / list session recaps
// mind_recap_search — semantic search across recaps
//
// Recaps are Tier 2 knowledge nodes: structured summaries of a window of raw
// chat messages, stored as graph nodes with embeddings so they survive model
// switches (continuity spine Phase A).

import type { ToolContext } from "./context";
import type { RecapMessage } from "../types";
import { WorkersAIEmbeddingProvider } from "../embedding/workers-ai";

// ============ TEXT GENERATION ============

const TEXT_GEN_MODEL = "@cf/meta/llama-3.2-3b-instruct";

type AiTextGenRun = (
	model: string,
	input: { messages: Array<{ role: string; content: string }>; max_tokens?: number }
) => Promise<{ response: string }>;

const RECAP_SYSTEM_PROMPT = `You are a conversation summarizer for a creative studio. Given a window of chat messages, produce a structured recap as JSON.

Requirements:
- Use the actual names provided (never "User" or "Assistant")
- Focus on: decisions made, topics discussed, questions raised, tasks assigned, insights shared
- Each paragraph should cover a coherent topic or decision
- Be concise but preserve important details — this recap restores context after a model switch
- Include entity names (people, projects, tools, concepts) that were discussed
- Extract 3-7 topic tags that categorize the conversation

Output JSON only:
{
  "content": "Recap paragraphs here...",
  "topic_tags": ["tag1", "tag2", "tag3"],
  "entity_names": ["Person1", "ProjectX"]
}`;

function extractTopicTags(text: string): string[] {
	// Pull capitalised multi-word phrases and common topic patterns as a fallback
	// when the model doesn't return JSON.
	const tags: Set<string> = new Set();

	// Capitalised proper nouns (2+ words)
	const properNouns = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g) ?? [];
	for (const noun of properNouns.slice(0, 4)) {
		tags.add(noun.toLowerCase());
	}

	// Common topic words
	const topicWords = ["code", "design", "writing", "task", "project", "bug", "feature", "deploy", "review", "plan"];
	for (const word of topicWords) {
		if (text.toLowerCase().includes(word)) tags.add(word);
		if (tags.size >= 5) break;
	}

	return Array.from(tags).slice(0, 7);
}

async function generateRecapContent(
	ai: Ai,
	messages: RecapMessage[],
	userName: string,
	companionName: string
): Promise<{ content: string; topic_tags: string[]; entity_names: string[] }> {
	const formatted = messages.map(m => {
		const speaker = m.role === "user" ? userName : companionName;
		return `${speaker}: ${m.content}`;
	}).join("\n\n");

	let result: { response: string };
	try {
		result = await (ai.run as unknown as AiTextGenRun)(TEXT_GEN_MODEL, {
			messages: [
				{ role: "system", content: RECAP_SYSTEM_PROMPT },
				{ role: "user", content: formatted }
			],
			max_tokens: 1024
		});
	} catch (err) {
		throw new Error(`Workers AI text generation failed: ${err instanceof Error ? err.message : "unknown error"}`);
	}

	// Coerce response to string — Workers AI response shape varies by model
	const responseText = typeof result.response === "string"
		? result.response
		: (result.response != null ? JSON.stringify(result.response) : "");

	if (!responseText) {
		return { content: "[empty recap]", topic_tags: [], entity_names: [] };
	}

	// Parse the JSON response, with fallback to plain text
	try {
		// The model sometimes wraps JSON in markdown code fences — strip them
		const raw = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
		const parsed = JSON.parse(raw);
		return {
			content: typeof parsed.content === "string" ? parsed.content : responseText,
			topic_tags: Array.isArray(parsed.topic_tags) ? parsed.topic_tags.filter((t: unknown) => typeof t === "string") : [],
			entity_names: Array.isArray(parsed.entity_names) ? parsed.entity_names.filter((n: unknown) => typeof n === "string") : []
		};
	} catch {
		// Model didn't return JSON — use raw text with heuristic tags
		return {
			content: responseText,
			topic_tags: extractTopicTags(responseText),
			entity_names: []
		};
	}
}

// ============ TOOL DEFINITIONS ============

const VALID_LAYERS = ["personal", "writers-room", "film-studio"] as const;
const MAX_SESSION_ID_LEN = 200;
const MAX_MESSAGES = 500;
const MAX_USER_NAME_LEN = 100;
const MAX_RECAP_CONTENT_LEN = 8000;  // ~2000 tokens — hard cap on Workers AI output before persistence
const MAX_TOPIC_TAGS = 10;
const MAX_ENTITY_NAMES = 30;

export const TOOL_DEFS = [
	{
		name: "mind_recap",
		description: "Generate, retrieve, or list session recaps. Recaps are structured summaries of a message window that restore context after a model switch (continuity spine). action=generate synthesises a recap via Workers AI and stores it. action=get fetches a single recap by ID. action=list lists recaps by session or companion+layer.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["generate", "get", "list"],
					description: "generate: synthesise and store a recap. get: fetch by recap_id. list: list recaps by session_id or companion+layer."
				},
				// --- generate ---
				session_id: { type: "string", description: "[generate/list] Session identifier." },
				companion: {
					type: "string",
					description: "[generate/list] Companion name (e.g. 'rainer', 'rook')."
				},
				layer: {
					type: "string",
					enum: ["personal", "writers-room", "film-studio"],
					description: "[generate/list] Layer. Default: personal."
				},
				user_name: { type: "string", description: "[generate] Display name for the human in the transcript." },
				companion_name: { type: "string", description: "[generate] Display name for the AI companion in the transcript." },
				messages: {
					type: "array",
					description: "[generate] Window of messages to summarise. Each item: { role: 'user'|'assistant', content: string, seq?: number }.",
					items: {
						type: "object",
						properties: {
							role: { type: "string" },
							content: { type: "string" },
							seq: { type: "number" }
						},
						required: ["role", "content"]
					}
				},
				since_seq: { type: "number", description: "[generate] First message seq in the window." },
				through_seq: { type: "number", description: "[generate] Last message seq in the window." },
				// --- get ---
				recap_id: { type: "string", description: "[get] Recap ID to fetch." },
				include_links: { type: "boolean", default: false, description: "[get] Include entity links and edges." },
				// --- list ---
				since: { type: "string", description: "[list] ISO date — only return recaps created on or after this timestamp." },
				limit: { type: "number", default: 20, description: "[list/get] Max results." },
				include_consolidated: { type: "boolean", default: false, description: "[list] Include recaps that have been consolidated into a Tier 3 doc." }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_recap_search",
		description: "Semantic search across stored recaps using a text query. Embeds the query with Workers AI and runs vector similarity search against recap embeddings. Returns recaps scored by relevance.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Natural language query to search recaps." },
				companion: { type: "string", description: "Narrow to a specific companion ('rainer', 'rook')." },
				layer: {
					type: "string",
					enum: ["personal", "writers-room", "film-studio"],
					description: "Narrow to a specific layer."
				},
				limit: { type: "number", default: 10, description: "Max results (max 50)." }
			},
			required: ["query"]
		}
	}
];

// ============ HANDLER ============

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;

	// ---- mind_recap ----
	if (name === "mind_recap") {
		const action = args.action;

		switch (action) {
			case "generate": {
				// --- Input validation ---
				if (!args.session_id?.trim()) return { error: "session_id is required" };
				const sessionId = String(args.session_id).trim();
				if (sessionId.length > MAX_SESSION_ID_LEN) return { error: `session_id too long (max ${MAX_SESSION_ID_LEN} chars)` };

				if (!args.companion?.trim()) return { error: "companion is required" };
				const companion = String(args.companion).trim();

				const layer = String(args.layer ?? "personal").trim();
				if (!VALID_LAYERS.includes(layer as typeof VALID_LAYERS[number])) {
					return { error: `layer must be one of: ${VALID_LAYERS.join(", ")}` };
				}

				const messages: RecapMessage[] = Array.isArray(args.messages) ? args.messages : [];
				if (messages.length === 0) return { error: "messages array is required and must not be empty" };
				if (messages.length > MAX_MESSAGES) return { error: `Too many messages (max ${MAX_MESSAGES})` };

				// Validate each message
				for (const msg of messages) {
					if (!msg.role || !msg.content) return { error: "Each message must have role and content" };
					if (typeof msg.content !== "string") return { error: "Message content must be a string" };
				}

				const since_seq = typeof args.since_seq === "number" ? Math.floor(args.since_seq) : 0;
				const through_seq = typeof args.through_seq === "number" ? Math.floor(args.through_seq) : messages.length - 1;

				const userName = typeof args.user_name === "string" && args.user_name.trim()
					? args.user_name.trim().slice(0, MAX_USER_NAME_LEN)
					: "User";
				const companionName = typeof args.companion_name === "string" && args.companion_name.trim()
					? args.companion_name.trim().slice(0, MAX_USER_NAME_LEN)
					: companion;

				// --- Workers AI text generation ---
				if (!context.ai) {
					return { error: "Workers AI binding not available — cannot generate recap" };
				}

				// --- Idempotency check: skip if recap already exists for this window ---
				const existing = await storage.getLatestRecapForSession(sessionId);
				if (existing && existing.through_seq >= through_seq) {
					return {
						recap_id: existing.id,
						content: existing.content,
						topic_tags: existing.topic_tags,
						entity_refs: existing.entity_refs,
						message_count: existing.message_count,
						token_estimate: existing.token_estimate,
						session_id: existing.session_id,
						companion: existing.companion,
						layer: existing.layer,
						created_at: existing.created_at,
						idempotent: true  // signal to caller that this was a cache hit
					};
				}

				let recapContent: string;
				let topicTags: string[];
				let entityNames: string[];
				try {
					const generated = await generateRecapContent(context.ai, messages, userName, companionName);
					recapContent = generated.content.slice(0, MAX_RECAP_CONTENT_LEN);
					topicTags = generated.topic_tags.slice(0, MAX_TOPIC_TAGS);
					entityNames = generated.entity_names.slice(0, MAX_ENTITY_NAMES);
				} catch (err) {
					return { error: `Recap generation failed: ${err instanceof Error ? err.message : "unknown error"}` };
				}

				// --- Embed the recap content ---
				let embedding: number[] | undefined;
				try {
					const embedder = new WorkersAIEmbeddingProvider(context.ai);
					embedding = await embedder.embedText(recapContent);
				} catch (err) {
					// Non-fatal — recap is stored, just not searchable by vector
					console.error(`[recap] embedding failed, storing without vector:`, err instanceof Error ? err.message : err);
					embedding = undefined;
				}

				// --- Build provenance ---
				const provenance = {
					ranges: [
						{
							summary_paragraph: 1,
							seq_range: [since_seq, through_seq] as [number, number],
							key_messages: messages.slice(0, 3).map(m => m.content.slice(0, 80))
						}
					],
					session_id: sessionId
				};

				// Rough token estimate (4 chars ≈ 1 token)
				const tokenEstimate = Math.ceil(recapContent.length / 4);

				// --- Store recap ---
				const recap = await storage.createRecap({
					tenant_id: storage.getTenant(),
					session_id: sessionId,
					companion,
					layer,
					content: recapContent,
					topic_tags: topicTags,
					entity_refs: [],
					provenance,
					since_seq,
					through_seq,
					message_count: messages.length,
					token_estimate: tokenEstimate,
					embedding
				});

				// --- Background: temporal edge + entity links (fire-and-forget) ---
				// Failures are logged but never surface to the caller. Idempotent via ON CONFLICT DO NOTHING.
				if (context.waitUntil) {
					context.waitUntil((async () => {
						try {
							// Temporal edge to previous recap for this session
							const prev = await storage.getLatestRecapForSession(sessionId);
							// prev may be the recap we just created — skip self-edges.
							if (prev && prev.id !== recap.id) {
								await storage.createRecapEdge({
									source_id: recap.id,
									target_id: prev.id,
									tenant_id: storage.getTenant(),
									edge_type: "temporal",
									weight: 1.0
								});
							}
						} catch (err) {
							console.error(`[recap] temporal edge failed for ${recap.id}:`, err instanceof Error ? err.message : err);
						}

						// Entity linking
						let linked = 0;
						for (const entityName of entityNames) {
							try {
								const entity = await storage.findEntityByName(entityName);
								if (entity) {
									await storage.linkRecapToEntity(recap.id, entity.id);
									linked++;
								}
							} catch (err) {
								console.error(`[recap] entity link failed for "${entityName}" on ${recap.id}:`, err instanceof Error ? err.message : err);
							}
						}
						if (entityNames.length > 0) {
							console.log(`[recap] entity linking: ${linked}/${entityNames.length} linked for ${recap.id}`);
						}
					})());
				}

				return {
					recap_id: recap.id,
					content: recap.content,
					topic_tags: recap.topic_tags,
					entity_refs: recap.entity_refs,
					message_count: recap.message_count,
					token_estimate: recap.token_estimate,
					session_id: recap.session_id,
					companion: recap.companion,
					layer: recap.layer,
					created_at: recap.created_at
				};
			}

			case "get": {
				if (!args.recap_id?.trim()) return { error: "recap_id is required" };
				const recapId = String(args.recap_id).trim();

				const recap = await storage.getRecap(recapId);
				if (!recap) return { error: "Recap not found" };

				const result: Record<string, unknown> = { recap };

				if (args.include_links) {
					result.entity_links = await storage.getRecapEntityLinks(recapId);
					result.edges = await storage.getRecapEdges(recapId, "both");
				}

				return result;
			}

			case "list": {
				const limit = Math.min(typeof args.limit === "number" ? Math.floor(args.limit) : 20, 100);

				const filter = {
					session_id: args.session_id?.trim() || undefined,
					companion: args.companion?.trim() || undefined,
					layer: args.layer?.trim() || undefined,
					since: args.since?.trim() || undefined,
					limit,
					include_consolidated: args.include_consolidated ?? false
				};

				const recaps = await storage.searchRecaps(filter);
				return { recaps, count: recaps.length };
			}

			default:
				return { error: `Unknown action: ${action}` };
		}
	}

	// ---- mind_recap_search ----
	if (name === "mind_recap_search") {
		if (!args.query?.trim()) return { error: "query is required" };
		const query = String(args.query).trim();
		if (query.length > 2000) return { error: "query too long (max 2000 chars)" };

		if (!context.ai) {
			return { error: "Workers AI binding not available — cannot run semantic search" };
		}

		const limit = Math.min(typeof args.limit === "number" ? Math.floor(args.limit) : 10, 50);
		const companion = args.companion?.trim() || undefined;
		const layer = args.layer?.trim() || undefined;

		let queryEmbedding: number[];
		try {
			const embedder = new WorkersAIEmbeddingProvider(context.ai);
			queryEmbedding = await embedder.embedText(query);
		} catch (err) {
			return { error: `Embedding failed: ${err instanceof Error ? err.message : "unknown error"}` };
		}

		const results = await storage.searchRecapsBySemantic(queryEmbedding, limit, companion, layer);
		return {
			results: results.map(r => ({
				recap_id: r.id,
				session_id: r.session_id,
				companion: r.companion,
				layer: r.layer,
				content: r.content,
				topic_tags: r.topic_tags,
				similarity: Math.round(r.similarity * 10000) / 10000,
				created_at: r.created_at
			})),
			count: results.length
		};
	}

	return { error: `Unknown tool: ${name}` };
}
