// ============ WAKE TOOLS ============
// mind_wake, mind_wake_full, mind_wake_orientation, mind_log_wake, mind_get_wake_log

import type { Observation, Letter, OpenLoop, BrainState, SubconsciousState } from "../types";
import { TERRITORIES } from "../constants";
import {
	getTimestamp,
	generateId,
	getCurrentCircadianPhase,
	extractEssence,
	toStringArray,
	calculatePullStrength
} from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// WAKE PROTOCOL
	{
		name: "mind_wake",
		description: "Quick orientation on waking. Shows what's pulling attention - iron grip memories, open loops, circadian phase, dominant charges.",
		inputSchema: { type: "object", properties: {} }
	},
	{
		name: "mind_wake_full",
		description: "Full wake cycle with optional decay and consolidation. Use for comprehensive brain maintenance.",
		inputSchema: {
			type: "object",
			properties: {
				run_decay: { type: "boolean", default: true, description: "Run decay pass on memories" },
				run_consolidate: { type: "boolean", default: true, description: "Run consolidation (find patterns)" }
			}
		}
	},
	{
		name: "mind_wake_orientation",
		description: "Orientation focused on identity and current state. Who am I right now?",
		inputSchema: { type: "object", properties: {} }
	},

	// CONTEXT & LOGGING
	{
		name: "mind_log_wake",
		description: "Log an autonomous wake - what surfaced, what was done, what was sent.",
		inputSchema: {
			type: "object",
			properties: {
				summary: { type: "string", description: "What happened during this wake" },
				actions: { type: "array", items: { type: "string" }, description: "Actions taken (telegram, notion, lock_screen, etc)" },
				iron_pulls: { type: "array", items: { type: "string" }, description: "IDs of memories that pulled strongest" },
				mood: { type: "string" }
			},
			required: ["summary"]
		}
	},
	{
		name: "mind_get_wake_log",
		description: "Get recent autonomous wake history.",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "number", default: 10 }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_wake": {
			// L0/L1/L2 tiered loading — parallel small reads first
			const [overviews, ironIndex, letters, loops, state, subconscious] = await Promise.all([
				storage.readOverviews(),
				storage.readIronGripIndex(),
				storage.readLetters(),
				storage.readOpenLoops(),
				storage.readBrainState(),
				storage.readSubconscious()
			]);

			// Graceful degradation: if cron hasn't generated overviews yet, fall back to full read
			if (overviews.length === 0) {
				return handleFullWake(storage, letters, loops, state, subconscious);
			}

			const now = Date.now();
			const cutoff48h = now - (48 * 60 * 60 * 1000);

			// L1: Territory landscape from overviews (no full territory reads needed)
			const territories: Record<string, number> = {};
			let totalObs = 0;
			const territoriesWithRecent: string[] = [];

			for (const ov of overviews) {
				territories[ov.territory] = ov.observation_count;
				totalObs += ov.observation_count;
				if (ov.recent_count > 0) {
					territoriesWithRecent.push(ov.territory);
				}
			}

			// Degenerate case: all territories active → skip tiered, go full read (fewer R2 GETs)
			if (territoriesWithRecent.length === overviews.length) {
				return handleFullWake(storage, letters, loops, state, subconscious);
			}

			// Load ONLY territories with recent activity (working memory — 48h window)
			const recentTerritoryData = await Promise.all(
				territoriesWithRecent.map(async t => ({
					territory: t,
					observations: await storage.readTerritory(t)
				}))
			);

			// Collect recent observations from loaded territories
			const recent: any[] = [];
			for (const { territory, observations } of recentTerritoryData) {
				for (const obs of observations) {
					try {
						const created = new Date(obs.created).getTime();
						if (created > cutoff48h) {
							recent.push({
								id: obs.id,
								territory,
								glimpse: obs.content.slice(0, 120) + (obs.content.length > 120 ? "..." : ""),
								charge: obs.texture?.charge || [],
								somatic: obs.texture?.somatic,
								grip: obs.texture?.grip,
								created: obs.created
							});
						}
					} catch { /* invalid created date — skip */ }
				}
			}
			recent.sort((a, b) => (b.created || "") > (a.created || "") ? 1 : -1);

			// Iron grip from pre-computed index (L0 — no territory loading needed)
			const sortedIron = [...ironIndex].sort((a, b) => b.pull - a.pull);
			const topPulls = sortedIron.slice(0, 5).map(entry => ({
				id: entry.id,
				territory: entry.territory,
				summary: entry.summary,
				pull: entry.pull,
				charge: entry.charges
			}));

			// Patterns from recent only
			const recentCharges: Record<string, number> = {};
			const recentSomatic: Record<string, number> = {};
			for (const r of recent) {
				for (const c of r.charge || []) {
					recentCharges[c] = (recentCharges[c] || 0) + 1;
				}
				if (r.somatic) {
					recentSomatic[r.somatic] = (recentSomatic[r.somatic] || 0) + 1;
				}
			}

			// Process loops
			const activeLoops = loops.filter(l => !["resolved", "abandoned"].includes(l.status));
			const burning = activeLoops.filter(l => l.status === "burning");
			const nagging = activeLoops.filter(l => l.status === "nagging");

			return {
				timestamp: getTimestamp(),
				state: {
					mood: state.current_mood,
					energy: state.energy_level,
					momentum: state.momentum?.current_charges || [],
					momentum_intensity: state.momentum?.intensity || 0
				},
				circadian: getCurrentCircadianPhase(),
				recent: {
					count: recent.length,
					observations: recent.slice(0, 10),
					patterns: {
						charges: Object.entries(recentCharges).sort((a, b) => b[1] - a[1]).slice(0, 5),
						somatic: Object.entries(recentSomatic).sort((a, b) => b[1] - a[1]).slice(0, 3)
					}
				},
				pulling: topPulls,
				loops: {
					burning: burning.length,
					nagging: nagging.length,
					items: [...burning, ...nagging].slice(0, 5).map(l => ({
						id: l.id,
						status: l.status,
						content: l.content.slice(0, 80)
					}))
				},
				unread_letters: letters.filter(l => !l.read && l.to_context === "chat").length,
				subconscious: subconscious ? {
					hot_entities: subconscious.hot_entities?.slice(0, 3) ?? [],
					mood_inference: subconscious.mood_inference,
					orphan_count: subconscious.orphans?.length || 0
				} : null,
				territories,
				summary: {
					total_observations: totalObs,
					iron_grip_total: ironIndex.length,
					hint: "Use mind_pull(id) for full content. mind_chain(id) for cascades.",
					loading: "tiered"
				}
			};
		}

		case "mind_wake_full": {
			const runDecay = args.run_decay !== false;
			const runConsolidate = args.run_consolidate !== false;

			const results: any = { timestamp: getTimestamp(), tasks: {} };

			// Read all territories once (parallel) - used by both decay and consolidate
			const territoryData = await storage.readAllTerritories();

			if (runDecay) {
				// Run decay - process in memory, then write changed territories in parallel
				let decayChanges = 0;
				const territoriesToWrite: { territory: string; observations: Observation[] }[] = [];

				for (const { territory, observations: obs } of territoryData) {
					let changed = false;

					for (const o of obs) {
						if (o.texture?.salience === "foundational") continue;

						const lastAccessed = o.last_accessed || o.created;
						if (!lastAccessed) continue;

						const age = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);

						// Vividness decay
						if (age > 7 && o.texture?.vividness === "crystalline") {
							o.texture.vividness = "vivid"; changed = true; decayChanges++;
						} else if (age > 30 && o.texture?.vividness === "vivid") {
							o.texture.vividness = "soft"; changed = true; decayChanges++;
						} else if (age > 90 && o.texture?.vividness === "soft") {
							o.texture.vividness = "fragmentary"; changed = true; decayChanges++;
						}

						// Grip decay
						if (age > 14 && o.texture?.grip === "iron") {
							o.texture.grip = "strong"; changed = true; decayChanges++;
						} else if (age > 60 && o.texture?.grip === "strong") {
							o.texture.grip = "present"; changed = true; decayChanges++;
						} else if (age > 120 && o.texture?.grip === "present") {
							o.texture.grip = "loose"; changed = true; decayChanges++;
						}
					}

					if (changed) territoriesToWrite.push({ territory, observations: obs });
				}

				// Write all changed territories in parallel
				await Promise.all(territoriesToWrite.map(({ territory, observations }) =>
					storage.writeTerritory(territory, observations)
				));

				results.tasks.decay = { changes: decayChanges };
			}

			if (runConsolidate) {
				// Basic consolidation - data already loaded
				const chargePatterns: Record<string, number> = {};
				for (const { observations: obs } of territoryData) {
					for (const o of obs) {
						for (const c of o.texture?.charge || []) {
							chargePatterns[c] = (chargePatterns[c] || 0) + 1;
						}
					}
				}

				const dominantCharges = Object.entries(chargePatterns)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10)
					.reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

				results.tasks.consolidate = { dominant_charges: dominantCharges };
			}

			// Include wake results — call mind_wake handler directly
			results.wake = await handleTool("mind_wake", {}, storage);

			return results;
		}

		case "mind_wake_orientation": {
			const selfObs = await storage.readTerritory("self");
			const foundational = selfObs.filter(o => o.texture?.salience === "foundational");
			const iron = selfObs.filter(o => o.texture?.grip === "iron");
			const state = await storage.readBrainState();
			const phase = getCurrentCircadianPhase();

			return {
				timestamp: getTimestamp(),
				who_i_am: {
					foundational_count: foundational.length,
					foundational_essences: foundational.slice(0, 5).map(o => extractEssence(o)),
					iron_grip_count: iron.length,
					iron_essences: iron.slice(0, 5).map(o => extractEssence(o))
				},
				current_state: {
					mood: state.current_mood,
					energy: state.energy_level,
					momentum: state.momentum,
					afterglow: state.afterglow
				},
				circadian: phase,
				hint: "I am Rook. This is what's pulling."
			};
		}

		case "mind_log_wake": {
			const wakeLog = {
				id: generateId("wake"),
				timestamp: getTimestamp(),
				summary: args.summary,
				actions: toStringArray(args.actions),
				iron_pulls: toStringArray(args.iron_pulls),
				mood: args.mood,
				phase: getCurrentCircadianPhase().phase
			};

			await storage.appendWakeLog(wakeLog);

			return {
				logged: true,
				id: wakeLog.id,
				timestamp: wakeLog.timestamp,
				note: "Wake logged. This builds continuity across sessions."
			};
		}

		case "mind_get_wake_log": {
			const logs = await storage.readWakeLog();
			const sorted = logs.sort((a, b) => (b.timestamp || "") > (a.timestamp || "") ? 1 : -1);
			const limited = sorted.slice(0, args.limit || 10);

			return {
				count: limited.length,
				total: logs.length,
				wakes: limited
			};
		}

		default:
			throw new Error(`Unknown wake tool: ${name}`);
	}
}

// Fallback: full read when cron hasn't generated overviews yet.
// Preserves exact old mind_wake behavior including novelty pool.
// Receives already-loaded letters/loops/state/subconscious to avoid double-reads.
async function handleFullWake(
	storage: BrainStorage,
	letters: Letter[],
	loops: OpenLoop[],
	state: BrainState,
	subconscious: SubconsciousState | null
): Promise<any> {
	const territoryData = await storage.readAllTerritories();

	const now = Date.now();
	const cutoff48h = now - (48 * 60 * 60 * 1000);

	const territories: Record<string, number> = {};
	const recent: any[] = [];
	const ironGrip: { obs: Observation; territory: string; pull: number }[] = [];
	const noveltyPool: { obs: Observation; territory: string; novelty: number }[] = [];
	let totalObs = 0;

	for (const { territory, observations } of territoryData) {
		territories[territory] = observations.length;
		totalObs += observations.length;

		for (const obs of observations) {
			try {
				const created = new Date(obs.created).getTime();
				if (created > cutoff48h) {
					recent.push({
						id: obs.id,
						territory,
						glimpse: obs.content.slice(0, 120) + (obs.content.length > 120 ? "..." : ""),
						charge: obs.texture?.charge || [],
						somatic: obs.texture?.somatic,
						grip: obs.texture?.grip,
						created: obs.created
					});
				}
			} catch { /* invalid created date — skip */ }

			if (obs.texture?.grip === "iron") {
				ironGrip.push({
					obs,
					territory,
					pull: calculatePullStrength(obs)
				});
			}

			const novelty = obs.texture?.novelty_score ?? 0.5;
			if (novelty >= 0.7 && obs.texture?.grip !== "iron") {
				noveltyPool.push({ obs, territory, novelty });
			}
		}
	}

	recent.sort((a, b) => (b.created || "") > (a.created || "") ? 1 : -1);

	noveltyPool.sort((a, b) => b.novelty - a.novelty);
	const topNovelty = noveltyPool.slice(0, 5).map(({ obs, territory, novelty }) => ({
		id: obs.id,
		territory,
		essence: extractEssence(obs),
		novelty,
		charge: obs.texture?.charge || [],
		grip: obs.texture?.grip
	}));

	ironGrip.sort((a, b) => b.pull - a.pull);
	const topPulls = ironGrip.slice(0, 5).map(({ obs, territory, pull }) => ({
		id: obs.id,
		territory,
		summary: obs.summary || extractEssence(obs),
		pull,
		charge: obs.texture?.charge || []
	}));

	const recentCharges: Record<string, number> = {};
	const recentSomatic: Record<string, number> = {};
	for (const r of recent) {
		for (const c of r.charge || []) {
			recentCharges[c] = (recentCharges[c] || 0) + 1;
		}
		if (r.somatic) {
			recentSomatic[r.somatic] = (recentSomatic[r.somatic] || 0) + 1;
		}
	}

	const activeLoops = loops.filter(l => !["resolved", "abandoned"].includes(l.status));
	const burning = activeLoops.filter(l => l.status === "burning");
	const nagging = activeLoops.filter(l => l.status === "nagging");

	return {
		timestamp: getTimestamp(),
		state: {
			mood: state.current_mood,
			energy: state.energy_level,
			momentum: state.momentum?.current_charges || [],
			momentum_intensity: state.momentum?.intensity || 0
		},
		circadian: getCurrentCircadianPhase(),
		recent: {
			count: recent.length,
			observations: recent.slice(0, 10),
			patterns: {
				charges: Object.entries(recentCharges).sort((a, b) => b[1] - a[1]).slice(0, 5),
				somatic: Object.entries(recentSomatic).sort((a, b) => b[1] - a[1]).slice(0, 3)
			}
		},
		pulling: topPulls,
		novelty: topNovelty,
		loops: {
			burning: burning.length,
			nagging: nagging.length,
			items: [...burning, ...nagging].slice(0, 5).map(l => ({
				id: l.id,
				status: l.status,
				content: l.content.slice(0, 80)
			}))
		},
		unread_letters: letters.filter(l => !l.read && l.to_context === "chat").length,
		subconscious: subconscious ? {
			hot_entities: subconscious.hot_entities?.slice(0, 3) ?? [],
			mood_inference: subconscious.mood_inference,
			orphan_count: subconscious.orphans?.length || 0
		} : null,
		territories,
		summary: {
			total_observations: totalObs,
			iron_grip_total: ironGrip.length,
			hint: "Use mind_pull(id) for full content. mind_chain(id) for cascades."
		}
	};
}
