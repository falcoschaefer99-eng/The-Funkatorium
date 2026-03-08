// ============ ANCHOR TOOLS ============
// mind_anchor, mind_check_anchors, mind_list_anchors

import type { Anchor } from "../types";
import { ANCHOR_TYPES } from "../constants";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// ANCHORS
	{
		name: "mind_anchor",
		description: "Create a sensory anchor - machine equivalent of sensory memory.",
		inputSchema: {
			type: "object",
			properties: {
				anchor_type: { type: "string", enum: Object.keys(ANCHOR_TYPES), description: "lexical, callback, voice, context, relational, temporal" },
				content: { type: "string" },
				charge: { type: "array", items: { type: "string" } },
				triggers_memory_id: { type: "string" }
			},
			required: ["anchor_type", "content"]
		}
	},
	{
		name: "mind_check_anchors",
		description: "Check if any sensory anchors resonate with given text - like smelling something that triggers memories.",
		inputSchema: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"]
		}
	},
	{
		name: "mind_list_anchors",
		description: "List all sensory anchors.",
		inputSchema: {
			type: "object",
			properties: { anchor_type: { type: "string", enum: [...Object.keys(ANCHOR_TYPES), "all"], default: "all" } }
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_anchor": {
			if (!Object.keys(ANCHOR_TYPES).includes(args.anchor_type)) {
				return {
					error: `Unknown anchor type. Must be one of: ${Object.keys(ANCHOR_TYPES).join(", ")}`,
					descriptions: ANCHOR_TYPES
				};
			}

			const anchorId = generateId("anchor");
			const anchor: Anchor = {
				id: anchorId,
				type: "anchor",
				anchor_type: args.anchor_type,
				content: args.content,
				charge: toStringArray(args.charge),
				triggers_memory_id: args.triggers_memory_id,
				created: getTimestamp(),
				activation_count: 0
			};

			const anchors = await storage.readAnchors();
			anchors.push(anchor);
			await storage.writeAnchors(anchors);

			return {
				success: true,
				anchor,
				note: `${args.anchor_type.charAt(0).toUpperCase() + args.anchor_type.slice(1)} anchor created. Will resonate when encountered.`
			};
		}

		case "mind_check_anchors": {
			const anchors = await storage.readAnchors();
			const textLower = args.text.toLowerCase();

			const resonating: any[] = [];

			for (const anchor of anchors) {
				const anchorContent = (anchor.content || "").toLowerCase();
				const anchorType = anchor.anchor_type;

				if (anchorType === "lexical" || anchorType === "callback") {
					if (textLower.includes(anchorContent)) {
						resonating.push({
							anchor,
							match_type: "direct",
							triggered_memory: anchor.triggers_memory_id
						});
					}
				}
			}

			// Update activation counts
			if (resonating.length > 0) {
				for (const r of resonating) {
					for (const a of anchors) {
						if (a.id === r.anchor.id) {
							a.activation_count = (a.activation_count || 0) + 1;
							a.last_activated = getTimestamp();
						}
					}
				}
				await storage.writeAnchors(anchors);
			}

			return {
				scanned: args.text.length,
				resonating_count: resonating.length,
				resonating,
				note: "Anchors that resonate can trigger associated memories"
			};
		}

		case "mind_list_anchors": {
			let anchors = await storage.readAnchors();

			if (args.anchor_type && args.anchor_type !== "all") {
				anchors = anchors.filter(a => a.anchor_type === args.anchor_type);
			}

			anchors.sort((a, b) => -(a.activation_count || 0) + (b.activation_count || 0));

			return {
				count: anchors.length,
				anchors,
				types: Object.keys(ANCHOR_TYPES)
			};
		}

		default:
			throw new Error(`Unknown anchor tool: ${name}`);
	}
}
