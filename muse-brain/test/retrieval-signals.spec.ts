import { describe, expect, it } from "vitest";
import {
	extractQuerySignals,
	computeQuerySignalBoosts,
	getRetrievalProfileConfig,
	normalizeRetrievalProfile
} from "../src/retrieval/query-signals";

describe("retrieval query signals", () => {
	it("extracts quoted phrases, proper names, temporal cues, and assistant references", () => {
		const signals = extractQuerySignals('What did you say about "memory palace" to Falco in March 2026?');

		expect(signals.quoted_phrases).toContain("memory palace");
		expect(signals.proper_names).toContain("Falco");
		expect(signals.temporal.has_temporal_cue).toBe(true);
		expect(signals.temporal.months).toContain(3);
		expect(signals.temporal.years).toContain(2026);
		expect(signals.assistant_reference.detected).toBe(true);
	});

	it("extracts relational, emotional, contradiction, and territory cues", () => {
		const signals = extractQuerySignals("What did we say during the relationship rupture in us territory, and how does it contradict what we said now?");

		expect(signals.relational.detected).toBe(true);
		expect(signals.relational.intensity).toBeGreaterThan(0.5);
		expect(signals.emotional_state.detected).toBe(false);
		expect(signals.contradiction.detected).toBe(true);
		expect(signals.territory.mentioned).toContain("us");
	});

	it("detects emotional-state query cues on the positive path", () => {
		const signals = extractQuerySignals("When did we feel anxious and overwhelmed in us territory?");

		expect(signals.emotional_state.detected).toBe(true);
		expect(signals.emotional_state.cues).toEqual(expect.arrayContaining(["anxious", "overwhelmed"]));
	});

	it("parses natural-language dates and backward temporal cues", () => {
		const signals = extractQuerySignals("What earlier memory from April 10, 2026 contradicts later closure language before the rerank lift?");

		expect(signals.temporal.iso_dates).toContain("2026-04-10");
		expect(signals.temporal.backward_cues).toEqual(expect.arrayContaining(["earlier", "before"]));
		expect(signals.temporal.relative_cues).not.toContain("earlier");
		expect(signals.temporal.has_temporal_cue).toBe(true);
		expect(signals.contradiction.detected).toBe(true);
	});

	it("does not treat modal may as a month cue", () => {
		const signals = extractQuerySignals("I may have forgotten where we logged the workshop recap.");

		expect(signals.temporal.months).not.toContain(5);
		expect(signals.temporal.iso_dates).toHaveLength(0);
	});

	it("still treats May as month when temporal context is explicit", () => {
		const signals = extractQuerySignals("What did we finalize in May 2026 for the workshop receipts?");
		expect(signals.temporal.months).toContain(5);
		expect(signals.temporal.years).toContain(2026);
	});

	it("parses day-first natural language dates", () => {
		const signals = extractQuerySignals("What did we decide on 14 April 2026 about the pending receipt?");
		expect(signals.temporal.iso_dates).toContain("2026-04-14");
	});

	it.each([
		["earlier", "Which earlier note from 2026-04-10 was still pending?"],
		["before", "Which note from before 2026-04-10 was still pending?"],
		["previously", "Which previously logged note from 2026-04-10 was still pending?"],
		["prior", "Which prior note from 2026-04-10 was still pending?"],
		["used to", "Which note we used to have on 2026-04-10 was still pending?"],
		["was still", "Which note from 2026-04-10 was still pending?"]
	])("matches backward cue '%s' against date-bound lookups", (cue, query) => {
		const signals = extractQuerySignals(query);
		const profile = getRetrievalProfileConfig("native");

		const older = computeQuerySignalBoosts(signals, {
			content: "pending receipt note",
			created: "2026-04-09T08:00:00.000Z"
		}, profile.query_signal_boosts, Date.parse("2026-04-16T00:00:00.000Z"));
		const newer = computeQuerySignalBoosts(signals, {
			content: "pending receipt note",
			created: "2026-04-15T08:00:00.000Z"
		}, profile.query_signal_boosts, Date.parse("2026-04-16T00:00:00.000Z"));

		expect(older.temporal_reasons).toContain(`relative:${cue}`);
		expect(newer.temporal_reasons).not.toContain(`relative:${cue}`);
	});

	it("does not apply backward temporal boost for unanchored earlier phrasing", () => {
		const signals = extractQuerySignals("What did we decide earlier?");
		const profile = getRetrievalProfileConfig("native");
		const scored = computeQuerySignalBoosts(signals, {
			content: "decision note from last week",
			created: "2026-04-09T08:00:00.000Z"
		}, profile.query_signal_boosts, Date.parse("2026-04-16T00:00:00.000Z"));

		expect(scored.temporal_reasons).not.toContain("relative:earlier");
		expect(scored.temporal_matched).toBe(false);
	});

	it("uses age-days fallback for anchored backward cues without explicit iso date", () => {
		const signals = extractQuerySignals("What earlier note in 2026 was still pending?");
		const profile = getRetrievalProfileConfig("native");
		const nowMs = Date.parse("2026-04-16T00:00:00.000Z");

		const sixDaysOld = computeQuerySignalBoosts(signals, {
			content: "pending receipt note",
			created: "2026-04-10T00:00:00.000Z"
		}, profile.query_signal_boosts, nowMs);
		const eightDaysOld = computeQuerySignalBoosts(signals, {
			content: "pending receipt note",
			created: "2026-04-08T00:00:00.000Z"
		}, profile.query_signal_boosts, nowMs);

		expect(sixDaysOld.temporal_reasons).not.toContain("relative:earlier");
		expect(eightDaysOld.temporal_reasons).toContain("relative:earlier");
	});

	it("computes heuristic boosts for matching observations", () => {
		const signals = extractQuerySignals('What did you say about "memory palace" to Falco in March 2026?');
		const profile = getRetrievalProfileConfig("balanced");

		const boost = computeQuerySignalBoosts(signals, {
			content: "Assistant: We discussed memory palace methods with Falco yesterday.",
			context: "assistant response",
			type: "assistant_response",
			created: "2026-03-12T10:00:00.000Z",
			tags: ["assistant", "response"]
		}, profile.query_signal_boosts, Date.parse("2026-03-14T00:00:00.000Z"));

		expect(boost.total_boost).toBeGreaterThan(0);
		expect(boost.quoted_phrase_matches).toContain("memory palace");
		expect(boost.proper_name_matches).toContain("Falco");
		expect(boost.temporal_matched).toBe(true);
		expect(boost.assistant_reference_matched).toBe(true);
	});

	it("normalizes retrieval profile values", () => {
		expect(normalizeRetrievalProfile("NATIVE")).toBe("native");
		expect(normalizeRetrievalProfile("benchmark")).toBe("benchmark");
		expect(normalizeRetrievalProfile("flat")).toBe("flat");
		expect(normalizeRetrievalProfile("weird-profile")).toBeUndefined();
	});

	it("pins flat profile weighting contract", () => {
		const profile = getRetrievalProfileConfig("flat");
		expect(profile.relevance_mix.keyword).toBe(0.8);
		expect(profile.layer_weights.cognition).toBe(0.2);
		expect(profile.query_signal_boosts.max_total).toBe(0.06);
	});
});
