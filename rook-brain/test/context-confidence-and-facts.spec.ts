import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleMemoryTool } from '../src/tools-v2/memory';
import { handleTool as handleSearchTool } from '../src/tools-v2/search';
import { handleTool as handleCommsTool } from '../src/tools-v2/comms';
import type { Observation } from '../src/types';

function makeObservation(id: string, created: string): Observation {
	return {
		id,
		content: `obs ${id}`,
		territory: 'craft',
		created,
		texture: {
			salience: 'active',
			vividness: 'vivid',
			charge: [],
			grip: 'present',
			charge_phase: 'fresh'
		},
		access_count: 0
	};
}

describe('context confidence gating', () => {
	it('applies confidence threshold + hard cap in mind_query hybrid path', async () => {
		const now = Date.now();
		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: makeObservation('obs_high_old', new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.80,
					match_sources: ['vector']
				},
				{
					observation: makeObservation('obs_recent_high', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.50,
					match_sources: ['vector', 'keyword']
				},
				{
					observation: makeObservation('obs_recent_low', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.52,
					match_sources: ['keyword']
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		// obs_high_old: score=0.80, 10 days old (outside 3-day window) → confidence=0.80, passes threshold
		// obs_recent_high: score=0.50, 1 day old → boosted to 0.65, fails threshold
		// obs_recent_low: score=0.52, 1 day old → boosted to 0.67, fails threshold
		// Only obs_high_old passes — unambiguous winner, not array-order dependent
		const result = await handleMemoryTool('mind_query', {
			query: 'autonomous skill confidence',
			confidence_threshold: 0.7,
			recency_boost_days: 3,
			recency_boost: 0.15,
			max_context_items: 1
		}, { storage: storage as any });

		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe('obs_high_old');
		expect(result.confidence.below_threshold).toBe(2);
		expect(result.confidence.pre_cap_count).toBe(1);
		expect(result.confidence.max_context_items).toBe(1);
	});

	it('supports shadow_mode in mind_search without dropping below-threshold rows', async () => {
		const now = Date.now();
		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: makeObservation('obs1', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.76,
					match_sources: ['vector']
				},
				{
					observation: makeObservation('obs2', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.55,
					match_sources: ['keyword']
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await handleSearchTool('mind_search', {
			query: 'task context',
			confidence_threshold: 0.8,
			shadow_mode: true,
			recency_boost: 0.15
		}, { storage: storage as any });

		expect(result.total_matches).toBe(2);
		expect(result.results.length).toBe(2);
		expect(result.confidence.shadow_mode).toBe(true);
		expect(result.confidence.below_threshold).toBeGreaterThan(0);
	});

	it('recency boost pushes a below-threshold item above the threshold', async () => {
		const now = Date.now();
		const storage = {
			hybridSearch: vi.fn(async () => ([
				{
					observation: makeObservation('obs_boosted', new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()),
					territory: 'craft',
					score: 0.60,
					match_sources: ['vector']
				}
			])),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		// score=0.60, 1 day old, within 3-day recency window → boosted to 0.75
		// threshold=0.70 → item survives
		const result = await handleSearchTool('mind_search', {
			query: 'recency boost edge case',
			confidence_threshold: 0.70,
			recency_boost_days: 3,
			recency_boost: 0.15
		}, { storage: storage as any });

		expect(result.total_matches).toBe(1);
		expect(result.results[0].confidence).toBe(0.75);
	});

	it('falls back to findEntityByName when findEntityById misses before hybrid search', async () => {
		const storage = {
			hybridSearch: vi.fn(async () => []),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => ({ id: 'entity_project_atlas', name: 'Project Atlas' }))
		};

		const result = await handleSearchTool('mind_search', {
			query: 'atlas retention policy',
			entity: 'Project Atlas'
		}, { storage: storage as any });

		expect(result.total_matches).toBe(0);
		expect(storage.findEntityById).toHaveBeenCalledWith('Project Atlas');
		expect(storage.findEntityByName).toHaveBeenCalledWith('Project Atlas');
		expect(storage.hybridSearch).toHaveBeenCalledWith(expect.objectContaining({
			entity_id: 'entity_project_atlas'
		}));
});

describe('productivity fact extraction on mind_context', () => {
	it('extracts fact candidates in shadow mode without writes', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to ship confidence gating next sprint.',
			key_points: ['Deadline: next sprint', 'Falco prefers lower prompt noise'],
			open_threads: ['Rainer will handle threshold calibration'],
			extract_facts: true,
			extraction_mode: 'shadow'
		}, { storage: storage as any });

		expect(result.saved).toBe(true);
		expect(result.fact_extraction.mode).toBe('shadow');
		expect(result.fact_extraction.candidate_count).toBeGreaterThan(0);
		const candidateTypes = result.fact_extraction.candidates.map((c: { fact_type: string }) => c.fact_type);
		expect(candidateTypes).toContain('decision');
		expect(candidateTypes).toContain('deadline');
		expect(appendToTerritory).not.toHaveBeenCalled();
	});

	it('writes capped fact candidates in write mode', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to ship. Deadline: tomorrow.',
			key_points: [
				'Owner: Rainer',
				'Falco prefers concise productivity memory'
			],
			extract_facts: true,
			extraction_mode: 'write',
			max_fact_candidates: 2
		}, { storage: storage as any });

		expect(result.fact_extraction.mode).toBe('write');
		expect(result.fact_extraction.candidate_count).toBe(2);
		expect(result.fact_extraction.stored_count).toBe(2);
		const writeCandidateTypes = result.fact_extraction.candidates.map((c: { fact_type: string }) => c.fact_type);
		expect(writeCandidateTypes).toContain('decision');
		expect(writeCandidateTypes).toContain('deadline');
		expect(appendToTerritory).toHaveBeenCalledTimes(2);
		expect(appendToTerritory).toHaveBeenCalledWith('craft', expect.objectContaining({ type: 'fact_candidate' }));
	});

	it('defaults to shadow mode when extraction_mode is omitted', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to ship the feature.',
			key_points: ['Deadline: next sprint'],
			extract_facts: true
		}, { storage: storage as any });

		expect(result.fact_extraction.mode).toBe('shadow');
		expect(appendToTerritory).not.toHaveBeenCalled();
	});

	it('respects max_fact_candidates=1 boundary in write mode', async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to refactor the pipeline.',
			key_points: [
				'Deadline: end of week',
				'Goal: reduce latency',
				'Owner: June will handle the migration'
			],
			extract_facts: true,
			extraction_mode: 'write',
			max_fact_candidates: 1
		}, { storage: storage as any });

		expect(result.fact_extraction.candidate_count).toBe(1);
		expect(result.fact_extraction.stored_count).toBe(1);
		expect(appendToTerritory).toHaveBeenCalledTimes(1);
	});

	it('stores recall contracts in conversation context', async () => {
		const writeConversationContext = vi.fn(async () => undefined);
		const storage = {
			writeConversationContext,
			appendToTerritory: vi.fn(async () => undefined)
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We need periodic follow-up on release readiness.',
			recall_contracts: [
				{
					id: 'release_followup',
					title: 'Re-check release readiness',
					note: 'Verify docs + gauntlet once more',
					recall_after_hours: 24,
					scope: 'task',
					priority: 'high'
				}
			]
		}, { storage: storage as any });

		expect(result.saved).toBe(true);
		expect(result.recall_contracts_saved).toBe(1);
		expect(result.recall_contract_ids).toContain('release_followup');
		expect(writeConversationContext).toHaveBeenCalledWith(expect.objectContaining({
			recall_contracts: [expect.objectContaining({
				id: 'release_followup',
				title: 'Re-check release readiness',
				recall_after_hours: 24,
				scope: 'task',
				priority: 'high'
			})]
		}));
	});

	it('bridges high-confidence decision/deadline facts into commitment proposals', async () => {
		const createProposal = vi.fn(async (payload: any) => ({
			id: `proposal_${payload.source_id}`,
			...payload
		}));
		const proposalExists = vi.fn(async () => false);
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			getTenant: () => 'rainer',
			writeConversationContext: vi.fn(async () => undefined),
			appendToTerritory,
			proposalExists,
			createProposal
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to ship Proactivity v1.1. Deadline: tomorrow.',
			extract_facts: true,
			extraction_mode: 'write',
			auto_commit: true,
			commitment_mode: 'proposal',
			commitment_threshold: 0.8
		}, { storage: storage as any });

		expect(result.fact_extraction.mode).toBe('write');
		expect(result.commitment_bridge.enabled).toBe(true);
		expect(result.commitment_bridge.proposal_count).toBeGreaterThan(0);
		expect(createProposal).toHaveBeenCalled();
		expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
			proposal_type: 'fact_commitment',
			status: 'pending'
		}));
		expect(proposalExists).toHaveBeenCalled();
		expect(appendToTerritory).toHaveBeenCalled();
	});

	it('requires extract_facts when auto_commit is enabled', async () => {
		const storage = {
			writeConversationContext: vi.fn(async () => undefined)
		};

		const result = await handleCommsTool('mind_context', {
			action: 'set',
			summary: 'We decided to ship.',
			auto_commit: true
		}, { storage: storage as any });

		expect(result.error).toMatch(/auto_commit requires extract_facts=true/i);
	});

});
