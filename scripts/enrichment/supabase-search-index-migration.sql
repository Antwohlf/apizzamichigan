-- Public search indexes for APizzaMichigan and TacoBoutMichigan.
-- Apply after the corresponding table columns exist. Every statement is
-- idempotent and safe to run again during future schema updates.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The public map searches these fields with case-insensitive substring
-- matching. Trigram indexes keep that existing behavior usable as the tables
-- grow without changing the public API or search ranking.
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_name_trgm
  ON pizza_places USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_address_trgm
  ON pizza_places USING gin (address gin_trgm_ops)
  WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_style_trgm
  ON pizza_places USING gin (style gin_trgm_ops)
  WHERE style IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_brand_trgm
  ON pizza_places USING gin (brand gin_trgm_ops)
  WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_operator_trgm
  ON pizza_places USING gin (operator gin_trgm_ops)
  WHERE operator IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_taco_places_search_name_trgm
  ON taco_places USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_address_trgm
  ON taco_places USING gin (address gin_trgm_ops)
  WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_style_trgm
  ON taco_places USING gin (style gin_trgm_ops)
  WHERE style IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pizza_places_search_status
  ON pizza_places (status)
  WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pizza_places_search_price_range
  ON pizza_places (price_range)
  WHERE price_range IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_status
  ON taco_places (status)
  WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_price
  ON taco_places (price)
  WHERE price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pizza_places_search_state
  ON pizza_places (state)
  WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taco_places_search_state
  ON taco_places (state)
  WHERE state IS NOT NULL;
