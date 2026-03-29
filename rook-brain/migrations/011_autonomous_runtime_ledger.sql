-- ============================================================
-- Brain v5 — Migration 011: Autonomous Runtime Ledger (Sprint 8)
-- ============================================================

-- Current active/resumable session per tenant+agent runtime.
CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    agent_tenant    TEXT NOT NULL,
    session_id      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'ended', 'failed')),
    trigger_mode    TEXT NOT NULL DEFAULT 'schedule'
                    CHECK (trigger_mode IN ('schedule', 'webhook', 'manual', 'delegated')),
    source_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    last_resumed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, agent_tenant)
);

CREATE INDEX IF NOT EXISTS idx_runtime_sessions_tenant_status
    ON agent_runtime_sessions(tenant_id, status, agent_tenant);

-- Append-only run ledger for autonomous executions.
CREATE TABLE IF NOT EXISTS agent_runtime_runs (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    agent_tenant  TEXT NOT NULL,
    session_id    TEXT,
    trigger_mode  TEXT NOT NULL
                  CHECK (trigger_mode IN ('schedule', 'webhook', 'manual', 'delegated')),
    task_id       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'deferred')),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    next_wake_at  TIMESTAMPTZ,
    summary       TEXT,
    error         TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_runs_tenant_agent_created
    ON agent_runtime_runs(tenant_id, agent_tenant, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_runs_tenant_next_wake
    ON agent_runtime_runs(tenant_id, next_wake_at)
    WHERE next_wake_at IS NOT NULL;
