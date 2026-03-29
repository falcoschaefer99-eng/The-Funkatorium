-- ============================================================
-- Brain v5 — Migration 012: Runtime Policy + Budgeting (Sprint 8)
-- ============================================================

-- Per-agent runtime execution policy (lean/balanced/explore) with wake budgets.
CREATE TABLE IF NOT EXISTS agent_runtime_policies (
    id                                  TEXT PRIMARY KEY,
    tenant_id                           TEXT NOT NULL,
    agent_tenant                        TEXT NOT NULL,
    execution_mode                      TEXT NOT NULL DEFAULT 'balanced'
                                        CHECK (execution_mode IN ('lean', 'balanced', 'explore')),
    daily_wake_budget                   INTEGER NOT NULL DEFAULT 8
                                        CHECK (daily_wake_budget BETWEEN 1 AND 48),
    impulse_wake_budget                 INTEGER NOT NULL DEFAULT 4
                                        CHECK (impulse_wake_budget BETWEEN 0 AND 24),
    reserve_wakes                       INTEGER NOT NULL DEFAULT 1
                                        CHECK (reserve_wakes BETWEEN 0 AND 24),
    min_impulse_interval_minutes        INTEGER NOT NULL DEFAULT 90
                                        CHECK (min_impulse_interval_minutes BETWEEN 0 AND 1440),
    max_tool_calls_per_run              INTEGER NOT NULL DEFAULT 20
                                        CHECK (max_tool_calls_per_run BETWEEN 1 AND 200),
    max_parallel_delegations            INTEGER NOT NULL DEFAULT 1
                                        CHECK (max_parallel_delegations BETWEEN 0 AND 10),
    require_priority_clear_for_impulse  BOOLEAN NOT NULL DEFAULT true,
    updated_by                          TEXT,
    metadata                            JSONB NOT NULL DEFAULT '{}',
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, agent_tenant)
);

CREATE INDEX IF NOT EXISTS idx_runtime_policies_tenant_agent
    ON agent_runtime_policies(tenant_id, agent_tenant);
