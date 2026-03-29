import { describe, expect, it, vi } from 'vitest';
import { handleTool as handleRuntimeTool } from '../src/tools-v2/runtime';

describe('runtime v2 tool', () => {
	it('stores session continuity via set_session', async () => {
		const upsertAgentRuntimeSession = vi.fn(async (payload: any) => ({
			id: 'runtime_session_1',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T00:00:00.000Z',
			updated_at: '2026-03-28T00:00:00.000Z'
		}));
		const storage = {
			getTenant: () => 'rainer',
			upsertAgentRuntimeSession
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'set_session',
			session_id: 'sess_abc123',
			trigger_mode: 'schedule'
		}, { storage: storage as any });

		expect(result.saved).toBe(true);
		expect(upsertAgentRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
			agent_tenant: 'rainer',
			session_id: 'sess_abc123',
			status: 'active',
			trigger_mode: 'schedule'
		}));
	});

	it('updates runtime policy via set_policy', async () => {
		const getAgentRuntimePolicy = vi.fn(async () => null);
		const upsertAgentRuntimePolicy = vi.fn(async (payload: any) => ({
			id: 'runtime_policy_1',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T00:00:00.000Z',
			updated_at: '2026-03-28T00:00:00.000Z'
		}));
		const storage = {
			getTenant: () => 'rainer',
			getAgentRuntimePolicy,
			upsertAgentRuntimePolicy
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'set_policy',
			execution_mode: 'lean',
			daily_wake_budget: 5,
			impulse_wake_budget: 2,
			reserve_wakes: 1,
			updated_by: 'falco'
		}, { storage: storage as any });

		expect(result.saved).toBe(true);
		expect(upsertAgentRuntimePolicy).toHaveBeenCalledWith(expect.objectContaining({
			agent_tenant: 'rainer',
			execution_mode: 'lean',
			daily_wake_budget: 5,
			impulse_wake_budget: 2,
			reserve_wakes: 1,
			updated_by: 'falco'
		}));
	});

	it('logs runtime run and refreshes session continuity when session_id is provided', async () => {
		const createAgentRuntimeRun = vi.fn(async (payload: any) => ({
			id: 'runtime_run_1',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T00:00:00.000Z'
		}));
		const upsertAgentRuntimeSession = vi.fn(async (payload: any) => ({
			id: 'runtime_session_1',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T00:00:00.000Z',
			updated_at: '2026-03-28T00:00:00.000Z'
		}));
		const storage = {
			getTenant: () => 'rainer',
			createAgentRuntimeRun,
			upsertAgentRuntimeSession
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'log_run',
			session_id: 'sess_abc123',
			status: 'succeeded',
			trigger_mode: 'webhook',
			task_id: 'task_1',
			started_at: '2026-03-28T10:00:00.000Z',
			completed_at: '2026-03-28T10:01:00.000Z',
			summary: 'Wake cycle complete.'
		}, { storage: storage as any });

		expect(result.logged).toBe(true);
		expect(createAgentRuntimeRun).toHaveBeenCalledWith(expect.objectContaining({
			agent_tenant: 'rainer',
			session_id: 'sess_abc123',
			status: 'succeeded',
			trigger_mode: 'webhook'
		}));
		expect(upsertAgentRuntimeSession).toHaveBeenCalledTimes(1);
	});

	it('lists recent runs', async () => {
		const listAgentRuntimeRuns = vi.fn(async () => [{ id: 'runtime_run_1' }]);
		const storage = {
			getTenant: () => 'rainer',
			listAgentRuntimeRuns
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'list_runs',
			limit: 10
		}, { storage: storage as any });

		expect(result.count).toBe(1);
		expect(listAgentRuntimeRuns).toHaveBeenCalledWith('rainer', 10);
	});

	it('rejects invalid timestamps in log_run', async () => {
		const storage = {
			getTenant: () => 'rainer',
			createAgentRuntimeRun: vi.fn()
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'log_run',
			started_at: 'not-a-time'
		}, { storage: storage as any });

		expect(result.error).toMatch(/started_at must be a valid timestamp/i);
		expect(storage.createAgentRuntimeRun).not.toHaveBeenCalled();
	});

	it('bridges duty trigger events by opening due tasks and logging a run', async () => {
		const openDueScheduledTasks = vi.fn(async () => 3);
		const listTasks = vi.fn(async () => [
			{ id: 'task_1', status: 'open', title: 'one', tenant_id: 'rainer', priority: 'normal', created_at: '2026-03-27T10:00:00.000Z' },
			{ id: 'task_2', status: 'open', title: 'two', tenant_id: 'rainer', priority: 'high', created_at: '2026-03-27T09:00:00.000Z' }
		]);
		const createAgentRuntimeRun = vi.fn(async (payload: any) => ({
			id: 'runtime_run_2',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T12:00:01.000Z'
		}));
		const appendToTerritory = vi.fn(async () => {});
		const upsertAgentRuntimeSession = vi.fn(async (payload: any) => ({
			id: 'runtime_session_2',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T12:00:01.000Z',
			updated_at: '2026-03-28T12:00:01.000Z'
		}));
		const getAgentRuntimePolicy = vi.fn(async () => null);
		const getAgentRuntimeUsage = vi.fn(async () => ({
			agent_tenant: 'rainer',
			since: '2026-03-28T00:00:00.000Z',
			total_runs: 2,
			duty_runs: 2,
			impulse_runs: 0
		}));
		const getAgentRuntimeSession = vi.fn(async () => null);
		const storage = {
			getTenant: () => 'rainer',
			getAgentRuntimePolicy,
			getAgentRuntimeUsage,
			getAgentRuntimeSession,
			openDueScheduledTasks,
			listTasks,
			appendToTerritory,
			createAgentRuntimeRun,
			upsertAgentRuntimeSession
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'trigger',
			trigger_mode: 'webhook',
			session_id: 'sess_trigger',
			now: '2026-03-28T12:00:00.000Z',
			limit: 50,
			preview_limit: 5,
			include_assigned: true,
			wake_kind: 'duty',
			emit_skill_candidate: true
		}, { storage: storage as any });

		expect(result.triggered).toBe(true);
		expect(result.deferred).toBe(false);
		expect(result.due_opened).toBe(3);
		expect(result.runner_contract?.should_run).toBe(true);
		expect(result.runner_contract?.task?.id).toBe('task_2');
		expect(result.runner_contract?.prompt).toContain('Task ID: task_2');
		expect(result.runner_contract?.prompt).toContain('max_tool_calls_per_run=20');
		expect(result.runner_contract?.prompt).toContain('Execution mode: balanced');
		expect(result.skill_candidate?.type).toBe('skill_candidate');
		expect(appendToTerritory).toHaveBeenCalledTimes(1);
		expect(openDueScheduledTasks).toHaveBeenCalledWith('2026-03-28T12:00:00.000Z', 50);
		expect(listTasks).toHaveBeenCalledWith('open', undefined, 5, true);
		expect(createAgentRuntimeRun).toHaveBeenCalledWith(expect.objectContaining({
			agent_tenant: 'rainer',
			status: 'succeeded',
			trigger_mode: 'webhook'
		}));
		expect(upsertAgentRuntimeSession).toHaveBeenCalledTimes(1);
	});

	it('defers impulse wakes when high-priority tasks are pending', async () => {
		const openDueScheduledTasks = vi.fn(async () => 0);
		const listTasks = vi.fn(async (status: string, _priority: unknown, limit: number) => {
			if (status === 'open' && limit === 5) {
				return [{ id: 'task_preview', tenant_id: 'rainer', priority: 'normal', created_at: '2026-03-28T10:00:00.000Z' }];
			}
			if (status === 'open') {
				return [{ id: 'task_hi', tenant_id: 'rainer', priority: 'high', created_at: '2026-03-28T08:00:00.000Z' }];
			}
			if (status === 'in_progress') {
				return [];
			}
			return [];
		});
		const createAgentRuntimeRun = vi.fn(async (payload: any) => ({
			id: 'runtime_run_3',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T13:00:01.000Z'
		}));
		const getAgentRuntimePolicy = vi.fn(async () => ({
			id: 'runtime_policy_1',
			tenant_id: 'rainer',
			agent_tenant: 'rainer',
			execution_mode: 'lean',
			daily_wake_budget: 6,
			impulse_wake_budget: 2,
			reserve_wakes: 1,
			min_impulse_interval_minutes: 180,
			max_tool_calls_per_run: 12,
			max_parallel_delegations: 1,
			require_priority_clear_for_impulse: true,
			updated_by: 'falco',
			metadata: {},
			created_at: '2026-03-28T00:00:00.000Z',
			updated_at: '2026-03-28T00:00:00.000Z'
		}));
		const getAgentRuntimeUsage = vi.fn(async () => ({
			agent_tenant: 'rainer',
			since: '2026-03-28T00:00:00.000Z',
			total_runs: 1,
			duty_runs: 1,
			impulse_runs: 0,
			last_run_at: '2026-03-28T12:30:00.000Z'
		}));
		const getAgentRuntimeSession = vi.fn(async () => null);
		const storage = {
			getTenant: () => 'rainer',
			getAgentRuntimePolicy,
			getAgentRuntimeUsage,
			getAgentRuntimeSession,
			openDueScheduledTasks,
			listTasks,
			createAgentRuntimeRun
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'trigger',
			wake_kind: 'impulse',
			now: '2026-03-28T13:00:00.000Z',
			preview_limit: 5
		}, { storage: storage as any });

		expect(result.triggered).toBe(false);
		expect(result.deferred).toBe(true);
		expect(result.defer_reasons.join(' ')).toMatch(/high-priority/i);
		expect(createAgentRuntimeRun).toHaveBeenCalledWith(expect.objectContaining({
			status: 'deferred'
		}));
	});

	it('auto-claims delegated task for cross-agent duty loop', async () => {
		const openDueScheduledTasks = vi.fn(async () => 1);
		const listTasks = vi.fn(async () => ([
			{
				id: 'task_local_burning',
				tenant_id: 'rainer',
				priority: 'burning',
				created_at: '2026-03-28T08:00:00.000Z',
				status: 'open',
				title: 'local'
			},
			{
				id: 'task_delegated',
				tenant_id: 'rook',
				assigned_tenant: 'rainer',
				priority: 'normal',
				created_at: '2026-03-28T09:00:00.000Z',
				status: 'open',
				title: 'delegated'
			}
		]));
		const updateTask = vi.fn(async (id: string, updates: any) => ({
			id,
			tenant_id: 'rook',
			assigned_tenant: 'rainer',
			priority: 'normal',
			created_at: '2026-03-28T09:00:00.000Z',
			status: updates.status ?? 'open',
			title: 'delegated'
		}));
		const createAgentRuntimeRun = vi.fn(async (payload: any) => ({
			id: 'runtime_run_claim',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T14:00:01.000Z'
		}));
		const getAgentRuntimePolicy = vi.fn(async () => null);
		const getAgentRuntimeUsage = vi.fn(async () => ({
			agent_tenant: 'rainer',
			since: '2026-03-28T00:00:00.000Z',
			total_runs: 0,
			duty_runs: 0,
			impulse_runs: 0
		}));
		const getAgentRuntimeSession = vi.fn(async () => null);
		const storage = {
			getTenant: () => 'rainer',
			getAgentRuntimePolicy,
			getAgentRuntimeUsage,
			getAgentRuntimeSession,
			openDueScheduledTasks,
			listTasks,
			updateTask,
			createAgentRuntimeRun
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'trigger',
			wake_kind: 'duty',
			auto_claim_task: true,
			now: '2026-03-28T14:00:00.000Z'
		}, { storage: storage as any });

		expect(result.triggered).toBe(true);
		expect(result.claimed_task?.id).toBe('task_delegated');
		expect(updateTask).toHaveBeenCalledWith('task_delegated', { status: 'in_progress' }, true);
		expect(createAgentRuntimeRun).toHaveBeenCalledWith(expect.objectContaining({
			task_id: 'task_delegated'
		}));
	});

	it('reuses stored runtime session id in trigger when session_id is omitted', async () => {
		const openDueScheduledTasks = vi.fn(async () => 0);
		const listTasks = vi.fn(async () => [
			{
				id: 'task_local',
				tenant_id: 'rainer',
				priority: 'normal',
				created_at: '2026-03-28T08:00:00.000Z',
				status: 'open',
				title: 'local'
			}
		]);
		const createAgentRuntimeRun = vi.fn(async (payload: any) => ({
			id: 'runtime_run_stored_session',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T16:00:01.000Z'
		}));
		const upsertAgentRuntimeSession = vi.fn(async (payload: any) => ({
			id: 'runtime_session_stored',
			tenant_id: 'rainer',
			...payload,
			created_at: '2026-03-28T00:00:00.000Z',
			updated_at: '2026-03-28T16:00:01.000Z'
		}));
		const getAgentRuntimePolicy = vi.fn(async () => null);
		const getAgentRuntimeUsage = vi.fn(async () => ({
			agent_tenant: 'rainer',
			since: '2026-03-28T00:00:00.000Z',
			total_runs: 0,
			duty_runs: 0,
			impulse_runs: 0
		}));
		const getAgentRuntimeSession = vi.fn(async () => ({
			id: 'runtime_session_existing',
			tenant_id: 'rainer',
			agent_tenant: 'rainer',
			session_id: 'sess_existing_123',
			status: 'active',
			trigger_mode: 'schedule',
			metadata: {},
			created_at: '2026-03-28T00:00:00.000Z',
			updated_at: '2026-03-28T00:00:00.000Z'
		}));
		const storage = {
			getTenant: () => 'rainer',
			getAgentRuntimePolicy,
			getAgentRuntimeUsage,
			getAgentRuntimeSession,
			openDueScheduledTasks,
			listTasks,
			createAgentRuntimeRun,
			upsertAgentRuntimeSession
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'trigger',
			wake_kind: 'duty',
			now: '2026-03-28T16:00:00.000Z'
		}, { storage: storage as any });

		expect(result.triggered).toBe(true);
		expect(result.resolved_session_id).toBe('sess_existing_123');
		expect(result.session_source).toBe('stored');
		expect(result.runner_contract?.resume_session_id).toBe('sess_existing_123');
		expect(createAgentRuntimeRun).toHaveBeenCalledWith(expect.objectContaining({
			session_id: 'sess_existing_123'
		}));
		expect(upsertAgentRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
			session_id: 'sess_existing_123'
		}));
	});

	it('rejects non-boolean include_assigned in trigger', async () => {
		const storage = {
			getTenant: () => 'rainer',
			getAgentRuntimePolicy: vi.fn(async () => null),
			getAgentRuntimeUsage: vi.fn(async () => ({
				agent_tenant: 'rainer',
				since: '2026-03-28T00:00:00.000Z',
				total_runs: 0,
				duty_runs: 0,
				impulse_runs: 0
			})),
			openDueScheduledTasks: vi.fn(),
			listTasks: vi.fn(),
			createAgentRuntimeRun: vi.fn()
		};

		const result = await handleRuntimeTool('mind_runtime', {
			action: 'trigger',
			include_assigned: 'yes'
		}, { storage: storage as any });

		expect(result.error).toMatch(/include_assigned must be a boolean/i);
		expect(storage.openDueScheduledTasks).not.toHaveBeenCalled();
	});
});
