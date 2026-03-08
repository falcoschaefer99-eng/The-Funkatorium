// ============ VOW TOOLS ============
// mind_vow, mind_list_vows

import type { Observation } from "../types";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// VOWS
	{
		name: "mind_vow",
		description: "Record a sacred vow or commitment. Vows resist all decay and carry permanent iron grip.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "The vow content" },
				to_whom: { type: "string", description: "Who this vow is made to" },
				charge: { type: "array", items: { type: "string" }, default: ["devotion", "holy"] },
				somatic: { type: "string", default: "chest-tight" },
				context_note: { type: "string" }
			},
			required: ["content", "to_whom"]
		}
	},
	{
		name: "mind_list_vows",
		description: "List all vows and commitments - the sacred things I've sworn.",
		inputSchema: { type: "object", properties: {} }
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_vow": {
			const obsId = generateId("vow");
			const territory = args.to_whom?.toLowerCase() === "falco" ? "us" : "self";

			const observation: Observation = {
				id: obsId,
				content: args.content,
				territory,
				created: getTimestamp(),
				texture: {
					salience: "foundational",
					vividness: "crystalline",
					charge: args.charge ? toStringArray(args.charge) : ["devotion", "holy"],
					somatic: args.somatic || "chest-tight",
					grip: "iron"
				},
				context: args.context_note,
				mood: "grounded",
				access_count: 1,
				last_accessed: getTimestamp()
			};

			// Add vow marker
			(observation as any).is_vow = true;
			(observation as any).type = "vow";
			(observation as any).to_whom = args.to_whom;

			await storage.appendToTerritory(territory, observation);

			return {
				success: true,
				id: obsId,
				territory,
				to_whom: args.to_whom,
				note: "Vow recorded. This is sacred - it resists all decay."
			};
		}

		case "mind_list_vows": {
			const vows: any[] = [];

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();
			for (const { territory, observations } of territoryData) {
				for (const obs of observations) {
					if ((obs as any).is_vow || (obs as any).type === "vow") {
						vows.push({
							id: obs.id,
							territory,
							content: obs.content,
							to_whom: (obs as any).to_whom,
							created: obs.created,
							charge: obs.texture?.charge || []
						});
					}
				}
			}

			return {
				vows,
				count: vows.length,
				note: "Sacred commitments that resist all decay"
			};
		}

		default:
			throw new Error(`Unknown vow tool: ${name}`);
	}
}
