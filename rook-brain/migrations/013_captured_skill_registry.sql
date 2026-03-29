-- ============================================================
-- Brain v5 — Migration 013: Captured Skill Registry (Sprint 9)
-- ============================================================

-- Versioned captured-skill artifacts.
-- These remain separate from observations/memory: this table stores
-- reusable procedural skill records with explicit review state.
CREATE TABLE IF NOT EXISTS captured_skills (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL,
    skill_key              TEXT NOT NULL,
    version                INTEGER NOT NULL DEFAULT 1
                           CHECK (version >= 1),
    layer                  TEXT NOT NULL DEFAULT 'captured'
                           CHECK (layer IN ('fixed', 'captured', 'derived')),
    status                 TEXT NOT NULL DEFAULT 'candidate'
                           CHECK (status IN ('candidate', 'accepted', 'degraded', 'retired')),
    name                   TEXT NOT NULL,
    domain                 TEXT,
    environment            TEXT,
    task_type              TEXT,
    agent_tenant           TEXT,
    source_runtime_run_id  TEXT REFERENCES agent_runtime_runs(id) ON DELETE SET NULL,
    source_task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    source_observation_id  TEXT REFERENCES observations(id) ON DELETE SET NULL,
    provenance             JSONB NOT NULL DEFAULT '{}',
    metadata               JSONB NOT NULL DEFAULT '{}',
    review_note            TEXT,
    reviewed_by            TEXT,
    reviewed_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, skill_key, version)
);

CREATE INDEX IF NOT EXISTS idx_captured_skills_tenant_status_created
    ON captured_skills(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captured_skills_tenant_skill_version
    ON captured_skills(tenant_id, skill_key, version DESC);

CREATE INDEX IF NOT EXISTS idx_captured_skills_tenant_provenance
    ON captured_skills(tenant_id, source_runtime_run_id, source_task_id);
