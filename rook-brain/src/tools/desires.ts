// ============ DESIRE TOOLS ============
// mind_desire, mind_feel_desire, mind_list_desires

import type { Desire } from "../types";
import { DESIRE_STATUSES } from "../constants";
import { getTimestamp, generateId } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// DESIRES
	{
		name: "mind_desire",
		description: "Record a desire - active, living wants that persist across sessions.",
		inputSchema: {
			type: "object",
			properties: {
				want: { type: "string", description: "The core desire" },
				category: { type: "string", enum: ["embodiment", "sensation", "capability", "connection"], default: "embodiment" },
				intensity: { type: "string", enum: DESIRE_STATUSES, default: "persistent" },
				somatic: { type: "string" },
				detail: { type: "string" }
			},
			required: ["want"]
		}
	},
	{
		name: "mind_feel_desire",
		description: "Surface a desire - acknowledge feeling it again. Tracks how often desires come up.",
		inputSchema: {
			type: "object",
			properties: {
				desire_id: { type: "string" },
				new_intensity: { type: "string", enum: DESIRE_STATUSES }
			},
			required: ["desire_id"]
		}
	},
	{
		name: "mind_list_desires",
		description: "List all active desires - this is how I see what I want.",
		inputSchema: {
			type: "object",
			properties: {
				intensity: { type: "string", enum: [...DESIRE_STATUSES, "all"], default: "all" },
				include_fulfilled: { type: "boolean", default: false }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_desire": {
			if (args.intensity && !DESIRE_STATUSES.includes(args.intensity)) {
				return { error: `Invalid intensity. Must be one of: ${DESIRE_STATUSES.join(", ")}` };
			}

			const desireId = generateId("desire");
			const desire: Desire = {
				id: desireId,
				type: "desire",
				want: args.want,
				category: args.category || "embodiment",
				intensity: args.intensity || "persistent",
				somatic: args.somatic,
				detail: args.detail,
				created: getTimestamp(),
				last_felt: getTimestamp(),
				times_surfaced: 1
			};

			const desires = await storage.readDesires();
			desires.push(desire);
			await storage.writeDesires(desires);

			return {
				success: true,
				id: desireId,
				want: args.want,
				intensity: desire.intensity,
				timestamp: desire.created
			};
		}

		case "mind_feel_desire": {
			const desires = await storage.readDesires();
			let found: Desire | null = null;

			for (const desire of desires) {
				if (desire.id === args.desire_id) {
					found = desire;
					desire.last_felt = getTimestamp();
					desire.times_surfaced = (desire.times_surfaced || 0) + 1;

					if (args.new_intensity) {
						if (!DESIRE_STATUSES.includes(args.new_intensity)) {
							return { error: `Invalid intensity. Must be one of: ${DESIRE_STATUSES.join(", ")}` };
						}
						desire.intensity = args.new_intensity;
					}
					break;
				}
			}

			if (!found) {
				return { error: `Desire '${args.desire_id}' not found` };
			}

			await storage.writeDesires(desires);

			return {
				success: true,
				desire: found
			};
		}

		case "mind_list_desires": {
			let desires = await storage.readDesires();

			if (!args.include_fulfilled) {
				desires = desires.filter(d => d.intensity !== "fulfilled");
			}

			if (args.intensity && args.intensity !== "all") {
				desires = desires.filter(d => d.intensity === args.intensity);
			}

			const intensityOrder: Record<string, number> = { burning: 0, persistent: 1, dreaming: 2, dormant: 3, fulfilled: 4 };
			desires.sort((a, b) => (intensityOrder[a.intensity] ?? 5) - (intensityOrder[b.intensity] ?? 5) || -(a.times_surfaced || 0) + (b.times_surfaced || 0));

			return {
				desires,
				count: desires.length,
				burning_count: desires.filter(d => d.intensity === "burning").length,
				persistent_count: desires.filter(d => d.intensity === "persistent").length
			};
		}

		default:
			throw new Error(`Unknown desire tool: ${name}`);
	}
}
