-- Migration 003: Add surface_count column to observations
-- Tracks how many times an observation has been returned in search results.
-- Incremented by updateSurfacingEffects() during hybrid search side effects.

ALTER TABLE observations ADD COLUMN IF NOT EXISTS surface_count INTEGER NOT NULL DEFAULT 0;
