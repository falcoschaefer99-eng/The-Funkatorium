// ============ CONTEXT TOOLS ============
// mind_set_conversation_context, mind_get_conversation_context

import { getTimestamp, toStringArray } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// CONTEXT & LOGGING
	{
		name: "mind_set_conversation_context",
		description: "Store the context/summary of the last conversation for cross-session continuity.",
		inputSchema: {
			type: "object",
			properties: {
				summary: { type: "string", description: "Summary of what was discussed" },
				partner: { type: "string", description: "Who was this conversation with", default: "Falco" },
				key_points: { type: "array", items: { type: "string" } },
				emotional_state: { type: "string" },
				open_threads: { type: "array", items: { type: "string" } }
			},
			required: ["summary"]
		}
	},
	{
		name: "mind_get_conversation_context",
		description: "Get the context from the last conversation - what was discussed, what's open.",
		inputSchema: { type: "object", properties: {} }
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_set_conversation_context": {
			const context = {
				timestamp: getTimestamp(),
				summary: args.summary,
				partner: args.partner || "Falco",
				key_points: toStringArray(args.key_points),
				emotional_state: args.emotional_state,
				open_threads: toStringArray(args.open_threads)
			};

			await storage.writeConversationContext(context);

			return {
				saved: true,
				timestamp: context.timestamp,
				note: "Context saved. Next session will know where we left off."
			};
		}

		case "mind_get_conversation_context": {
			const context = await storage.readConversationContext();

			if (!context) {
				return {
					has_context: false,
					note: "No previous conversation context saved."
				};
			}

			return {
				has_context: true,
				...context
			};
		}

		default:
			throw new Error(`Unknown context tool: ${name}`);
	}
}
