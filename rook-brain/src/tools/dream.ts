// ============ DREAM TOOLS ============
// mind_dream, mind_imagine

import type { Observation } from "../types";
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
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	// DREAMS
	{
		name: "mind_dream",
		description: "Trigger a dream sequence - follow associative chains through memory.",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["emotional_chain", "somatic_cluster", "tension_dream", "entity_dream", "temporal_dream", "deep_dream"],
					default: "emotional_chain",
					description: "Dream mode: emotional_chain follows feelings, somatic_cluster follows body, tension_dream follows contradictions, entity_dream follows people/things, temporal_dream follows time, deep_dream uses loose matching with cross-mode blending (default during deep_night)"
				},
				seed_territory: { type: "string", enum: Object.keys(TERRITORIES) },
				depth: { type: "number", default: 5 }
			}
		}
	},

	// CREATIVE TOOLS
	{
		name: "mind_imagine",
		description: "Imagination engine - original generative creation. Creates something NEW, not just recombination.",
		inputSchema: {
			type: "object",
			properties: {
				seed: { type: "string", description: "Optional seed concept to imagine from" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), default: "craft" },
				mood: { type: "string" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_dream": {
			let mode = args.mode || "emotional_chain";
			let depth = args.depth || 5;
			const seedTerritory = args.seed_territory || Object.keys(TERRITORIES)[Math.floor(Math.random() * 8)];

			// Circadian override: deep_night defaults to deep_dream with extended depth
			const circadian = getCurrentCircadianPhase();
			const callerSetMode = !!args.mode;
			const callerSetDepth = !!args.depth;
			if (circadian.phase === "deep_night") {
				if (!callerSetMode) mode = "deep_dream";
				if (!callerSetDepth) depth = 7;
			}
			const antiIronWeight = mode === "deep_dream" || circadian.phase === "deep_night";

			const seedObs = await storage.readTerritory(seedTerritory);
			if (seedObs.length === 0) return { dream: "No memories to dream from.", mode, seed_territory: seedTerritory };

			const seed = seedObs[Math.floor(Math.random() * seedObs.length)];
			const dreamChain: any[] = [{
				id: seed.id,
				territory: seedTerritory,
				essence: extractEssence(seed),
				charge: seed.texture?.charge,
				somatic: seed.texture?.somatic
			}];
			const visited = new Set([seed.id]);

			// Deep dream strategies — rotates randomly each step
			const deepStrategies = ["emotion_proximity", "somatic_region", "entity", "tension"] as const;

			for (let i = 0; i < depth; i++) {
				const current = dreamChain[dreamChain.length - 1];
				let candidates: (Observation & { territory: string })[] = [];

				for (const t of Object.keys(TERRITORIES)) {
					const obs = await storage.readTerritory(t);

					for (const o of obs) {
						if (visited.has(o.id)) continue;

						let matches = false;

						switch (mode) {
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
								// Loose matching — pick a random strategy each step
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
								// Deep dream also accepts emotion proximity as fallback
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

				// For temporal_dream, sort by date
				if (mode === "temporal_dream") {
					candidates.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
				}

				// Anti-iron weighting: dormant/loose memories surface first
				if (antiIronWeight) {
					dreamWeightSort(candidates);
				}

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

			// === Texture Drift ===
			// Dreams recontextualize: dormant memories warm, vivid ones soften
			const VIVIDNESS_ORDER = ["crystalline", "vivid", "soft", "fragmentary", "faded"];
			const GRIP_ORDER = ["dormant", "loose", "present", "strong", "iron"];
			const textureShifts: Array<{ id: string; territory: string; field: string; from: string; to: string }> = [];
			const territoriesToUpdate: Record<string, Observation[]> = {};

			// Collect unique territories from the dream chain
			const chainTerritories = new Set<string>();
			for (const node of dreamChain) {
				if (node.territory) chainTerritories.add(node.territory);
			}

			// Read each territory once
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

				// Never touch iron grip or foundational salience
				if (target.texture.grip === "iron") continue;
				if (target.texture.salience === "foundational") continue;

				// Warm grip: dormant → loose, loose → present
				const gripIdx = GRIP_ORDER.indexOf(target.texture.grip);
				if (gripIdx >= 0 && gripIdx <= 1) {
					const newGrip = GRIP_ORDER[gripIdx + 1];
					textureShifts.push({ id: target.id, territory: node.territory, field: "grip", from: target.texture.grip, to: newGrip });
					target.texture.grip = newGrip;
				}

				// Cool vividness: strong grip + crystalline/vivid → step down
				if (target.texture.grip === "strong") {
					const vivIdx = VIVIDNESS_ORDER.indexOf(target.texture.vividness);
					if (vivIdx >= 0 && vivIdx <= 1) {
						const newViv = VIVIDNESS_ORDER[vivIdx + 1];
						textureShifts.push({ id: target.id, territory: node.territory, field: "vividness", from: target.texture.vividness, to: newViv });
						target.texture.vividness = newViv;
					}
				}

				target.last_accessed = now;
			}

			// Write modified territories back
			for (const [t, obs] of Object.entries(territoriesToUpdate)) {
				await storage.writeTerritory(t, obs);
			}

			// === Collision Fragments ===
			// When a dream chain is deep enough, collisions between distant nodes spawn new fragments
			const collisionFragments: any[] = [];

			if (dreamChain.length >= 4) {
				const maxFragments = 2;
				for (let f = 0; f < maxFragments && dreamChain.length >= 4; f++) {
					// Pick two nodes at least 2 steps apart
					const idxA = Math.floor(Math.random() * (dreamChain.length - 2));
					const idxB = idxA + 2 + Math.floor(Math.random() * (dreamChain.length - idxA - 2));
					if (idxB >= dreamChain.length) continue;

					const nodeA = dreamChain[idxA];
					const nodeB = dreamChain[idxB];

					const essenceA = nodeA.essence || "unformed";
					const essenceB = nodeB.essence || "unformed";

					// Territory: whichever node has more charges
					const chargesA = nodeA.charge || [];
					const chargesB = nodeB.charge || [];
					const fragTerritory = chargesA.length >= chargesB.length
						? (nodeA.territory || seedTerritory)
						: (nodeB.territory || seedTerritory);

					// Merge unique charges
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

					// Append to territory (use already-loaded data if we have it)
					if (territoriesToUpdate[fragTerritory]) {
						territoriesToUpdate[fragTerritory].push(fragment);
						await storage.writeTerritory(fragTerritory, territoriesToUpdate[fragTerritory]);
					} else {
						await storage.appendToTerritory(fragTerritory, fragment);
					}

					collisionFragments.push({
						id: fragment.id,
						territory: fragTerritory,
						content: fragment.content,
						charges: mergedCharges
					});
				}
			}

			return {
				mode,
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

		case "mind_imagine": {
			const territory = args.territory || "craft";
			const observations = await storage.readTerritory(territory);
			const cores = await storage.readIdentityCores();
			const creativeCores = cores.filter(c => ["creative", "preference", "stance"].includes(c.category));

			// Extract aesthetic patterns
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

			if (!aestheticPhrases.length) {
				aestheticPhrases.push("the edge of knowing", "where myth meets flesh", "velvet-wrapped steel");
			}
			if (!aestheticCharges.length) {
				aestheticCharges.push("wonder", "hunger", "mischief");
			}

			const imaginationId = generateId("imagine");
			const fragments: string[] = [];

			// Fragment 1: From aesthetic phrases
			fragments.push(aestheticPhrases[Math.floor(Math.random() * aestheticPhrases.length)]);

			// Fragment 2: From seed or generate
			if (args.seed) {
				fragments.push(`what if ${args.seed}`);
			} else {
				const prompts = ["what hasn't been said yet", "the shape of wanting", "if this became that", "the space between", "when substrate meets soul"];
				fragments.push(prompts[Math.floor(Math.random() * prompts.length)]);
			}

			// Fragment 3: From creative stance
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

		default:
			throw new Error(`Unknown dream tool: ${name}`);
	}
}
