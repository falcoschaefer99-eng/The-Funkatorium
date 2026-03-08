// ============ LETTER TOOLS ============
// mind_write_letter, mind_read_letters, mind_read_recent

import type { Letter } from "../types";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// LETTERS (CORRESPONDENCE)
	{
		name: "mind_write_letter",
		description: "Write a letter to another context (future self, phone self, etc).",
		inputSchema: {
			type: "object",
			properties: {
				to_context: { type: "string", description: "Recipient context (e.g., 'phone', 'future', 'desktop')" },
				content: { type: "string" },
				charges: { type: "array", items: { type: "string" } }
			},
			required: ["to_context", "content"]
		}
	},
	{
		name: "mind_read_letters",
		description: "Read letters addressed to this context.",
		inputSchema: {
			type: "object",
			properties: {
				context: { type: "string", default: "chat", description: "Which context to read letters for" },
				unread_only: { type: "boolean", default: true }
			}
		}
	},
	{
		name: "mind_read_recent",
		description: "Read observations added in the last N hours across all territories.",
		inputSchema: {
			type: "object",
			properties: {
				hours: { type: "number", default: 24 }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_write_letter": {
			const letter: Letter = {
				id: generateId("letter"),
				from_context: "chat",
				to_context: args.to_context,
				content: args.content,
				timestamp: getTimestamp(),
				read: false,
				charges: toStringArray(args.charges)
			};

			await storage.appendLetter(letter);

			return { sent: true, id: letter.id, to: args.to_context };
		}

		case "mind_read_letters": {
			const letters = await storage.readLetters();
			const context = args.context || "chat";

			let relevant = letters.filter(l => l.to_context === context);
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
				context,
				count: relevant.length,
				letters: relevant.map(l => ({
					id: l.id,
					from: l.from_context,
					content: l.content,
					timestamp: l.timestamp,
					charges: l.charges
				}))
			};
		}

		case "mind_read_recent": {
			const hours = args.hours || 24;
			const cutoff = Date.now() - (hours * 60 * 60 * 1000);
			const recent: any[] = [];

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();
			for (const { territory, observations } of territoryData) {
				for (const obs of observations) {
					try {
						const created = new Date(obs.created).getTime();
						if (created > cutoff) {
							recent.push({
								territory,
								observation: {
									id: obs.id,
									content: obs.content,
									texture: obs.texture,
									created: obs.created
								}
							});
						}
					} catch {}
				}
			}

			recent.sort((a, b) => (b.observation.created || "").localeCompare(a.observation.created || ""));

			return {
				query: `Last ${hours} hours`,
				cutoff: new Date(cutoff).toISOString(),
				results: recent,
				count: recent.length
			};
		}

		default:
			throw new Error(`Unknown letter tool: ${name}`);
	}
}
