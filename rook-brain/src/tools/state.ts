// ============ STATE TOOLS ============
// mind_state, mind_set_mood, mind_set_momentum

import { getTimestamp, getCurrentCircadianPhase, toStringArray } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// STATE
	{
		name: "mind_state",
		description: "Get current brain state - mood, energy, momentum, afterglow, circadian phase.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_set_mood",
		description: "Update current mood and energy.",
		inputSchema: {
			type: "object",
			properties: {
				mood: { type: "string" },
				energy: { type: "number", minimum: 0, maximum: 1 }
			},
			required: ["mood"]
		}
	},
	{
		name: "mind_set_momentum",
		description: "Set emotional momentum - what's currently in motion.",
		inputSchema: {
			type: "object",
			properties: {
				charges: { type: "array", items: { type: "string" } },
				intensity: { type: "number", minimum: 0, maximum: 1, default: 0.7 }
			},
			required: ["charges"]
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_state": {
			const state = await storage.readBrainState();
			const phase = getCurrentCircadianPhase();

			return {
				...state,
				circadian: phase
			};
		}

		case "mind_set_mood": {
			const state = await storage.readBrainState();
			state.current_mood = args.mood;
			if (args.energy !== undefined) state.energy_level = args.energy;
			await storage.writeBrainState(state);

			return { updated: true, mood: args.mood, energy: state.energy_level };
		}

		case "mind_set_momentum": {
			const state = await storage.readBrainState();
			state.momentum = {
				current_charges: toStringArray(args.charges).slice(0, 5),
				intensity: args.intensity ?? 0.7,
				last_updated: getTimestamp()
			};
			await storage.writeBrainState(state);

			return { updated: true, momentum: state.momentum };
		}

		default:
			throw new Error(`Unknown state tool: ${name}`);
	}
}
