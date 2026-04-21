import { describe, expect, it } from "vitest";
import type { Observation } from "../src/types";
import { extractQuerySignals, RETRIEVAL_PROFILE_CONFIGS } from "../src/retrieval/query-signals";
import { scoreHybridCandidate } from "../src/retrieval/scoring";

function makeObservation(overrides: Partial<Observation> = {}): Observation {
	return {
		id: overrides.id ?? "obs_score",
		content: overrides.content ?? "Assistant: memory palace notes for Falco",
		territory: overrides.territory ?? "craft",
		created: overrides.created ?? "2026-04-09T06:30:00.000Z",
		texture: overrides.texture ?? {
			salience: "active",
			vividness: "vivid",
			charge: [],
			grip: "present",
			charge_phase: "fresh"
		},
		access_count: overrides.access_count ?? 0,
		context: overrides.context,
		mood: overrides.mood,
		last_accessed: overrides.last_accessed,
		links: overrides.links,
		summary: overrides.summary,
		type: overrides.type,
		tags: overrides.tags,
		entity_id: overrides.entity_id
	};
}

describe("retrieval scoring", () => {
	it("keeps keyword-only candidates alive when keyword normalization collapses to zero", () => {
		const observation = makeObservation({
			content: "plain keyword match",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "present",
				charge_phase: "processing"
			}
		});

		const scored = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: extractQuerySignals("plain keyword"),
			keyword_rank: 0,
			max_keyword_rank: 0,
			min_similarity: 0.3
		});

		expect(scored).not.toBeNull();
		expect(scored?.match_sources).toContain("keyword");
		expect(scored?.score_breakdown.layer_a.keyword_component).toBe(0.35);
	});

	it("separates Layer A relevance from Layer B cognition in the breakdown", () => {
		const observation = makeObservation({
			type: "assistant_response",
			tags: ["assistant"],
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["clarity"],
				grip: "iron",
				charge_phase: "fresh",
				novelty_score: 0.9
			}
		});

		const scored = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "balanced",
			query_signals: extractQuerySignals('What did you say about "memory palace" to Falco in April 2026?'),
			vector_similarity: 0.7,
			keyword_rank: 0.8,
			max_keyword_rank: 1,
			entity_matched: true,
			circadian_bias_matched: true,
			min_similarity: 0.01
		});

		expect(scored).not.toBeNull();
		expect(scored?.score_breakdown.layer_a.adjusted_relevance).toBeGreaterThan(
			scored?.score_breakdown.layer_a.base_relevance ?? 0
		);
		expect(scored?.score_breakdown.layer_b.base_multiplier).toBeGreaterThan(1);
		expect(scored?.score_breakdown.dynamic_weights.modifiers.length).toBeGreaterThan(0);
		expect(scored?.score_breakdown.signals.quoted_phrase_matches).toContain("memory palace");
		expect(scored?.score_breakdown.signals.assistant_reference_matched).toBe(true);
	});

	it("reduces cognitive amplification in benchmark profile versus native", () => {
		const observation = makeObservation({
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "iron",
				charge_phase: "fresh",
				novelty_score: 0.9
			}
		});
		const signals = extractQuerySignals('What did you say about "memory palace"?');

		const native = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: signals,
			vector_similarity: 0.6,
			max_keyword_rank: 0,
			circadian_bias_matched: true,
			min_similarity: 0.01
		});
		const benchmark = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "benchmark",
			query_signals: signals,
			vector_similarity: 0.6,
			max_keyword_rank: 0,
			circadian_bias_matched: true,
			min_similarity: 0.01
		});

		expect(native).not.toBeNull();
		expect(benchmark).not.toBeNull();
		expect(native?.score_breakdown.layer_b.weighted_multiplier).toBeGreaterThan(
			benchmark?.score_breakdown.layer_b.weighted_multiplier ?? 0
		);
	});

	it("applies profile-specific hint component scaling", () => {
		const observation = makeObservation({
			content: "quiet note with no direct keyword overlap",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "present",
				charge_phase: "processing"
			}
		});
		const signals = extractQuerySignals("april memory");

		const native = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: signals,
			hint_score: 1,
			max_keyword_rank: 0,
			min_similarity: 0.01
		});
		const benchmark = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "benchmark",
			query_signals: signals,
			hint_score: 1,
			max_keyword_rank: 0,
			min_similarity: 0.01
		});

		expect(native).not.toBeNull();
		expect(benchmark).not.toBeNull();
		expect((benchmark?.score_breakdown.layer_a.hint_component ?? 0)).toBeGreaterThan(
			native?.score_breakdown.layer_a.hint_component ?? 0
		);
	});

	it("boosts cognition weight for relational-emotional queries", () => {
		const observation = makeObservation({
			territory: "us",
			content: "We repaired after conflict and talked through what hurt us.",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["grief"],
				grip: "strong",
				charge_phase: "active"
			}
		});
		const relationalSignals = extractQuerySignals("What did we feel during the relationship rupture between us?");
		const factualSignals = extractQuerySignals('What did you say about "memory palace" in 2026?');

		const relational = scoreHybridCandidate({
			observation,
			territory: "us",
			retrieval_profile: "balanced",
			query_signals: relationalSignals,
			keyword_rank: 0.8,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});
		const factual = scoreHybridCandidate({
			observation,
			territory: "us",
			retrieval_profile: "balanced",
			query_signals: factualSignals,
			keyword_rank: 0.8,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});

		expect(relational).not.toBeNull();
		expect(factual).not.toBeNull();
		expect((relational?.score_breakdown.dynamic_weights.applied.cognition ?? 0)).toBeGreaterThan(
			factual?.score_breakdown.dynamic_weights.applied.cognition ?? 0
		);
	});

	it("clamps dynamic layer weights at configured boundaries", () => {
		const profile = RETRIEVAL_PROFILE_CONFIGS.native;
		const originalWeights = { ...profile.layer_weights };
		profile.layer_weights.relevance = 2.4;
		profile.layer_weights.cognition = -0.8;

		try {
			const scored = scoreHybridCandidate({
				observation: makeObservation({
					territory: "craft",
					content: "plain keyword match"
				}),
				territory: "craft",
				retrieval_profile: "native",
				query_signals: extractQuerySignals("plain keyword match"),
				keyword_rank: 1,
				max_keyword_rank: 1,
				min_similarity: 0.01
			});

			expect(scored).not.toBeNull();
			expect(scored?.score_breakdown.dynamic_weights.applied.relevance).toBe(1.7);
			expect(scored?.score_breakdown.dynamic_weights.applied.cognition).toBe(0.2);
		} finally {
			profile.layer_weights.relevance = originalWeights.relevance;
			profile.layer_weights.cognition = originalWeights.cognition;
		}
	});

	it("suppresses cognition for backward-looking contradiction queries", () => {
		const observation = makeObservation({
			territory: "craft",
			created: "2026-04-15T20:58:25.545Z",
			content: "Sprint continuation note about contradiction and closure.",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "strong",
				charge_phase: "fresh"
			}
		});
		const backwardSignals = extractQuerySignals("What earlier memory from April 10, 2026 shows contradiction with the later closure language?");
		const forwardSignals = extractQuerySignals("What latest contradiction memory shows the current closure status?");

		const backward = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: backwardSignals,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});
		const forward = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: forwardSignals,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});

		expect(backward).not.toBeNull();
		expect(forward).not.toBeNull();
		expect((backward?.score_breakdown.dynamic_weights.applied.cognition ?? 0)).toBeLessThan(
			forward?.score_breakdown.dynamic_weights.applied.cognition ?? 0
		);
		const backwardModifiers = backward?.score_breakdown.dynamic_weights.modifiers ?? [];
		const backwardTemporal = backwardModifiers.find(mod => mod.signal === "backward_temporal");
		const backwardContradiction = backwardModifiers.find(mod => mod.signal === "backward_temporal_contradiction");
		expect(backwardTemporal?.delta_cognition).toBe(-0.18);
		expect(backwardContradiction?.delta_cognition).toBe(-0.42);
		expect((backwardTemporal?.delta_cognition ?? 0) + (backwardContradiction?.delta_cognition ?? 0)).toBe(-0.6);
	});

	it("applies backward-only temporal suppression without contradiction compound", () => {
		const observation = makeObservation({
			territory: "craft",
			created: "2026-04-15T20:58:25.545Z",
			content: "Status note from this week.",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "strong",
				charge_phase: "fresh"
			}
		});
		const backwardSignals = extractQuerySignals("Which earlier memory from April 10, 2026 still had the receipt pending?");
		const forwardSignals = extractQuerySignals("Which latest memory shows the current receipt status?");

		const backward = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: backwardSignals,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});
		const forward = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: forwardSignals,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});

		expect(backward).not.toBeNull();
		expect(forward).not.toBeNull();
		const backwardModifier = backward?.score_breakdown.dynamic_weights.modifiers.find(mod => mod.signal === "backward_temporal");
		expect(backwardModifier?.delta_cognition).toBe(-0.18);
		expect((backward?.score_breakdown.dynamic_weights.modifiers ?? []).some(mod => mod.signal === "backward_temporal_contradiction")).toBe(false);
		expect((backward?.score_breakdown.dynamic_weights.applied.cognition ?? 0)).toBeLessThan(
			forward?.score_breakdown.dynamic_weights.applied.cognition ?? 0
		);
	});

	it("does not apply backward suppression when no temporal anchor exists", () => {
		const observation = makeObservation({
			territory: "us",
			content: "We talked through unresolved conflict in the repair period.",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "strong",
				charge_phase: "active"
			}
		});
		const backwardUnanchored = extractQuerySignals("What unresolved conflict between us was still active in the repair period?");
		const anchored = extractQuerySignals("What unresolved conflict between us was still active around April 10, 2026?");

		const unanchored = scoreHybridCandidate({
			observation,
			territory: "us",
			retrieval_profile: "native",
			query_signals: backwardUnanchored,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});
		const withAnchor = scoreHybridCandidate({
			observation,
			territory: "us",
			retrieval_profile: "native",
			query_signals: anchored,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});

		expect(unanchored).not.toBeNull();
		expect(withAnchor).not.toBeNull();
		expect((unanchored?.score_breakdown.dynamic_weights.modifiers ?? []).some(mod => mod.signal === "backward_temporal")).toBe(false);
		expect((withAnchor?.score_breakdown.dynamic_weights.modifiers ?? []).some(mod => mod.signal === "backward_temporal")).toBe(true);
	});

	it.each([
		["year-only anchor", "Which earlier memory in 2026 still had the receipt pending?"],
		["month-only anchor", "Which earlier memory in April still had the receipt pending?"],
		["relative-cue anchor", "Which earlier memory this month still had the receipt pending?"]
	])("applies backward suppression with %s", (_label, query) => {
		const observation = makeObservation({
			territory: "craft",
			created: "2026-04-15T20:58:25.545Z",
			content: "Status note from this week.",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "strong",
				charge_phase: "fresh"
			}
		});
		const anchoredSignals = extractQuerySignals(query);

		const scored = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: anchoredSignals,
			keyword_rank: 0.9,
			max_keyword_rank: 1,
			min_similarity: 0.01
		});

		expect(scored).not.toBeNull();
		expect((scored?.score_breakdown.dynamic_weights.modifiers ?? []).some(mod => mod.signal === "backward_temporal")).toBe(true);
	});
});
