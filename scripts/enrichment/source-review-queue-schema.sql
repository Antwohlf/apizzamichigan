-- Durable local review queue for source records that should not be imported
-- automatically.
--
-- Local-first rollout:
--   psql pizza_enrichment < scripts/enrichment/source-review-queue-schema.sql

CREATE TABLE IF NOT EXISTS source_review_queue (
  id BIGSERIAL PRIMARY KEY,

  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  review_kind TEXT NOT NULL CHECK (review_kind IN ('ambiguous', 'likely_new')),

  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  source_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  nearest_place_id BIGINT,
  nearest_google_place_id TEXT,
  nearest_place_name TEXT,
  nearest_distance_m NUMERIC(10, 3),
  nearest_name_score NUMERIC(8, 4),
  review_reason TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'linked', 'rejected', 'ignored')),
  decision TEXT,
  canonical_place_id BIGINT,
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,

  report_file TEXT,
  report_generated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (entity_type, source, source_id, review_kind)
);

CREATE INDEX IF NOT EXISTS idx_source_review_queue_status
  ON source_review_queue(entity_type, status, review_kind);

CREATE INDEX IF NOT EXISTS idx_source_review_queue_source
  ON source_review_queue(source, source_id);

CREATE INDEX IF NOT EXISTS idx_source_review_queue_nearest_place
  ON source_review_queue(entity_type, nearest_place_id);
