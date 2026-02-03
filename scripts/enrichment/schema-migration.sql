-- Zero-Egress Data Enrichment Pipeline
-- Schema Migration for pizza_places and taco_places
-- Run this in Supabase SQL Editor
--
-- Generated: 2026-02-01

-- ============================================================
-- PIZZA_PLACES: Add enrichment columns
-- ============================================================

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS address_source TEXT
    CHECK (address_source IN ('website', 'osm', 'geocoded'));

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS price_range TEXT
    CHECK (price_range IN ('$', '$$', '$$$', '$$$$'));

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS style_confidence TEXT
    CHECK (style_confidence IN ('confirmed', 'inferred'));

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS website_url TEXT;

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS hours JSONB;

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed'));

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS scrape_method TEXT
    CHECK (scrape_method IN ('fetch', 'failed'));

ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS scrape_notes TEXT;

-- ============================================================
-- TACO_PLACES: Add enrichment columns
-- ============================================================

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS address_source TEXT
    CHECK (address_source IN ('website', 'osm', 'geocoded'));

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS price_range TEXT
    CHECK (price_range IN ('$', '$$', '$$$', '$$$$'));

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS style_confidence TEXT
    CHECK (style_confidence IN ('confirmed', 'inferred'));

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS website_url TEXT;

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS hours JSONB;

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed'));

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS scrape_method TEXT
    CHECK (scrape_method IN ('fetch', 'failed'));

ALTER TABLE taco_places
  ADD COLUMN IF NOT EXISTS scrape_notes TEXT;

-- ============================================================
-- INDEXES: Speed up enrichment queries
-- ============================================================

-- Index for finding places pending enrichment
CREATE INDEX IF NOT EXISTS idx_pizza_enrichment_status
  ON pizza_places(enrichment_status)
  WHERE enrichment_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_taco_enrichment_status
  ON taco_places(enrichment_status)
  WHERE enrichment_status = 'pending';

-- Index for finding places by OSM ID (for updates)
CREATE INDEX IF NOT EXISTS idx_pizza_google_place_id
  ON pizza_places(google_place_id)
  WHERE google_place_id LIKE 'osm:%';

CREATE INDEX IF NOT EXISTS idx_taco_google_place_id
  ON taco_places(google_place_id)
  WHERE google_place_id LIKE 'osm:%';

-- ============================================================
-- VERIFICATION: Check columns were added
-- ============================================================

-- Run this after the migration to verify:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'pizza_places'
--   AND column_name IN ('address_source', 'price_range', 'style_confidence',
--                       'website_url', 'phone', 'hours', 'enrichment_status',
--                       'last_enriched_at', 'scrape_method', 'scrape_notes');
