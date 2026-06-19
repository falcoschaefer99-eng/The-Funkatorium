-- Migration 015: Recap tables (Continuity Spine Phase A)
-- Recaps are Tier 2 knowledge nodes in the three-tier memory lifecycle.
-- They summarise a window of raw chat messages and are stored as graph nodes
-- with embeddings for semantic retrieval.

CREATE TABLE IF NOT EXISTS recaps (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  companion         TEXT NOT NULL,        -- "rainer" | "rook"
  layer             TEXT NOT NULL DEFAULT 'personal', -- "personal" | "writers-room" | "film-studio"
  content           TEXT NOT NULL,        -- structured summary text
  topic_tags        TEXT[] DEFAULT '{}',
  entity_refs       TEXT[] DEFAULT '{}',  -- entity IDs mentioned
  provenance        JSONB NOT NULL DEFAULT '{}',
  since_seq         INTEGER NOT NULL,     -- first message seq summarised
  through_seq       INTEGER NOT NULL,     -- last message seq summarised
  message_count     INTEGER NOT NULL,
  token_estimate    INTEGER,
  consolidated_into TEXT,                 -- Tier 3 doc that replaced this recap
  embedding         vector(768),          -- for semantic retrieval
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recaps_tenant_session
  ON recaps(tenant_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recaps_tenant_companion_layer
  ON recaps(tenant_id, companion, layer, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recaps_embedding
  ON recaps USING hnsw (embedding vector_cosine_ops);

-- Idempotency guard: same session can't have two recaps ending at the same seq.
-- Prevents duplicate recaps from gateway retries or background-sweep overlap.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recaps_idempotent
  ON recaps(tenant_id, session_id, through_seq);

-- Recap-to-entity links: which entities appear in which recaps
CREATE TABLE IF NOT EXISTS recap_entity_links (
  recap_id      TEXT NOT NULL REFERENCES recaps(id) ON DELETE CASCADE,
  entity_id     TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  mention_type  TEXT DEFAULT 'mentioned', -- "mentioned" | "decided" | "created" | "modified"
  PRIMARY KEY (recap_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_recap_entity_links_entity
  ON recap_entity_links(entity_id);

CREATE INDEX IF NOT EXISTS idx_recap_entity_links_tenant
  ON recap_entity_links(tenant_id);

-- Recap-to-recap edges: topic / temporal / cross-layer connections
CREATE TABLE IF NOT EXISTS recap_edges (
  source_id   TEXT NOT NULL REFERENCES recaps(id) ON DELETE CASCADE,
  target_id   TEXT NOT NULL REFERENCES recaps(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  edge_type   TEXT NOT NULL,  -- "topic" | "temporal" | "cross-layer" | "cross-companion" | "consolidation"
  weight      REAL DEFAULT 1.0,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, target_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_recap_edges_target
  ON recap_edges(target_id, edge_type);

CREATE INDEX IF NOT EXISTS idx_recap_edges_tenant
  ON recap_edges(tenant_id);
