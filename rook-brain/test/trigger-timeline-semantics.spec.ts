import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTool as handleTimelineTool } from '../src/tools-v2/timeline';
import { handleTool as handleSafetyTool } from '../src/tools-v2/safety';
import type { TriggerCondition } from '../src/types';

function timelineRow(id: string, created: string): any {
	return {
		territory: 'episodic',
		observation: {
			id,
			content: `Observation ${id}`,
			created,
			texture: { charge: [], grip: 'present', charge_phase: 'warming' }
		}
	};
}

function makeTrigger(overrides: Partial<TriggerCondition>): TriggerCondition {
	return {
		id: overrides.id ?? 'trigger_test',
		type: overrides.type ?? 'no_contact',
		entity: overrides.entity,
		config: overrides.config ?? {},
		created: overrides.created ?? '2026-01-01T00:00:00.000Z',
		last_checked: overrides.last_checked ?? '2026-01-01T00:00:00.000Z',
		last_fired: overrides.last_fired,
		active: overrides.active ?? true
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('mind_timeline chronology', () => {
	it('enforces chronological ordering in non-semantic mode', async () => {
		const storage = {
			queryObservations: vi.fn(async () => [
				timelineRow('obs_3', '2026-01-03T12:00:00.000Z'),
				timelineRow('obs_1', '2026-01-01T12:00:00.000Z'),
				timelineRow('obs_2', '2026-01-02T12:00:00.000Z')
			])
		};

		const result = await handleTimelineTool('mind_timeline', { limit: 3 }, { storage } as any);

		expect(result.search_mode).toBe('chronological');
		expect(result.observations.map((obs: any) => obs.id)).toEqual(['obs_1', 'obs_2', 'obs_3']);
	});
});

describe('mind_trigger semantics', () => {
	it('uses configured timezone for time_window checks', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));

		const triggers = [
			makeTrigger({
				id: 'trigger_time_window',
				type: 'time_window',
				entity: 'falco',
				config: { start_hour: 6, end_hour: 8, timezone: 'America/New_York' }
			})
		];
		const storage = {
			readTriggers: vi.fn(async () => triggers),
			writeTriggers: vi.fn(async () => undefined)
		};

		const result = await handleSafetyTool('mind_trigger', { action: 'check' }, { storage } as any);

		expect(result.fired).toHaveLength(1);
		expect(result.fired[0].message).toContain('America/New_York');
	});

	it('does not use last_fired as no_contact signal source', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T04:00:00.000Z'));

		const triggers = [
			makeTrigger({
				id: 'trigger_no_contact_last_fired_only',
				type: 'no_contact',
				entity: 'falco',
				config: { silence_hours: 2 },
				last_fired: '2026-01-01T00:00:00.000Z'
			})
		];
		const storage = {
			readTriggers: vi.fn(async () => triggers),
			writeTriggers: vi.fn(async () => undefined)
		};

		const result = await handleSafetyTool('mind_trigger', { action: 'check' }, { storage } as any);

		expect(result.fired).toBeUndefined();
	});

	it('fires no_contact once per actual silence streak', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T03:00:00.000Z'));

		const triggers = [
			makeTrigger({
				id: 'trigger_no_contact_once',
				type: 'no_contact',
				entity: 'falco',
				config: { silence_hours: 2, last_signal_at: '2026-01-01T00:00:00.000Z' }
			})
		];
		const storage = {
			readTriggers: vi.fn(async () => triggers),
			writeTriggers: vi.fn(async () => undefined)
		};

		const first = await handleSafetyTool('mind_trigger', { action: 'check' }, { storage } as any);
		expect(first.fired).toHaveLength(1);

		const second = await handleSafetyTool('mind_trigger', { action: 'check' }, { storage } as any);
		expect(second.fired).toBeUndefined();
	});

	it('fires presence_transition only when a real from->to event arrives', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T10:30:00.000Z'));

		const triggers = [
			makeTrigger({
				id: 'trigger_presence_transition',
				type: 'presence_transition',
				entity: 'falco',
				config: {
					from: 'online',
					to: 'offline',
					last_seen_state: 'online',
					last_seen_at: '2026-01-01T09:00:00.000Z'
				}
			})
		];
		const storage = {
			readTriggers: vi.fn(async () => triggers),
			writeTriggers: vi.fn(async () => undefined)
		};

		const idleCheck = await handleSafetyTool('mind_trigger', { action: 'check' }, { storage } as any);
		expect(idleCheck.fired).toBeUndefined();

		const transitioned = await handleSafetyTool('mind_trigger', {
			action: 'check',
			event: {
				entity: 'falco',
				state: 'offline',
				observed_at: '2026-01-01T10:00:00.000Z'
			}
		}, { storage } as any);
		expect(transitioned.fired).toHaveLength(1);
		expect(transitioned.fired[0]).toEqual(expect.objectContaining({ from: 'online', to: 'offline' }));

		const replay = await handleSafetyTool('mind_trigger', {
			action: 'check',
			event: {
				entity: 'falco',
				state: 'offline',
				observed_at: '2026-01-01T10:00:00.000Z'
			}
		}, { storage } as any);
		expect(replay.fired).toBeUndefined();
	});
});
