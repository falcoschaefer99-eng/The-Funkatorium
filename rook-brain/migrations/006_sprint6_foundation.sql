-- ============================================================
-- Brain v5 — Migration 006: Sprint 6 Foundation
-- ============================================================

-- 1. Rename co_surfacing -> memory_cascade
ALTER TABLE co_surfacing RENAME TO memory_cascade;
ALTER INDEX idx_cosurface_tenant_count RENAME TO idx_cascade_tenant_count;

-- 2. Processing log (engagement audit trail)
-- NOTE: observation_sits was in the spec but never created. Fresh table.
CREATE TABLE processing_log (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    observation_id  TEXT NOT NULL,
    processing_note TEXT,
    charge_at_processing TEXT[] DEFAULT '{}',
    somatic_at_processing TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_processing_tenant_obs ON processing_log(tenant_id, observation_id);

-- 3. Observation versions (edit history)
CREATE TABLE observation_versions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    observation_id  TEXT NOT NULL,
    version_num     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    texture         JSONB NOT NULL DEFAULT '{}',
    change_reason   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_versions_tenant_obs ON observation_versions(tenant_id, observation_id);
CREATE UNIQUE INDEX idx_versions_obs_num ON observation_versions(observation_id, version_num);

-- 4. Extend open_loops: paradox mode + learning_objective mode
ALTER TABLE open_loops
    ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'standard'
        CHECK (mode IN ('standard', 'learning_objective', 'paradox')),
    ADD COLUMN IF NOT EXISTS linked_entity_ids TEXT[] DEFAULT '{}';

-- 5. Extend letters: type distinction (personal/handoff/proposal)
ALTER TABLE letters
    ADD COLUMN IF NOT EXISTS letter_type TEXT DEFAULT 'personal'
        CHECK (letter_type IN ('personal', 'handoff', 'proposal'));

-- 6. Tasks table (schema foundation for Sprint 7 delegation)
CREATE TABLE tasks (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    assigned_tenant     TEXT,
    title               TEXT NOT NULL,
    description         TEXT,
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'scheduled', 'in_progress', 'done', 'deferred', 'cancelled')),
    priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('burning', 'high', 'normal', 'low', 'someday')),
    estimated_effort    TEXT,
    scheduled_wake      TIMESTAMPTZ,
    source              TEXT,
    linked_observation_ids TEXT[] DEFAULT '{}',
    linked_entity_ids   TEXT[] DEFAULT '{}',
    depends_on          TEXT[],
    completion_note     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_tenant, status);
CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_wake) WHERE scheduled_wake IS NOT NULL;

-- 7. Consolidation candidates
CREATE TABLE consolidation_candidates (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    source_observation_ids  TEXT[] NOT NULL,
    pattern_description     TEXT NOT NULL,
    suggested_territory     TEXT,
    suggested_type          TEXT NOT NULL DEFAULT 'skill'
                            CHECK (suggested_type IN ('skill', 'identity', 'synthesis')),
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'rejected', 'deferred')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at             TIMESTAMPTZ
);
CREATE INDEX idx_consolidation_tenant_status ON consolidation_candidates(tenant_id, status);

-- 8. Dispatch feedback (Karpathy scalar)
CREATE TABLE dispatch_feedback (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    agent_entity_id TEXT,
    task_type       TEXT NOT NULL,
    dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    outcome         TEXT CHECK (outcome IN ('effective', 'partial', 'ineffective', 'redirected')),
    findings_count  INTEGER DEFAULT 0,
    findings_acted  INTEGER DEFAULT 0,
    confidence_avg  REAL,
    notes           TEXT,
    reviewed_at     TIMESTAMPTZ
);
CREATE INDEX idx_dispatch_tenant_agent ON dispatch_feedback(tenant_id, agent_entity_id);
CREATE INDEX idx_dispatch_tenant_type ON dispatch_feedback(tenant_id, task_type);
