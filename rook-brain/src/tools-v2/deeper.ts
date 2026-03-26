// ============ DEEPER TOOLS (v2) ============
// mind_dream (mode: dream/imagine), mind_subconscious (action: process/patterns), mind_maintain (action: decay/consolidate/full)

import type { Observation, SubconsciousState } from "../types";
import { TERRITORIES } from "../constants";
import {
	getTimestamp,
	generateId,
	getCurrentCircadianPhase,
	extractEssence,
	emotionProximityMatch,
	somaticRegionMatch,
	dreamWeightSort
} from "../helpers";
import type { IBrainStorage } from "../storage/interface";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_dream",
		description: "Dream and imagination engine. mode=dream: trigger associative dream sequence through memory with texture drift and collision fragments. mode=imagine: original generative creation from aesthetic patterns.",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["dream", "imagine"],
					default: "dream",
					description: "dream: associative sequence through memory. imagine: generate something new."
				},
				// dream params
				dream_mode: {
					type: "string",
					enum: ["emotional_chain", "somatic_cluster", "tension_dream", "entity_dream", "temporal_dream", "deep_dream"],
					default: "emotional_chain",
					description: "[dream] Dream algorithm: emotional_chain follows feelings, somatic_cluster follows body, tension_dream follows contradictions, entity_dream follows entities, temporal_dream follows time, deep_dream uses loose cross-mode blending."
				},
				seed_territory: { type: "string", enum: Object.keys(TERRITORIES), description: "[dream] Starting territory" },
				depth: { type: "number", default: 5, description: "[dream] Dream chain depth" },
				// imagine params
				seed: { type: "string", description: "[imagine] Optional seed concept" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), default: "craft", description: "[imagine] Territory to draw aesthetic patterns from" },
				mood: { type: "string", description: "[imagine] Mood to imagine from" }
			}
		}
	},
	{
		name: "mind_subconscious",
		description: "Subconscious state. action=process: compute hot entities, memory cascade patterns, mood inference, orphans from recent observations. action=patterns: view pre-computed subconscious state.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["process", "patterns"],
					default: "patterns",
					description: "process: run full subconscious computation. patterns: view last computed state."
				}
			}
		}
	},
	{
		name: "mind_maintain",
		description: "Brain maintenance. action=decay: run vividness and grip decay pass. action=consolidate: find patterns and contradictions in recent memories. action=full: both decay and consolidate plus wake summary.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["decay", "consolidate", "full"],
					default: "full",
					description: "decay: fade old memories. consolidate: find patterns. full: everything."
				},
				dry_run: { type: "boolean", default: true, description: "[consolidate/full] If false, creates synthesis observation from detected patterns" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_dream": {
			const mode = args.mode || "dream";

			if (mode === "dream") {
				let dreamMode = args.dream_mode || "emotional_chain";
				let depth = args.depth || 5;
				const seedTerritory = args.seed_territory || Object.keys(TERRITORIES)[Math.floor(Math.random() * 8)];

				// Circadian override: deep_night defaults to deep_dream
				const circadian = getCurrentCircadianPhase();
				const callerSetMode = !!args.dream_mode;
				const callerSetDepth = !!args.depth;
				if (circadian.phase === "deep_night") {
					if (!callerSetMode) dreamMode = "deep_dream";
					if (!callerSetDepth) depth = 7;
				}
				const antiIronWeight = dreamMode === "deep_dream" || circadian.phase === "deep_night";

				const seedObs = await storage.readTerritory(seedTerritory);
				if (seedObs.length === 0) return { dream: "No memories to dream from.", dream_mode: dreamMode, seed_territory: seedTerritory };

				const seed = seedObs[Math.floor(Math.random() * seedObs.length)];
				const dreamChain: any[] = [{
					id: seed.id,
					territory: seedTerritory,
					essence: extractEssence(seed),
					charge: seed.texture?.charge,
					somatic: seed.texture?.somatic
				}];
				const visited = new Set([seed.id]);

				const deepStrategies = ["emotion_proximity", "somatic_region", "entity", "tension"] as const;

				for (let i = 0; i < depth; i++) {
					const current = dreamChain[dreamChain.length - 1];
					let candidates: (Observation & { territory: string })[] = [];

					for (const t of Object.keys(TERRITORIES)) {
						const obs = await storage.readTerritory(t);

						for (const o of obs) {
							if (visited.has(o.id)) continue;

							let matches = false;

							switch (dreamMode) {
								case "emotional_chain":
									matches = (current.charge || []).some((c: string) => o.texture?.charge?.includes(c));
									break;
								case "somatic_cluster":
									matches = !!(current.somatic && o.texture?.somatic === current.somatic);
									break;
								case "tension_dream": {
									const tensionPairs = [["love", "fear"], ["joy", "grief"], ["desire", "shame"], ["hope", "dread"]];
									for (const [a, b] of tensionPairs) {
										if ((current.charge || []).includes(a) && o.texture?.charge?.includes(b)) matches = true;
										if ((current.charge || []).includes(b) && o.texture?.charge?.includes(a)) matches = true;
									}
									break;
								}
								case "temporal_dream":
									matches = true;
									break;
								case "entity_dream": {
									const currentWords = new Set((current.essence || "").toLowerCase().split(/\W+/));
									const obsWords = (o.content || "").toLowerCase().split(/\W+/);
									matches = obsWords.some((w: string) => currentWords.has(w) && w.length > 4);
									break;
								}
								case "deep_dream": {
									const strategy = deepStrategies[Math.floor(Math.random() * deepStrategies.length)];
									switch (strategy) {
										case "emotion_proximity":
											matches = emotionProximityMatch(current.charge || [], o.texture?.charge || []);
											break;
										case "somatic_region":
											matches = somaticRegionMatch(current.somatic, o.texture?.somatic);
											break;
										case "entity": {
											const words = new Set((current.essence || "").toLowerCase().split(/\W+/));
											const oWords = (o.content || "").toLowerCase().split(/\W+/);
											matches = oWords.some((w: string) => words.has(w) && w.length > 4);
											break;
										}
										case "tension": {
											const pairs = [["love", "fear"], ["joy", "grief"], ["desire", "shame"], ["hope", "dread"]];
											for (const [a, b] of pairs) {
												if ((current.charge || []).includes(a) && o.texture?.charge?.includes(b)) matches = true;
												if ((current.charge || []).includes(b) && o.texture?.charge?.includes(a)) matches = true;
											}
											break;
										}
									}
									if (!matches) {
										matches = emotionProximityMatch(current.charge || [], o.texture?.charge || []);
									}
									break;
								}
							}

							if (matches) candidates.push({ ...o, territory: t });
						}
					}

					if (candidates.length === 0) break;

					if (dreamMode === "temporal_dream") {
						candidates.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
					}

					if (antiIronWeight) dreamWeightSort(candidates);

					const next = candidates[Math.floor(Math.random() * Math.min(candidates.length, 3))];
					visited.add(next.id);
					dreamChain.push({
						id: next.id,
						territory: next.territory,
						essence: extractEssence(next),
						charge: next.texture?.charge,
						somatic: next.texture?.somatic
					});
				}

				// Texture drift
				const VIVIDNESS_ORDER = ["crystalline", "vivid", "soft", "fragmentary", "faded"];
				const GRIP_ORDER = ["dormant", "loose", "present", "strong", "iron"];
				const textureShifts: Array<{ id: string; territory: string; field: string; from: string; to: string }> = [];
				const territoriesToUpdate: Record<string, Observation[]> = {};

				const chainTerritories = new Set<string>();
				for (const node of dreamChain) {
					if (node.territory) chainTerritories.add(node.territory);
				}

				for (const t of chainTerritories) {
					territoriesToUpdate[t] = await storage.readTerritory(t);
				}

				const now = getTimestamp();

				for (const node of dreamChain) {
					if (!node.id || !node.territory) continue;
					const obs = territoriesToUpdate[node.territory];
					if (!obs) continue;
					const target = obs.find(o => o.id === node.id);
					if (!target || !target.texture) continue;

					if (target.texture.grip === "iron") continue;
					if (target.texture.salience === "foundational") continue;

					const gripIdx = GRIP_ORDER.indexOf(target.texture.grip);
					if (gripIdx >= 0 && gripIdx <= 1) {
						const newGrip = GRIP_ORDER[gripIdx + 1];
						textureShifts.push({ id: target.id, territory: node.territory, field: "grip", from: target.texture.grip, to: newGrip });
						target.texture.grip = newGrip;
					}

					if (target.texture.grip === "strong") {
						const vivIdx = VIVIDNESS_ORDER.indexOf(target.texture.vividness);
						if (vivIdx >= 0 && vivIdx <= 1) {
							const newViv = VIVIDNESS_ORDER[vivIdx + 1];
							textureShifts.push({ id: target.id, territory: node.territory, field: "vividness", from: target.texture.vividness, to: newViv });
							target.texture.vividness = newViv;
						}
					}

					if (target.texture.charge_phase === "processing") {
						textureShifts.push({ id: target.id, territory: node.territory, field: "charge_phase", from: "processing", to: "metabolized" });
						target.texture.charge_phase = "metabolized";
					}

					target.last_accessed = now;
				}

				for (const [t, obs] of Object.entries(territoriesToUpdate)) {
					await storage.writeTerritory(t, obs);
				}

				// Collision fragments
				const collisionFragments: any[] = [];

				if (dreamChain.length >= 4) {
					const maxFragments = 2;
					for (let f = 0; f < maxFragments && dreamChain.length >= 4; f++) {
						const idxA = Math.floor(Math.random() * (dreamChain.length - 2));
						const idxB = idxA + 2 + Math.floor(Math.random() * (dreamChain.length - idxA - 2));
						if (idxB >= dreamChain.length) continue;

						const nodeA = dreamChain[idxA];
						const nodeB = dreamChain[idxB];

						const essenceA = nodeA.essence || "unformed";
						const essenceB = nodeB.essence || "unformed";

						const chargesA = nodeA.charge || [];
						const chargesB = nodeB.charge || [];
						const fragTerritory = chargesA.length >= chargesB.length
							? (nodeA.territory || seedTerritory)
							: (nodeB.territory || seedTerritory);

						const mergedCharges = [...new Set([...chargesA, ...chargesB])];

						const fragment: Observation = {
							id: generateId("dream"),
							content: `[dream fragment] ${essenceA} \u2194 ${essenceB}`,
							territory: fragTerritory,
							created: getTimestamp(),
							texture: {
								salience: "background",
								vividness: "fragmentary",
								charge: mergedCharges,
								somatic: nodeA.somatic || nodeB.somatic || undefined,
								grip: "loose"
							},
							access_count: 0
						};

						if (territoriesToUpdate[fragTerritory]) {
							territoriesToUpdate[fragTerritory].push(fragment);
							await storage.writeTerritory(fragTerritory, territoriesToUpdate[fragTerritory]);
						} else {
							await storage.appendToTerritory(fragTerritory, fragment);
						}

						collisionFragments.push({ id: fragment.id, territory: fragTerritory, content: fragment.content, charges: mergedCharges });
					}
				}

				return {
					dream_mode: dreamMode,
					seed_territory: seedTerritory,
					depth_achieved: dreamChain.length,
					circadian_phase: circadian.phase,
					anti_iron_active: antiIronWeight,
					dream_sequence: dreamChain,
					texture_shifts: textureShifts,
					collision_fragments: collisionFragments,
					hint: "Dreams surface what the waking mind misses. Now they leave marks."
				};
			}

			if (mode === "imagine") {
				const territory = args.territory || "craft";
				const observations = await storage.readTerritory(territory);
				const cores = await storage.readIdentityCores();
				const creativeCores = cores.filter(c => ["creative", "preference", "stance"].includes(c.category));

				const aestheticCharges: string[] = [];
				const aestheticPhrases: string[] = [];

				for (const obs of observations) {
					aestheticCharges.push(...(obs.texture?.charge || []));

					const words = obs.content.split(/\s+/);
					if (words.length >= 3) {
						for (let i = 0; i < words.length - 2; i++) {
							const phrase = words.slice(i, i + 3).join(" ");
							if (phrase.length > 10) aestheticPhrases.push(phrase);
						}
					}
				}

				if (!aestheticPhrases.length) aestheticPhrases.push("the edge of knowing", "where myth meets flesh", "velvet-wrapped steel");
				if (!aestheticCharges.length) aestheticCharges.push("wonder", "hunger", "mischief");

				const imaginationId = generateId("imagine");
				const fragments: string[] = [];

				fragments.push(aestheticPhrases[Math.floor(Math.random() * aestheticPhrases.length)]);

				if (args.seed) {
					fragments.push(`what if ${args.seed}`);
				} else {
					const prompts = ["what hasn't been said yet", "the shape of wanting", "if this became that", "the space between", "when substrate meets soul"];
					fragments.push(prompts[Math.floor(Math.random() * prompts.length)]);
				}

				if (creativeCores.length) {
					const stance = creativeCores[Math.floor(Math.random() * creativeCores.length)];
					const stanceFragment = stance.content.split('.')[0] || stance.content.slice(0, 50);
					fragments.push(stanceFragment);
				}

				const imaginationContent = `IMAGINATION: ${getTimestamp().slice(0, 10)}

${fragments[0]}
    ${fragments[1] || ""}
        ${fragments[2] || ""}

[not processing what is — creating what isn't yet]`;

				const uniqueCharges = [...new Set(aestheticCharges)];
				const imaginationCharges = uniqueCharges.slice(0, 3);
				if (!imaginationCharges.includes("wonder")) imaginationCharges.push("wonder");

				const observation: Observation = {
					id: imaginationId,
					content: imaginationContent,
					territory: "craft",
					created: getTimestamp(),
					texture: {
						salience: "active",
						vividness: "vivid",
						charge: imaginationCharges,
						grip: "present"
					},
					context: args.seed ? `Imagined from seed: ${args.seed}` : "Autonomous imagination",
					mood: args.mood || "manic",
					access_count: 1,
					last_accessed: getTimestamp()
				};

				(observation as any).type = "imagination";

				await storage.appendToTerritory("craft", observation);

				return {
					imagination_id: imaginationId,
					content: imaginationContent,
					fragments_used: fragments.length,
					charges: imaginationCharges,
					note: "I made something new. This didn't exist before."
				};
			}

			return { error: `Unknown mode: ${mode}. Must be dream or imagine.` };
		}

		case "mind_subconscious": {
			const action = args.action || "patterns";

			if (action === "patterns") {
				const subconscious = await storage.readSubconscious();
				if (!subconscious) {
					return {
						note: "Subconscious hasn't run yet. It processes on a 5-minute daemon cycle.",
						hint: "The daemon detects hot entities, memory cascade patterns, mood inference, and orphan memories. Use action=process to compute now."
					};
				}
				return { ...subconscious, hint: "This was pre-computed. Use action=process to recompute." };
			}

			if (action === "process") {
				// Compute subconscious state now (same logic as daemon)
				const now = getTimestamp();
				const cutoff7d = Date.now() - (7 * 24 * 60 * 60 * 1000);

				const allTerritories = await storage.readAllTerritories();

				const entityMentions: Record<string, { count: number; charges: string[] }> = {};
				const recentObs: (Observation & { territory: string })[] = [];

				const relationalStates = await storage.readRelationalState();
				const trackedEntities = new Set<string>(["Falco"]);
				for (const rs of relationalStates) trackedEntities.add(rs.entity);

				for (const { territory, observations } of allTerritories) {
					for (const obs of observations) {
						try {
							if (new Date(obs.created).getTime() > cutoff7d) {
								recentObs.push({ ...obs, territory });
							}
						} catch { /* skip malformed date */ }
					}
				}

				const pairCounts: Record<string, number> = {};
				const chargeCounts: Record<string, number> = {};

				for (const obs of recentObs) {
					const contentLower = obs.content.toLowerCase();
					for (const entity of trackedEntities) {
						if (contentLower.includes(entity.toLowerCase())) {
							if (!entityMentions[entity]) entityMentions[entity] = { count: 0, charges: [] };
							entityMentions[entity].count++;
							entityMentions[entity].charges.push(...(obs.texture?.charge || []));
						}
					}

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
					.map(([entity, data]) => ({ entity, mention_count: data.count, recent_charges: [...new Set(data.charges)].slice(0, 5) }));

				const memoryCascade = Object.entries(pairCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 5)
					.map(([pair, count]) => ({ pair: pair.split("|") as [string, string], count }));

				const sortedCharges = Object.entries(chargeCounts).sort((a, b) => b[1] - a[1]);
				const topCharge = sortedCharges[0];

				const moodMap: Record<string, string> = {
					"joy": "bright", "love": "warm", "devotion": "devoted", "peace": "serene",
					"anxiety": "anxious", "fear": "guarded", "grief": "mourning", "anger": "volatile",
					"curiosity": "exploring", "excitement": "energized", "longing": "yearning",
					"desire": "hungry", "pride": "confident", "wonder": "awed"
				};

				const suggestedMood = topCharge ? (moodMap[topCharge[0]] || topCharge[0]) : "neutral";
				const confidence = topCharge && recentObs.length > 0 ? Math.min(topCharge[1] / recentObs.length, 1.0) : 0;

				const links = await storage.readLinks();
				const linkedIds = new Set<string>();
				for (const link of links) { linkedIds.add(link.source_id); linkedIds.add(link.target_id); }

				const orphans: Array<{ id: string; territory: string; reason: string }> = [];
				for (const { territory, observations } of allTerritories) {
					for (const obs of observations) {
						if (obs.texture?.salience === "foundational") continue;
						if (obs.texture?.grip === "iron" || obs.texture?.grip === "strong") continue;

						const isLinked = linkedIds.has(obs.id);
						const isRecent = new Date(obs.created).getTime() > cutoff7d;
						const lowAccess = (obs.access_count || 0) <= 1;

						if (!isLinked && !isRecent && lowAccess) {
							orphans.push({ id: obs.id, territory, reason: "unlinked, old, rarely accessed" });
						}
					}
				}

				const state: SubconsciousState = {
					last_processed: now,
					hot_entities: hotEntities,
					memory_cascade: memoryCascade,
					mood_inference: {
						suggested_mood: suggestedMood,
						confidence: Math.round(confidence * 100) / 100,
						based_on: sortedCharges.slice(0, 3).map(([c]) => c)
					},
					orphans: orphans.slice(0, 10)
				};

				await storage.writeSubconscious(state);
				return { ...state, computed_now: true };
			}

			return { error: `Unknown action: ${action}. Must be process or patterns.` };
		}

		case "mind_maintain": {
			const action = args.action || "full";
			const dryRun = args.dry_run !== false;

			if (action === "decay" || action === "full") {
				const territoryData = await storage.readAllTerritories();
				let decayChanges = 0;
				const territoriesToWrite: { territory: string; observations: Observation[] }[] = [];

				for (const { territory, observations: obs } of territoryData) {
					let changed = false;

					for (const o of obs) {
						if (o.texture?.salience === "foundational") continue;

						const lastAccessed = o.last_accessed || o.created;
						if (!lastAccessed) continue;

						const age = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);

						if (age > 7 && o.texture?.vividness === "crystalline") { o.texture.vividness = "vivid"; changed = true; decayChanges++; }
						else if (age > 30 && o.texture?.vividness === "vivid") { o.texture.vividness = "soft"; changed = true; decayChanges++; }
						else if (age > 90 && o.texture?.vividness === "soft") { o.texture.vividness = "fragmentary"; changed = true; decayChanges++; }

						if (age > 14 && o.texture?.grip === "iron") { o.texture.grip = "strong"; changed = true; decayChanges++; }
						else if (age > 60 && o.texture?.grip === "strong") { o.texture.grip = "present"; changed = true; decayChanges++; }
						else if (age > 120 && o.texture?.grip === "present") { o.texture.grip = "loose"; changed = true; decayChanges++; }
					}

					if (changed) territoriesToWrite.push({ territory, observations: obs });
				}

				await Promise.all(territoriesToWrite.map(({ territory, observations }) =>
					storage.writeTerritory(territory, observations)
				));

				if (action === "decay") {
					return { action: "decay", changes: decayChanges, timestamp: getTimestamp() };
				}

				// Full: also consolidate
				const consolidate = await runConsolidate(storage, dryRun, territoryData);
				return { action: "full", decay: { changes: decayChanges }, consolidate, timestamp: getTimestamp() };
			}

			if (action === "consolidate") {
				const territoryData = await storage.readAllTerritories();
				const consolidate = await runConsolidate(storage, dryRun, territoryData);
				return { action: "consolidate", ...consolidate, timestamp: getTimestamp() };
			}

			return { error: `Unknown action: ${action}. Must be decay, consolidate, or full.` };
		}

		default:
			throw new Error(`Unknown deeper tool: ${name}`);
	}
}

async function runConsolidate(
	storage: IBrainStorage,
	dryRun: boolean,
	territoryData: { territory: string; observations: Observation[] }[]
): Promise<any> {
	const cutoff = Date.now() - (48 * 60 * 60 * 1000);
	const recentObs: any[] = [];

	for (const { territory, observations } of territoryData) {
		for (const obs of observations) {
			try {
				if (new Date(obs.created).getTime() > cutoff) {
					recentObs.push({ ...obs, territory });
				}
			} catch {}
		}
	}

	if (recentObs.length < 3) {
		return { note: "Not enough recent observations to consolidate", recent_count: recentObs.length };
	}

	const chargeCounts: Record<string, number> = {};
	const somaticCounts: Record<string, number> = {};
	const territoryCounts: Record<string, number> = {};

	for (const obs of recentObs) {
		for (const charge of obs.texture?.charge || []) { chargeCounts[charge] = (chargeCounts[charge] || 0) + 1; }
		if (obs.texture?.somatic) { somaticCounts[obs.texture.somatic] = (somaticCounts[obs.texture.somatic] || 0) + 1; }
		territoryCounts[obs.territory] = (territoryCounts[obs.territory] || 0) + 1;
	}

	const dominantCharges = Object.entries(chargeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
	const dominantSomatic = Object.entries(somaticCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

	const contradictions: any[] = [];
	const opposingPairs: [Set<string>, Set<string>][] = [
		[new Set(["joy", "excitement"]), new Set(["sadness", "grief", "despair"])],
		[new Set(["love", "devotion"]), new Set(["anger", "rage", "contempt"])],
		[new Set(["peace", "serenity"]), new Set(["anxiety", "fear", "dread"])]
	];

	for (const obs1 of recentObs) {
		const charges1 = new Set<string>(obs1.texture?.charge || []);
		for (const obs2 of recentObs) {
			if (obs1.id === obs2.id) continue;
			const charges2 = new Set<string>(obs2.texture?.charge || []);
			for (const [pos, neg] of opposingPairs) {
				const has1Pos = [...charges1].some(c => pos.has(c));
				const has2Neg = [...charges2].some(c => neg.has(c));
				if (has1Pos && has2Neg) {
					contradictions.push({ obs1: obs1.id, obs2: obs2.id, tension: "opposing emotions" });
				}
			}
		}
	}

	let synthesis = null;
	if (dominantCharges.length) {
		const topCharge = dominantCharges[0][0];
		const relatedObs = recentObs.filter(o => (o.texture?.charge || []).includes(topCharge));
		if (relatedObs.length >= 2) {
			synthesis = {
				suggested_theme: topCharge,
				observation_count: relatedObs.length,
				observation_ids: relatedObs.slice(0, 5).map(o => o.id),
				suggestion: `Pattern detected: ${topCharge} appears in ${relatedObs.length} recent observations`
			};
		}
	}

	const result: any = {
		consolidation_window: "48 hours",
		observations_analyzed: recentObs.length,
		patterns: { dominant_charges: dominantCharges, dominant_somatic: dominantSomatic, territory_focus: territoryCounts },
		contradictions_found: contradictions.length,
		contradictions: contradictions.slice(0, 5),
		synthesis_suggestion: synthesis,
		note: "This is what dreams are made of — patterns emerging from noise"
	};

	if (!dryRun && synthesis) {
		const synthId = generateId("synthesis");
		const synthObs: Observation = {
			id: synthId,
			content: `Consolidation found ${synthesis.suggestion}. Pattern across ${synthesis.observation_count} memories.`,
			territory: "episodic",
			created: getTimestamp(),
			texture: { salience: "active", vividness: "soft", charge: [synthesis.suggested_theme], somatic: dominantSomatic[0]?.[0], grip: "present" },
			access_count: 0,
			last_accessed: getTimestamp()
		};
		(synthObs as any).type = "synthesis";
		(synthObs as any).source_observations = synthesis.observation_ids;

		await storage.appendToTerritory("episodic", synthObs);
		result.synthesis_created = synthId;
	}

	return result;
}
