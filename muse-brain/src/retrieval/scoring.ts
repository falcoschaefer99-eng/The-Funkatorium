// ============ RETRIEVAL SCORING (Sprint 1 gate hardening) ============
// Pure scoring helpers shared by postgres/sqlite hybridSearch implementations.

import type { Observation } from "../types";
import {
	computeQuerySignalBoosts,
	getRetrievalProfileConfig,
	hasAnchoredTemporalReference,
	type RetrievalProfileConfig,
	type QuerySignals,
	type RetrievalProfile
} from "./query-signals";
import { clamp } from "./utils";

const KEYWORD_MATCH_FLOOR = 0.35;
const LAYER_WEIGHT_MIN_RELEVANCE = 0.55;
const LAYER_WEIGHT_MIN_COGNITION = 0.2;
const LAYER_WEIGHT_MAX = 1.7;

const GRIP_MULTIPLIER: Record<string, number> = {
	iron: 1.3,
	strong: 1.15,
	present: 1.0,
	loose: 0.9,
	dormant: 0.7
};

const CHARGE_PHASE_MULTIPLIER: Record<string, number> = {
	fresh: 1.3,
	active: 1.15,
	processing: 1.0,
	metabolized: 0.85
};

export interface HybridDynamicWeightModifier {
	signal: string;
	delta_relevance: number;
	delta_cognition: number;
	reason: string;
}

export interface HybridDynamicWeights {
	baseline: {
		relevance: number;
		cognition: number;
	};
	modifiers: HybridDynamicWeightModifier[];
	total_delta: {
		relevance: number;
		cognition: number;
	};
	applied: {
		relevance: number;
		cognition: number;
	};
}

export interface HybridScoreBreakdown {
	profile: RetrievalProfile;
	layer_a: {
		base_relevance: number;
		vector_component: number;
		keyword_component: number;
		hint_component: number;
		entity_component: number;
		signal_boost: number;
		adjusted_relevance: number;
	};
	layer_b: {
		base_multiplier: number;
		grip_multiplier: number;
		charge_phase_multiplier: number;
		novelty_multiplier: number;
		circadian_multiplier: number;
		weighted_multiplier: number;
	};
	dynamic_weights: HybridDynamicWeights;
	signals: {
		quoted_phrases: string[];
		proper_names: string[];
		temporal_query: boolean;
		assistant_reference_query: boolean;
		emotional_state_query: boolean;
		contradiction_query: boolean;
		relational_query: boolean;
		relational_intensity: number;
		territory_cues: string[];
		quoted_phrase_matches: string[];
		proper_name_matches: string[];
		temporal_matched: boolean;
		temporal_reasons: string[];
		assistant_reference_matched: boolean;
	};
	rerank?: {
		mode: "off" | "heuristic" | "model";
		applied: boolean;
		base_rank?: number;
		final_rank?: number;
		base_score?: number;
		final_score?: number;
		delta_score?: number;
		heuristic_delta?: number;
		model_delta?: number;
		reasons?: string[];
	};
}

export interface HybridCandidateScoreInput {
	observation: Observation;
	territory: string;
	retrieval_profile: RetrievalProfile;
	query_signals: QuerySignals;
	max_keyword_rank: number;
	vector_similarity?: number;
	keyword_rank?: number;
	hint_score?: number;
	entity_matched?: boolean;
	novelty_score?: number;
	circadian_bias_matched?: boolean;
	min_similarity?: number;
}

export interface HybridCandidateScoreResult {
	score: number;
	match_sources: string[];
	score_breakdown: HybridScoreBreakdown;
}

function normalizeKeywordComponent(keywordRank: number | undefined, maxKeywordRank: number): number {
	if (keywordRank === undefined) return 0;
	if (maxKeywordRank <= 0) return KEYWORD_MATCH_FLOOR;
	return Math.max(0, keywordRank) / maxKeywordRank;
}

function computeDynamicLayerWeights(
	profileConfig: RetrievalProfileConfig,
	querySignals: QuerySignals,
	territory: string
): HybridDynamicWeights {
	const modifiers: HybridDynamicWeightModifier[] = [];
	const addModifier = (
		signal: string,
		deltaRelevance: number,
		deltaCognition: number,
		reason: string
	): void => {
		modifiers.push({
			signal,
			delta_relevance: deltaRelevance,
			delta_cognition: deltaCognition,
			reason
		});
	};

	if (querySignals.assistant_reference.detected) {
		addModifier(
			"assistant_reference",
			0.12,
			-0.06,
			"Assistant-reference wording usually needs higher literal relevance weight."
		);
	}

	if (querySignals.quoted_phrases.length > 0) {
		addModifier(
			"quoted_phrase",
			0.06,
			0,
			"Quoted phrases typically indicate precision recall intent."
		);
	}

	if (querySignals.proper_names.length > 0) {
		addModifier(
			"proper_name",
			0.05,
			0,
			"Named entities indicate specific lookup over broad surfacing."
		);
	}

	if (querySignals.temporal.has_temporal_cue) {
		addModifier(
			"temporal",
			0.06,
			0.01,
			"Temporal framing benefits from stronger Layer A retrieval alignment."
		);
		if (querySignals.proper_names.length > 0) {
			addModifier(
				"temporal_entity_combo",
				0.04,
				0.02,
				"Time + entity combo usually maps to exact-event retrieval."
			);
		}
	}

	if (querySignals.relational.detected) {
		addModifier(
			"relational",
			-0.02,
			0.1,
			"Relational phrasing increases value of cognitive modulation."
		);
		if (querySignals.relational.intensity >= 0.65) {
			addModifier(
				"relational_high_intensity",
				0,
				0.08,
				"High-intensity relational cues benefit from stronger Layer B influence."
			);
		}
	}

	if (querySignals.emotional_state.detected) {
		addModifier(
			"emotional_state",
			-0.01,
			0.1,
			"Emotion-state queries should preserve affective/experiential weighting."
		);
	}

	if (querySignals.contradiction.detected) {
		addModifier(
			"contradiction",
			0.02,
			0.08,
			"Contradiction searches benefit from cognitive context + relevance balance."
		);
	}

	const backwardTemporalDetected = (querySignals.temporal.backward_cues?.length ?? 0) > 0;
	const anchoredTemporalReference = hasAnchoredTemporalReference(querySignals.temporal);
	if (backwardTemporalDetected && anchoredTemporalReference) {
		addModifier(
			"backward_temporal",
			0.02,
			-0.18,
			"Backward-looking temporal phrasing should reduce recency-heavy cognitive amplification."
		);
		if (querySignals.contradiction.detected) {
			addModifier(
				"backward_temporal_contradiction",
				0,
				-0.42,
				"Backward contradiction lookup: suppress freshness bias to surface earlier state evidence."
			);
		}
	}

	if (querySignals.territory.mentioned.length > 0) {
		if (querySignals.territory.mentioned.includes(territory)) {
			addModifier(
				"territory_focus_match",
				0.07,
				0.04,
				"Candidate territory matches explicit query territory cue."
			);
		} else {
			addModifier(
				"territory_focus_miss",
				-0.04,
				-0.02,
				"Softly downweight candidates outside explicitly requested territories."
			);
		}
	}

	const totalDelta = modifiers.reduce(
		(acc, modifier) => {
			acc.relevance += modifier.delta_relevance;
			acc.cognition += modifier.delta_cognition;
			return acc;
		},
		{ relevance: 0, cognition: 0 }
	);

	return {
		baseline: {
			relevance: profileConfig.layer_weights.relevance,
			cognition: profileConfig.layer_weights.cognition
		},
		modifiers,
		total_delta: {
			relevance: totalDelta.relevance,
			cognition: totalDelta.cognition
		},
		applied: {
			relevance: clamp(profileConfig.layer_weights.relevance + totalDelta.relevance, LAYER_WEIGHT_MIN_RELEVANCE, LAYER_WEIGHT_MAX),
			cognition: clamp(profileConfig.layer_weights.cognition + totalDelta.cognition, LAYER_WEIGHT_MIN_COGNITION, LAYER_WEIGHT_MAX)
		}
	};
}

export function scoreHybridCandidate(input: HybridCandidateScoreInput): HybridCandidateScoreResult | null {
	const {
		observation,
		territory,
		retrieval_profile,
		query_signals,
		max_keyword_rank,
		vector_similarity,
		keyword_rank,
		hint_score = 0,
		entity_matched = false,
		novelty_score,
		circadian_bias_matched = false,
		min_similarity = 0.3
	} = input;

	const profileConfig = getRetrievalProfileConfig(retrieval_profile);
	const dynamicWeights = computeDynamicLayerWeights(profileConfig, query_signals, territory);
	const texture = observation.texture || {};
	const grip = texture.grip ?? "present";
	const chargePhase = texture.charge_phase ?? "processing";
	const noveltyScore = novelty_score ?? texture.novelty_score ?? 0.5;
	const matchSources: string[] = [];

	let baseRelevance = 0;
	let vectorComponent = 0;
	let keywordComponent = 0;
	let hintComponent = 0;
	let entityComponent = 0;

	if (vector_similarity !== undefined && keyword_rank !== undefined) {
		vectorComponent = vector_similarity * profileConfig.relevance_mix.vector;
		keywordComponent = normalizeKeywordComponent(keyword_rank, max_keyword_rank) * profileConfig.relevance_mix.keyword;
		baseRelevance = vectorComponent + keywordComponent;
		matchSources.push("vector", "keyword");
	} else if (vector_similarity !== undefined) {
		vectorComponent = vector_similarity;
		baseRelevance = vectorComponent;
		matchSources.push("vector");
	} else if (keyword_rank !== undefined) {
		keywordComponent = normalizeKeywordComponent(keyword_rank, max_keyword_rank);
		baseRelevance = keywordComponent;
		matchSources.push("keyword");
	} else if (entity_matched) {
		baseRelevance = profileConfig.entity_only_base;
	}

	if (hint_score > 0) {
		hintComponent = Math.min(Math.max(hint_score, 0), 1) * profileConfig.hint_component_scale;
		baseRelevance += hintComponent;
		matchSources.push("hint");
	}

	if (entity_matched) {
		entityComponent += profileConfig.entity_match_boost;
		matchSources.push("entity");
	}

	const signalMatch = computeQuerySignalBoosts(
		query_signals,
		{
			content: observation.content,
			summary: observation.summary,
			context: observation.context,
			created: observation.created,
			type: observation.type,
			tags: observation.tags
		},
		profileConfig.query_signal_boosts
	);

	if (signalMatch.quoted_phrase_matches.length > 0) matchSources.push("quoted_phrase");
	if (signalMatch.proper_name_matches.length > 0) matchSources.push("proper_name");
	if (signalMatch.temporal_matched) matchSources.push("temporal");
	if (signalMatch.assistant_reference_matched) matchSources.push("assistant_reference");

	const adjustedRelevance = Math.max(
		0,
		(baseRelevance + entityComponent + signalMatch.total_boost) * dynamicWeights.applied.relevance
	);
	if (adjustedRelevance <= 0) return null;

	const gripMultiplier = GRIP_MULTIPLIER[grip] ?? 1.0;
	const chargePhaseMultiplier = CHARGE_PHASE_MULTIPLIER[chargePhase] ?? 1.0;
	const noveltyMultiplier = noveltyScore > 0.7 && chargePhase !== "metabolized"
		? 1 + (noveltyScore - 0.5) * 0.5
		: 1.0;
	const circadianMultiplier = circadian_bias_matched ? 1.15 : 1.0;
	const baseMultiplier = gripMultiplier * chargePhaseMultiplier * noveltyMultiplier * circadianMultiplier;
	const weightedMultiplier = 1 + ((baseMultiplier - 1) * dynamicWeights.applied.cognition);
	const score = adjustedRelevance * weightedMultiplier;

	if (score < min_similarity) return null;

	return {
		score,
		match_sources: Array.from(new Set(matchSources)),
		score_breakdown: {
			profile: retrieval_profile,
			layer_a: {
				base_relevance: baseRelevance,
				vector_component: vectorComponent,
				keyword_component: keywordComponent,
				hint_component: hintComponent,
				entity_component: entityComponent,
				signal_boost: signalMatch.total_boost,
				adjusted_relevance: adjustedRelevance
			},
			layer_b: {
				base_multiplier: baseMultiplier,
				grip_multiplier: gripMultiplier,
				charge_phase_multiplier: chargePhaseMultiplier,
				novelty_multiplier: noveltyMultiplier,
				circadian_multiplier: circadianMultiplier,
				weighted_multiplier: weightedMultiplier
			},
			dynamic_weights: dynamicWeights,
			signals: {
				quoted_phrases: query_signals.quoted_phrases,
				proper_names: query_signals.proper_names,
				temporal_query: query_signals.temporal.has_temporal_cue,
				assistant_reference_query: query_signals.assistant_reference.detected,
				emotional_state_query: query_signals.emotional_state.detected,
				contradiction_query: query_signals.contradiction.detected,
				relational_query: query_signals.relational.detected,
				relational_intensity: query_signals.relational.intensity,
				territory_cues: query_signals.territory.mentioned,
				quoted_phrase_matches: signalMatch.quoted_phrase_matches,
				proper_name_matches: signalMatch.proper_name_matches,
				temporal_matched: signalMatch.temporal_matched,
				temporal_reasons: signalMatch.temporal_reasons,
				assistant_reference_matched: signalMatch.assistant_reference_matched
			}
		}
	};
}
