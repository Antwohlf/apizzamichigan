-- APizzaMichigan production schema migration.
-- Run once in the Supabase SQL Editor. Every statement is idempotent.
-- Keep lifecycle sync disabled until the read-only readiness check passes.

-- Business lifecycle is explicit and separate from personal visit status.
ALTER TABLE IF EXISTS pizza_places
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT
    CHECK (lifecycle_status IN ('closed', 'replaced', 'demolished'));

ALTER TABLE IF EXISTS pizza_places
  ADD COLUMN IF NOT EXISTS lifecycle_replaced_by_id BIGINT;

-- Forward-compatible with TacoBoutMichigan.
ALTER TABLE IF EXISTS taco_places
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT
    CHECK (lifecycle_status IN ('closed', 'replaced', 'demolished'));

ALTER TABLE IF EXISTS taco_places
  ADD COLUMN IF NOT EXISTS lifecycle_replaced_by_id BIGINT;

-- Trigram indexes support the existing case-insensitive public search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pizza_places_search_name_trgm
  ON pizza_places USING gin (name gin_trgm_ops) WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_address_trgm
  ON pizza_places USING gin (address gin_trgm_ops) WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_style_trgm
  ON pizza_places USING gin (style gin_trgm_ops) WHERE style IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_brand_trgm
  ON pizza_places USING gin (brand gin_trgm_ops) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_operator_trgm
  ON pizza_places USING gin (operator gin_trgm_ops) WHERE operator IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_taco_places_search_name_trgm
  ON taco_places USING gin (name gin_trgm_ops) WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_address_trgm
  ON taco_places USING gin (address gin_trgm_ops) WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_style_trgm
  ON taco_places USING gin (style gin_trgm_ops) WHERE style IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pizza_places_search_status
  ON pizza_places (status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_price_range
  ON pizza_places (price_range) WHERE price_range IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_status
  ON taco_places (status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_price
  ON taco_places (price) WHERE price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pizza_places_search_state
  ON pizza_places (state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_state
  ON taco_places (state) WHERE state IS NOT NULL;
