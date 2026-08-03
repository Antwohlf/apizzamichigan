-- Local lifecycle audit migration.
-- Run on the iMac: psql -d pizza_enrichment -f scripts/enrichment/local-lifecycle-history-migration.sql

CREATE TABLE IF NOT EXISTS place_lifecycle_history (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  place_id BIGINT NOT NULL,
  previous_lifecycle_status TEXT,
  previous_replaced_by_id BIGINT,
  lifecycle_status TEXT,
  replaced_by_id BIGINT,
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_lifecycle_history_place
  ON place_lifecycle_history (entity_type, place_id, created_at DESC);

ALTER TABLE pizza_places
  DROP CONSTRAINT IF EXISTS pizza_places_lifecycle_replacement_consistency,
  ADD CONSTRAINT pizza_places_lifecycle_replacement_consistency
    CHECK (lifecycle_status = 'replaced' OR lifecycle_replaced_by_id IS NULL) NOT VALID,
  DROP CONSTRAINT IF EXISTS pizza_places_replaced_requires_successor,
  ADD CONSTRAINT pizza_places_replaced_requires_successor
    CHECK (lifecycle_status IS DISTINCT FROM 'replaced' OR lifecycle_replaced_by_id IS NOT NULL) NOT VALID;

ALTER TABLE taco_places
  DROP CONSTRAINT IF EXISTS taco_places_lifecycle_replacement_consistency,
  ADD CONSTRAINT taco_places_lifecycle_replacement_consistency
    CHECK (lifecycle_status = 'replaced' OR lifecycle_replaced_by_id IS NULL) NOT VALID,
  DROP CONSTRAINT IF EXISTS taco_places_replaced_requires_successor,
  ADD CONSTRAINT taco_places_replaced_requires_successor
    CHECK (lifecycle_status IS DISTINCT FROM 'replaced' OR lifecycle_replaced_by_id IS NOT NULL) NOT VALID;
