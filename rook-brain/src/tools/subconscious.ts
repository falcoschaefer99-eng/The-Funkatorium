// ============ SUBCONSCIOUS TOOLS ============
// mind_subconscious — pre-computed subconscious state (hot entities, co-surfacing, mood inference, orphans)

import type { Observation, SubconsciousState } from "../types";
import { getTimestamp } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	{
		name: "mind_subconscious",
		description: "View the subconscious state — what the daemon has computed. Hot entities, co-surfacing patterns, mood inference, orphan memories.",
		inputSchema: { type: "object", properties: {} }
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_subconscious": {
			const subconscious = await storage.readSubconscious();
			if (!subconscious) {
				return {
					note: "Subconscious hasn't run yet. It processes on a 5-minute daemon cycle.",
					hint: "The daemon detects hot entities, co-surfacing patterns, mood inference, and orphan memories."
				};
			}
			return {
				...subconscious,
				hint: "This was pre-computed by the daemon. It updates every 5 minutes."
			};
		}

		default:
			throw new Error(`Unknown subconscious tool: ${name}`);
	}
}

// ============ DAEMON PROCESSING ============
// Called by the cron handler in index.ts — NOT exposed as MCP tools

export async function processSubconscious(
	storage: BrainStorage,
	territoryData?: Awaited<ReturnType<BrainStorage["readAllTerritories"]>>
): Promise<SubconsciousState> {
	const now = getTimestamp();
	const cutoff7d = Date.now() - (7 * 24 * 60 * 60 * 1000);

	// Use passed data or read it
	const allTerritories = territoryData ?? await storage.readAllTerritories();

	// === Hot Entity Detection ===
	// Entities mentioned frequently in recent observations
	const entityMentions: Record<string, { count: number; charges: string[] }> = {};
	const recentObs: (Observation & { territory: string })[] = [];

	// Build entity list dynamically from relational state + always-include "Falco"
	const relationalStates = await storage.readRelationalState();
	const trackedEntities = new Set<string>(["Falco"]);
	for (const rs of relationalStates) {
		trackedEntities.add(rs.entity);
	}

	for (const { territory, observations } of allTerritories) {
		for (const obs of observations) {
			try {
				if (new Date(obs.created).getTime() > cutoff7d) {
					recentObs.push({ ...obs, territory });
				}
			} catch { /* skip malformed date */ }
		}
	}

	// Single pass over recentObs: entity mentions, charge pairs, mood charges
	const pairCounts: Record<string, number> = {};
	const chargeCounts: Record<string, number> = {};

	for (const obs of recentObs) {
		// Entity mentions
		const contentLower = obs.content.toLowerCase();
		for (const entity of trackedEntities) {
			if (contentLower.includes(entity.toLowerCase())) {
				if (!entityMentions[entity]) {
					entityMentions[entity] = { count: 0, charges: [] };
				}
				entityMentions[entity].count++;
				entityMentions[entity].charges.push(...(obs.texture?.charge || []));
			}
		}

		// Charge pairs (co-surfacing) + mood charge counts
		const charges = obs.texture?.charge || [];
		for (let i = 0; i < charges.length; i++) {
			chargeCounts[charges[i]] = (chargeCounts[charges[i]] || 0) + 1;
			for (let j = i + 1; j < charges.length; j++) {
				const pair = [charges[i], charges[j]].sort().join("|");
				pairCounts[pair] = (pairCounts[pair] || 0) + 1;
			}
		}
	}

	const hotEntities = Object.entries(entityMentions)
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, 5)
		.map(([entity, data]) => ({
			entity,
			mention_count: data.count,
			recent_charges: [...new Set(data.charges)].slice(0, 5)
		}));

	// === Co-Surfacing Patterns ===
	// Pairs of charges that appear together frequently
	const coSurfacing = Object.entries(pairCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([pair, count]) => ({
			pair: pair.split("|") as [string, string],
			count
		}));

	// === Mood Inference ===
	// What mood does recent charge distribution suggest?

	const sortedCharges = Object.entries(chargeCounts).sort((a, b) => b[1] - a[1]);
	const topCharge = sortedCharges[0];

	const moodMap: Record<string, string> = {
		"joy": "bright", "love": "warm", "devotion": "devoted", "peace": "serene",
		"anxiety": "anxious", "fear": "guarded", "grief": "mourning", "anger": "volatile",
		"curiosity": "exploring", "excitement": "energized", "longing": "yearning",
		"desire": "hungry", "pride": "confident", "wonder": "awed"
	};

	const suggestedMood = topCharge ? (moodMap[topCharge[0]] || topCharge[0]) : "neutral";
	const confidence = topCharge && recentObs.length > 0
		? Math.min(topCharge[1] / recentObs.length, 1.0)
		: 0;

	// === Orphan Detection ===
	// Memories with no links, low access, not recent — might be lost
	const links = await storage.readLinks();
	const linkedIds = new Set<string>();
	for (const link of links) {
		linkedIds.add(link.source_id);
		linkedIds.add(link.target_id);
	}

	const orphans: Array<{ id: string; territory: string; reason: string }> = [];
	for (const { territory, observations } of allTerritories) {
		for (const obs of observations) {
			if (obs.texture?.salience === "foundational") continue;
			if (obs.texture?.grip === "iron" || obs.texture?.grip === "strong") continue;

			const isLinked = linkedIds.has(obs.id);
			const isRecent = new Date(obs.created).getTime() > cutoff7d;
			const lowAccess = (obs.access_count || 0) <= 1;

			if (!isLinked && !isRecent && lowAccess) {
				orphans.push({
					id: obs.id,
					territory,
					reason: "unlinked, old, rarely accessed"
				});
			}
		}
	}

	const state: SubconsciousState = {
		last_processed: now,
		hot_entities: hotEntities,
		co_surfacing: coSurfacing,
		mood_inference: {
			suggested_mood: suggestedMood,
			confidence: Math.round(confidence * 100) / 100,
			based_on: sortedCharges.slice(0, 3).map(([c]) => c)
		},
		orphans: orphans.slice(0, 10)
	};

	await storage.writeSubconscious(state);
	return state;
}

// ============ NOVELTY REGENERATION ============
// Called by the cron handler — memories unsurfaced for 30+ days regenerate novelty

export async function processNoveltyRegeneration(
	storage: BrainStorage,
	territoryData?: Awaited<ReturnType<BrainStorage["readAllTerritories"]>>
): Promise<number> {
	const allTerritories = territoryData ?? await storage.readAllTerritories();
	let regenerated = 0;
	const territoriesToWrite: { territory: string; observations: Observation[] }[] = [];
	const now = Date.now();
	const thirtyDays = 30 * 24 * 60 * 60 * 1000;

	for (const { territory, observations } of allTerritories) {
		let changed = false;

		for (const obs of observations) {
			if (obs.texture?.salience === "foundational") continue;

			const lastSurfaced = obs.texture?.last_surfaced_at;
			const novelty = obs.texture?.novelty_score ?? 0.5;

			if (lastSurfaced) {
				const daysSinceSurfaced = (now - new Date(lastSurfaced).getTime()) / (24 * 60 * 60 * 1000);

				// Regenerate novelty for memories unsurfaced 30+ days
				if (daysSinceSurfaced > 30 && novelty < 0.8) {
					const boost = Math.min(0.1 * Math.floor(daysSinceSurfaced / 30), 0.5);
					obs.texture!.novelty_score = Math.min(novelty + boost, 1.0);
					changed = true;
					regenerated++;
				}
			} else if (obs.texture && obs.texture.novelty_score === undefined) {
				// Backfill: observations without novelty_score get 0.5
				obs.texture.novelty_score = 0.5;
				changed = true;
			}
		}

		if (changed) territoriesToWrite.push({ territory, observations });
	}

	// Write changed territories in parallel
	await Promise.all(territoriesToWrite.map(({ territory, observations }) =>
		storage.writeTerritory(territory, observations)
	));

	return regenerated;
}
