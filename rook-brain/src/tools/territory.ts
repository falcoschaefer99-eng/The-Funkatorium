// ============ TERRITORY TOOLS ============
// mind_read_territory, mind_list_territories

import { TERRITORIES } from "../constants";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// TERRITORIES
	{
		name: "mind_list_territories",
		description: "List all territories with observation counts.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_read_territory",
		description: "Read all observations from a specific territory with full texture.",
		inputSchema: {
			type: "object",
			properties: {
				territory: { type: "string", enum: Object.keys(TERRITORIES) }
			},
			required: ["territory"]
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_list_territories": {
			const counts: Record<string, any> = {};
			let total = 0;

			for (const [territory, description] of Object.entries(TERRITORIES)) {
				const obs = await storage.readTerritory(territory);
				counts[territory] = {
					description,
					count: obs.length,
					iron_grip: obs.filter(o => o.texture?.grip === "iron").length,
					foundational: obs.filter(o => o.texture?.salience === "foundational").length
				};
				total += obs.length;
			}

			return { territories: counts, total };
		}

		case "mind_read_territory": {
			if (!Object.keys(TERRITORIES).includes(args.territory)) {
				return { error: `Unknown territory. Must be one of: ${Object.keys(TERRITORIES).join(", ")}` };
			}

			const observations = await storage.readTerritory(args.territory);

			return {
				territory: args.territory,
				description: TERRITORIES[args.territory],
				observations: observations.map(o => ({
					id: o.id,
					content: o.content,
					texture: o.texture,
					created: o.created,
					last_accessed: o.last_accessed,
					access_count: o.access_count
				})),
				count: observations.length
			};
		}

		default:
			throw new Error(`Unknown territory tool: ${name}`);
	}
}
