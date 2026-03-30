-- ============================================================
-- Brain v5 — Migration 014: Captured Skill Registry Perf (Sprint 10)
-- ============================================================

-- Hot path for mind_skill list with no status/layer filters.
-- (tenant_id, created_at DESC) supports newest-first browse without full scan.
CREATE INDEX IF NOT EXISTS idx_captured_skills_tenant_created
    ON captured_skills(tenant_id, created_at DESC);
