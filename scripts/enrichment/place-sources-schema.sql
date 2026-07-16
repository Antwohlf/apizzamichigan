-- Shared source provenance table for APizzaMichigan/TacoBoutMichigan.
--
-- Local-first rollout:
--   psql pizza_enrichment < scripts/enrichment/place-sources-schema.sql
--
-- This table is intentionally shared across verticals. The first backfill phase
-- should only insert entity_type='pizza'.

CREATE TABLE IF NOT EXISTS place_sources (
  id BIGSERIAL PRIMARY KEY,

  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  place_id BIGINT NOT NULL,

  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,

  license TEXT,
  attribution TEXT,

  data JSONB NOT NULL DEFAULT '{}'::jsonb,

  match_confidence NUMERIC(5, 4),
  match_method TEXT,

  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (entity_type, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_place_sources_place
  ON place_sources(entity_type, place_id);

CREATE INDEX IF NOT EXISTS idx_place_sources_source
  ON place_sources(source, source_id);
