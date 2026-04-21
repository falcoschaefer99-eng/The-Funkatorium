// ============ RETRIEVAL PROFILES + QUERY SIGNALS (Sprint 1) ============
// Layer A (relevance) helpers:
// - retrieval profile baselines
// - query signal extraction
// - first heuristic boost set

import { unique } from "./utils";

export type RetrievalProfile = "native" | "balanced" | "benchmark" | "flat";

export interface QueryTemporalSignals {
	has_temporal_cue: boolean;
	iso_dates: string[];
	years: number[];
	months: number[]; // 1-12
	relative_cues: string[];
	backward_cues?: string[];
}

export interface QueryAssistantReference {
	detected: boolean;
	cues: string[];
}

export interface QueryEmotionSignals {
	detected: boolean;
	cues: string[];
}

export interface QueryContradictionSignals {
	detected: boolean;
	cues: string[];
}

export interface QueryRelationalSignals {
	detected: boolean;
	cues: string[];
	/** 0-1 coarse intensity score for relationally loaded queries. */
	intensity: number;
}

export interface QueryTerritorySignals {
	mentioned: string[];
}

export interface QuerySignals {
	quoted_phrases: string[];
	proper_names: string[];
	temporal: QueryTemporalSignals;
	assistant_reference: QueryAssistantReference;
	emotional_state: QueryEmotionSignals;
	contradiction: QueryContradictionSignals;
	relational: QueryRelationalSignals;
	territory: QueryTerritorySignals;
}

export interface QuerySignalBoostConfig {
	quoted_phrase: number;
	proper_name: number;
	temporal: number;
	assistant_reference: number;
	max_total: number;
}

export interface RetrievalProfileConfig {
	name: RetrievalProfile;
	candidate_pool: {
		vector: number;
		keyword: number;
		entity: number;
	};
	relevance_mix: {
		vector: number;
		keyword: number;
	};
	layer_weights: {
		relevance: number;
		cognition: number;
	};
	hint_component_scale: number;
	entity_only_base: number;
	entity_match_boost: number;
	query_signal_boosts: QuerySignalBoostConfig;
}

export const DEFAULT_RETRIEVAL_PROFILE: RetrievalProfile = "native";

export const RETRIEVAL_PROFILE_CONFIGS: Record<RetrievalProfile, RetrievalProfileConfig> = {
	native: {
		name: "native",
		candidate_pool: { vector: 50, keyword: 30, entity: 20 },
		relevance_mix: { vector: 0.7, keyword: 0.3 },
		layer_weights: { relevance: 1.0, cognition: 1.0 },
		hint_component_scale: 0.06,
		entity_only_base: 0.5,
		entity_match_boost: 0.08,
		query_signal_boosts: {
			quoted_phrase: 0.16,
			proper_name: 0.1,
			temporal: 0.1,
			assistant_reference: 0.09,
			max_total: 0.42
		}
	},
	balanced: {
		name: "balanced",
		candidate_pool: { vector: 80, keyword: 50, entity: 30 },
		relevance_mix: { vector: 0.65, keyword: 0.35 },
		layer_weights: { relevance: 1.1, cognition: 0.8 },
		hint_component_scale: 0.08,
		entity_only_base: 0.52,
		entity_match_boost: 0.1,
		query_signal_boosts: {
			quoted_phrase: 0.18,
			proper_name: 0.12,
			temporal: 0.12,
			assistant_reference: 0.1,
			max_total: 0.5
		}
	},
	benchmark: {
		name: "benchmark",
		candidate_pool: { vector: 120, keyword: 80, entity: 40 },
		relevance_mix: { vector: 0.55, keyword: 0.45 },
		layer_weights: { relevance: 1.2, cognition: 0.5 },
		hint_component_scale: 0.1,
		entity_only_base: 0.55,
		entity_match_boost: 0.12,
		query_signal_boosts: {
			quoted_phrase: 0.2,
			proper_name: 0.14,
			temporal: 0.14,
			assistant_reference: 0.12,
			max_total: 0.6
		}
	},
	flat: {
		name: "flat",
		candidate_pool: { vector: 30, keyword: 120, entity: 15 },
		relevance_mix: { vector: 0.2, keyword: 0.8 },
		layer_weights: { relevance: 1.25, cognition: 0.2 },
		hint_component_scale: 0.02,
		entity_only_base: 0.45,
		entity_match_boost: 0.04,
		query_signal_boosts: {
			quoted_phrase: 0.02,
			proper_name: 0.02,
			temporal: 0.02,
			assistant_reference: 0.01,
			max_total: 0.06
		}
	}
};

export function normalizeRetrievalProfile(value: unknown): RetrievalProfile | undefined {
	if (typeof value !== "string") return undefined;
	const clean = value.trim().toLowerCase();
	if (clean === "native" || clean === "balanced" || clean === "benchmark" || clean === "flat") return clean;
	return undefined;
}

export function getRetrievalProfileConfig(profile: RetrievalProfile): RetrievalProfileConfig {
	return RETRIEVAL_PROFILE_CONFIGS[profile];
}

const MONTHS: Record<string, number> = {
	january: 1, jan: 1,
	february: 2, feb: 2,
	march: 3, mar: 3,
	april: 4, apr: 4,
	may: 5,
	june: 6, jun: 6,
	july: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	october: 10, oct: 10,
	november: 11, nov: 11,
	december: 12, dec: 12
};

const PROPER_NAME_BLOCKLIST = new Set([
	"The", "A", "An", "And", "Or", "But",
	"What", "When", "Where", "Why", "How", "Who",
	"I", "You", "We", "They", "He", "She", "It",
	"Today", "Tomorrow", "Yesterday", "Last", "Next", "This"
]);

const RELATIVE_TEMPORAL_CUES = [
	"today",
	"yesterday",
	"tomorrow",
	"last week",
	"this week",
	"next week",
	"last month",
	"this month",
	"next month",
	"last year",
	"this year",
	"next year",
	"recent",
	"recently",
	"latest"
];

const BACKWARD_TEMPORAL_CUES = [
	"earlier",
	"before",
	"previously",
	"prior",
	"used to",
	"was still"
];

const BACKWARD_TEMPORAL_CUE_SET = new Set(BACKWARD_TEMPORAL_CUES);

const EMOTIONAL_STATE_CUES = [
	"worried",
	"upset",
	"anxious",
	"anxiety",
	"stressed",
	"overwhelmed",
	"sad",
	"grief",
	"angry",
	"fear",
	"afraid",
	"emotional",
	"emotion",
	"feeling",
	"felt",
	"mood"
];

const CONTRADICTION_CUES = [
	"contradiction",
	"contradict",
	"contradicts",
	"contradicting",
	"contradicted",
	"inconsistent",
	"inconsistency",
	"doesn't add up",
	"does not add up",
	"vs",
	"versus",
	"but now",
	"changed from",
	"conflict with"
];

const RELATIONAL_CUES = [
	"relationship",
	"partner",
	"between us",
	"we",
	"us",
	"intimacy",
	"rupture",
	"repair",
	"conflict",
	"apology",
	"argument",
	"fight",
	"trust",
	"distance",
	"no contact",
	"check-in"
];

const RELATIONAL_HIGH_INTENSITY_CUES = new Set([
	"rupture",
	"repair",
	"conflict",
	"apology",
	"argument",
	"fight",
	"intimacy",
	"no contact"
]);

const TERRITORY_TOKENS = [
	"self",
	"us",
	"craft",
	"body",
	"emotional",
	"episodic",
	"philosophy",
	"kin"
];

const BACKWARD_LOOKBACK_MIN_AGE_DAYS = 7;

export function hasAnchoredTemporalReference(temporal: QueryTemporalSignals): boolean {
	return temporal.iso_dates.length > 0
		|| temporal.years.length > 0
		|| temporal.months.length > 0
		|| (temporal.relative_cues?.length ?? 0) > 0;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCueRegexMap(cues: string[]): Map<string, RegExp> {
	const map = new Map<string, RegExp>();
	for (const cue of cues) {
		const escaped = escapeRegex(cue).replace(/\s+/g, "\\s+");
		map.set(cue, new RegExp(`\\b${escaped}\\b`, "i"));
	}
	return map;
}

function detectCues(text: string, cueRegex: Map<string, RegExp>): string[] {
	return unique(
		Array.from(cueRegex.entries())
			.filter(([, regex]) => regex.test(text))
			.map(([cue]) => cue)
	);
}

const MONTH_TOKEN_REGEX = new Map<string, RegExp>(
	Object.keys(MONTHS).map(token => [token, new RegExp(`\\b${escapeRegex(token)}\\b`, "i")])
);
const RELATIVE_TEMPORAL_CUE_REGEX = buildCueRegexMap(RELATIVE_TEMPORAL_CUES);
const BACKWARD_TEMPORAL_CUE_REGEX = buildCueRegexMap(BACKWARD_TEMPORAL_CUES);
const EMOTIONAL_STATE_CUE_REGEX = buildCueRegexMap(EMOTIONAL_STATE_CUES);
const CONTRADICTION_CUE_REGEX = buildCueRegexMap(CONTRADICTION_CUES);
const RELATIONAL_CUE_REGEX = buildCueRegexMap(RELATIONAL_CUES);
const TERRITORY_TOKEN_REGEX = buildCueRegexMap(TERRITORY_TOKENS);

const NATURAL_MONTH_DAY_REGEX = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/gi;
const NATURAL_DAY_MONTH_REGEX = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)(?:,\s*(\d{4}))?\b/gi;
const MAY_MONTH_CONTEXT_REGEX = /\b(?:in|on|during|throughout|by)\s+may\b|\bmay\s+(?:\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\d{4})\b/i;

function toIsoDate(year: number, month: number, day: number): string | undefined {
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
	if (day < 1 || day > 31) return undefined;
	const normalized = new Date(Date.UTC(year, month - 1, day));
	if (normalized.getUTCFullYear() !== year || (normalized.getUTCMonth() + 1) !== month || normalized.getUTCDate() !== day) {
		return undefined;
	}
	return normalized.toISOString().slice(0, 10);
}

function extractNaturalLanguageIsoDates(raw: string, defaultYear: number): string[] {
	const isoDates: string[] = [];
	for (const match of raw.matchAll(NATURAL_MONTH_DAY_REGEX)) {
		const monthToken = String(match[1] ?? "").toLowerCase();
		const month = MONTHS[monthToken];
		const day = Number.parseInt(String(match[2] ?? ""), 10);
		const explicitYear = Number.parseInt(String(match[3] ?? ""), 10);
		const year = Number.isFinite(explicitYear) ? explicitYear : defaultYear;
		const iso = toIsoDate(year, month, day);
		if (iso) isoDates.push(iso);
	}
	for (const match of raw.matchAll(NATURAL_DAY_MONTH_REGEX)) {
		const day = Number.parseInt(String(match[1] ?? ""), 10);
		const monthToken = String(match[2] ?? "").toLowerCase();
		const month = MONTHS[monthToken];
		const explicitYear = Number.parseInt(String(match[3] ?? ""), 10);
		const year = Number.isFinite(explicitYear) ? explicitYear : defaultYear;
		const iso = toIsoDate(year, month, day);
		if (iso) isoDates.push(iso);
	}
	return unique(isoDates);
}

function monthMentioned(raw: string, token: string): boolean {
	if (token === "may") {
		return MAY_MONTH_CONTEXT_REGEX.test(raw);
	}
	return MONTH_TOKEN_REGEX.get(token)?.test(raw) ?? false;
}

function matchRelativeTemporalCue(cue: string, ageDays: number): boolean {
	switch (cue) {
		case "today":
			return ageDays < 1;
		case "yesterday":
			return ageDays >= 1 && ageDays < 2;
		case "recent":
			return ageDays <= 10;
		case "recently":
			return ageDays <= 14;
		case "latest":
			return ageDays <= 7;
		case "this week":
			return ageDays <= 7;
		case "last week":
			return ageDays > 7 && ageDays <= 14;
		case "this month":
			return ageDays <= 31;
		case "last month":
			return ageDays > 31 && ageDays <= 62;
		case "this year":
			return ageDays <= 366;
		case "last year":
			return ageDays > 366 && ageDays <= 730;
		default:
			return false;
	}
}

function matchBackwardTemporalCue(cue: string, createdMs: number, ageDays: number, referenceDateMs: number | undefined): boolean {
	if (!BACKWARD_TEMPORAL_CUE_SET.has(cue)) return false;
	if (Number.isFinite(referenceDateMs)) {
		const dayEnd = (referenceDateMs as number) + (24 * 60 * 60 * 1000) - 1;
		return createdMs <= dayEnd;
	}
	return ageDays >= BACKWARD_LOOKBACK_MIN_AGE_DAYS;
}

export function extractQuerySignals(query: string): QuerySignals {
	const raw = String(query ?? "");
	const lowered = raw.toLowerCase();

	const quoted_phrases = unique(
		Array.from(raw.matchAll(/"([^"\n]{2,160})"/g))
			.map(m => m[1].trim())
			.filter(Boolean)
	);

	const proper_names = unique(
		Array.from(raw.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g))
			.map(m => m[0].trim())
			.filter(name => !PROPER_NAME_BLOCKLIST.has(name))
			.filter(name => !MONTHS[name.toLowerCase()])
	);

	const explicitIsoDates = unique(
		Array.from(lowered.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map(m => m[0])
	);
	const years = unique(
		Array.from(lowered.matchAll(/\b(?:19|20)\d{2}\b/g))
			.map(m => Number(m[0]))
			.filter(n => Number.isFinite(n))
	);
	const defaultYear = years[0] ?? new Date().getUTCFullYear();
	const naturalIsoDates = extractNaturalLanguageIsoDates(raw, defaultYear);
	const iso_dates = unique([...explicitIsoDates, ...naturalIsoDates]);
	const months = unique(
		Object.entries(MONTHS)
			.filter(([token]) => monthMentioned(raw, token))
			.map(([, month]) => month)
	);
	const relative_cues = detectCues(raw, RELATIVE_TEMPORAL_CUE_REGEX);
	const backward_cues = detectCues(raw, BACKWARD_TEMPORAL_CUE_REGEX);
	const has_temporal_cue = iso_dates.length > 0
		|| years.length > 0
		|| months.length > 0
		|| relative_cues.length > 0
		|| backward_cues.length > 0;

	const assistantCues: string[] = [];
	if (/\bwhat did you\b/i.test(raw)) assistantCues.push("what_did_you");
	if (/\b(?:you|assistant|ai|rainer|rook)\s+(?:said|told|wrote|replied|mentioned|recommended|answered)\b/i.test(raw)) {
		assistantCues.push("assistant_verb_reference");
	}
	if (/\byour\s+(?:response|answer|message|advice)\b/i.test(raw)) assistantCues.push("your_response_reference");
	if (/\bassistant\b/i.test(raw)) assistantCues.push("assistant_term");

	const emotionalCues = detectCues(raw, EMOTIONAL_STATE_CUE_REGEX);
	const contradictionCues = detectCues(raw, CONTRADICTION_CUE_REGEX);
	const relationalCues = detectCues(raw, RELATIONAL_CUE_REGEX);
	const territoryMentioned = detectCues(raw, TERRITORY_TOKEN_REGEX);
	const relationalHighIntensity = relationalCues.some(cue => RELATIONAL_HIGH_INTENSITY_CUES.has(cue));
	const relationalIntensity = relationalCues.length === 0
		? 0
		: Math.min(
			1,
			0.35
			+ (relationalHighIntensity ? 0.35 : 0)
			+ (emotionalCues.length > 0 ? 0.15 : 0)
			+ (territoryMentioned.includes("us") ? 0.15 : 0)
		);

	return {
		quoted_phrases,
		proper_names,
		temporal: {
			has_temporal_cue,
			iso_dates,
			years,
			months,
			relative_cues,
			backward_cues
		},
		assistant_reference: {
			detected: assistantCues.length > 0,
			cues: unique(assistantCues)
		},
		emotional_state: {
			detected: emotionalCues.length > 0,
			cues: emotionalCues
		},
		contradiction: {
			detected: contradictionCues.length > 0,
			cues: contradictionCues
		},
		relational: {
			detected: relationalCues.length > 0,
			cues: relationalCues,
			intensity: relationalIntensity
		},
		territory: {
			mentioned: territoryMentioned
		}
	};
}

export interface SignalScorableObservation {
	content?: string;
	summary?: string;
	context?: string;
	created?: string;
	type?: string;
	tags?: string[];
}

export interface QuerySignalMatch {
	components: {
		quoted_phrase: number;
		proper_name: number;
		temporal: number;
		assistant_reference: number;
	};
	total_boost: number;
	quoted_phrase_matches: string[];
	proper_name_matches: string[];
	temporal_matched: boolean;
	temporal_reasons: string[];
	assistant_reference_matched: boolean;
}

function isAssistantAuthoredObservation(observation: SignalScorableObservation): boolean {
	const type = String(observation.type ?? "").toLowerCase();
	const context = String(observation.context ?? "").toLowerCase();
	const content = String(observation.content ?? "").toLowerCase();
	const tags = (observation.tags ?? []).map(tag => tag.toLowerCase());

	if (/(assistant|reply|response)/.test(type)) return true;
	if (/(assistant|rainer|rook)/.test(context)) return true;
	if (tags.some(tag => /(assistant|ai|response|reply|rainer|rook)/.test(tag))) return true;
	if (/^(assistant|rainer|rook)\s*:/.test(content.trim())) return true;
	return false;
}

interface TemporalMatchContext {
	anchoredTemporalReference: boolean;
	referenceDateMs?: number;
}

const TEMPORAL_MATCH_CONTEXT_CACHE = new WeakMap<QueryTemporalSignals, TemporalMatchContext>();

function getTemporalReferenceDateMs(temporal: QueryTemporalSignals): number | undefined {
	let latest: number | undefined;
	for (const date of temporal.iso_dates) {
		const timestamp = Date.parse(`${date}T00:00:00.000Z`);
		if (!Number.isFinite(timestamp)) continue;
		if (latest === undefined || timestamp > latest) latest = timestamp;
	}
	return latest;
}

function getTemporalMatchContext(temporal: QueryTemporalSignals): TemporalMatchContext {
	const cached = TEMPORAL_MATCH_CONTEXT_CACHE.get(temporal);
	if (cached) return cached;
	const context: TemporalMatchContext = {
		anchoredTemporalReference: hasAnchoredTemporalReference(temporal),
		referenceDateMs: getTemporalReferenceDateMs(temporal)
	};
	TEMPORAL_MATCH_CONTEXT_CACHE.set(temporal, context);
	return context;
}

function matchTemporalSignals(
	temporal: QueryTemporalSignals,
	createdIso: string | undefined,
	nowMs: number,
	context: TemporalMatchContext
): { matched: boolean; reasons: string[] } {
	if (!createdIso) return { matched: false, reasons: [] };
	const createdMs = Date.parse(createdIso);
	if (!Number.isFinite(createdMs)) return { matched: false, reasons: [] };
	const DAY_MS = 24 * 60 * 60 * 1000;

	const created = new Date(createdMs);
	const createdDate = created.toISOString().slice(0, 10);
	const reasons: string[] = [];

	if (temporal.iso_dates.includes(createdDate)) reasons.push("iso_date");
	if (temporal.years.includes(created.getUTCFullYear())) reasons.push("year");
	if (temporal.months.includes(created.getUTCMonth() + 1)) reasons.push("month");

	const temporalCues = unique([...(temporal.relative_cues ?? []), ...(temporal.backward_cues ?? [])]);
	if (temporalCues.length > 0) {
		const ageDays = (nowMs - createdMs) / DAY_MS;
		for (const cue of temporalCues) {
			const isBackwardCue = BACKWARD_TEMPORAL_CUE_SET.has(cue);
			if (isBackwardCue && !context.anchoredTemporalReference) continue;
			if (matchRelativeTemporalCue(cue, ageDays) || matchBackwardTemporalCue(cue, createdMs, ageDays, context.referenceDateMs)) {
				reasons.push(`relative:${cue}`);
			}
		}
	}

	return { matched: reasons.length > 0, reasons: unique(reasons) };
}

export function computeQuerySignalBoosts(
	signals: QuerySignals,
	observation: SignalScorableObservation,
	config: QuerySignalBoostConfig,
	nowMs = Date.now()
): QuerySignalMatch {
	const haystack = `${observation.content ?? ""}\n${observation.summary ?? ""}\n${observation.context ?? ""}`.toLowerCase();

	const temporalContext = getTemporalMatchContext(signals.temporal);
	const quoted_phrase_matches = signals.quoted_phrases.filter(phrase => haystack.includes(phrase.toLowerCase()));
	const proper_name_matches = signals.proper_names.filter(name => {
		if (haystack.includes(name.toLowerCase())) return true;
		const parts = name.split(/\s+/).map(p => p.trim()).filter(Boolean);
		return parts.length > 1 && parts.every(part => haystack.includes(part.toLowerCase()));
	});
	const temporalMatch = matchTemporalSignals(signals.temporal, observation.created, nowMs, temporalContext);
	const assistant_reference_matched = signals.assistant_reference.detected && isAssistantAuthoredObservation(observation);

	let components = {
		quoted_phrase: Math.min(config.quoted_phrase * quoted_phrase_matches.length, config.quoted_phrase * 2.5),
		proper_name: Math.min(config.proper_name * proper_name_matches.length, config.proper_name * 2.5),
		temporal: temporalMatch.matched ? config.temporal : 0,
		assistant_reference: assistant_reference_matched ? config.assistant_reference : 0
	};

	let total = components.quoted_phrase + components.proper_name + components.temporal + components.assistant_reference;
	if (total > config.max_total && total > 0) {
		const scale = config.max_total / total;
		components = {
			quoted_phrase: components.quoted_phrase * scale,
			proper_name: components.proper_name * scale,
			temporal: components.temporal * scale,
			assistant_reference: components.assistant_reference * scale
		};
		total = config.max_total;
	}

	return {
		components,
		total_boost: total,
		quoted_phrase_matches,
		proper_name_matches,
		temporal_matched: temporalMatch.matched,
		temporal_reasons: temporalMatch.reasons,
		assistant_reference_matched
	};
}
