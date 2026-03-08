// ============ OPEN LOOP TOOLS ============
// mind_open_loop, mind_list_loops, mind_resolve_loop

import type { OpenLoop } from "../types";
import { TERRITORIES, LOOP_STATUSES } from "../constants";
import { getTimestamp, generateId } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// OPEN LOOPS (ZEIGARNIK)
	{
		name: "mind_open_loop",
		description: "Create an open loop - unfinished business that pulls attention.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), default: "self" },
				status: { type: "string", enum: LOOP_STATUSES, default: "nagging" }
			},
			required: ["content"]
		}
	},
	{
		name: "mind_list_loops",
		description: "List all open loops, sorted by urgency.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_resolve_loop",
		description: "Resolve an open loop.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				resolution_note: { type: "string" }
			},
			required: ["id"]
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_open_loop": {
			const loop: OpenLoop = {
				id: generateId("loop"),
				content: args.content,
				status: args.status || "nagging",
				territory: storage.validateTerritory(args.territory || "self"),
				created: getTimestamp()
			};

			await storage.appendOpenLoop(loop);

			return { created: true, id: loop.id, status: loop.status };
		}

		case "mind_list_loops": {
			const loops = await storage.readOpenLoops();
			const active = loops.filter(l => !["resolved", "abandoned"].includes(l.status));

			const statusOrder: Record<string, number> = { burning: 0, nagging: 1, background: 2 };
			active.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

			return {
				total_active: active.length,
				loops: active.map(l => ({
					id: l.id,
					content: l.content,
					status: l.status,
					territory: l.territory,
					created: l.created
				}))
			};
		}

		case "mind_resolve_loop": {
			const loops = await storage.readOpenLoops();
			const idx = loops.findIndex(l => l.id === args.id);

			if (idx === -1) return { resolved: false, error: "Loop not found" };

			loops[idx].status = "resolved";
			loops[idx].resolved = getTimestamp();
			loops[idx].resolution_note = args.resolution_note;

			await storage.writeOpenLoops(loops);

			return { resolved: true, id: args.id };
		}

		default:
			throw new Error(`Unknown loop tool: ${name}`);
	}
}
