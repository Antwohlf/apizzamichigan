-- Local PostgreSQL Schema for Data Enrichment Pipeline
-- Run on iMac: psql pizza_enrichment < scripts/enrichment/local-schema.sql
--
-- This creates tables that mirror Supabase structure plus local-only tracking tables.
-- Generated: 2026-02-01

-- ============================================================
-- PIZZA_PLACES: Mirror of Supabase table
-- ============================================================

CREATE TABLE IF NOT EXISTS pizza_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  google_place_id TEXT UNIQUE,
  state TEXT,
  status TEXT DEFAULT 'unvisited' CHECK (status IN ('visited', 'unvisited', 'golden')),
  style TEXT,
  price TEXT CHECK (price IN ('$', '$$', '$$$', '$$$$')),
  rating NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Enrichment columns
  address_source TEXT CHECK (address_source IN ('website', 'osm', 'geocoded')),
  price_range TEXT CHECK (price_range IN ('$', '$$', '$$$', '$$$$')),
  style_confidence TEXT CHECK (style_confidence IN ('confirmed', 'inferred')),
  website_url TEXT,
  phone TEXT,
  hours JSONB,
  enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriched', 'failed')),
  last_enriched_at TIMESTAMPTZ,
  scrape_method TEXT CHECK (scrape_method IN ('fetch', 'failed')),
  scrape_notes TEXT
);

-- ============================================================
-- TACO_PLACES: Mirror of Supabase table
-- ============================================================

CREATE TABLE IF NOT EXISTS taco_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  google_place_id TEXT UNIQUE,
  state TEXT,
  status TEXT DEFAULT 'unvisited' CHECK (status IN ('visited', 'unvisited', 'golden')),
  style TEXT,
  price TEXT CHECK (price IN ('$', '$$', '$$$', '$$$$')),
  rating NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Enrichment columns
  address_source TEXT CHECK (address_source IN ('website', 'osm', 'geocoded')),
  price_range TEXT CHECK (price_range IN ('$', '$$', '$$$', '$$$$')),
  style_confidence TEXT CHECK (style_confidence IN ('confirmed', 'inferred')),
  website_url TEXT,
  phone TEXT,
  hours JSONB,
  enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriched', 'failed')),
  last_enriched_at TIMESTAMPTZ,
  scrape_method TEXT CHECK (scrape_method IN ('fetch', 'failed')),
  scrape_notes TEXT
);

-- ============================================================
-- ENRICHMENT_LOG: Track all enrichment attempts (local only)
-- ============================================================

CREATE TABLE IF NOT EXISTS enrichment_log (
  id SERIAL PRIMARY KEY,
  osm_id TEXT NOT NULL,  -- e.g., "osm:node/12345"
  place_type TEXT NOT NULL CHECK (place_type IN ('pizza', 'taco')),
  phase TEXT NOT NULL,  -- 'osm_extract', 'scrape', 'classify'
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SYNC_STATE: Track sync history with Supabase (local only)
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_state (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  records_synced INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- ENRICHMENT_QUEUE: Simple queue for processing (local only)
-- Alternative to Redis if you want simpler setup
-- ============================================================

CREATE TABLE IF NOT EXISTS enrichment_queue (
  id SERIAL PRIMARY KEY,
  osm_id TEXT NOT NULL UNIQUE,
  place_type TEXT NOT NULL CHECK (place_type IN ('pizza', 'taco')),
  phase TEXT NOT NULL,  -- 'osm_extract', 'scrape', 'classify'
  priority INTEGER DEFAULT 0,  -- Higher = process first
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- INDEXES
-- ============================================================

-- For finding places by OSM ID
CREATE INDEX IF NOT EXISTS idx_pizza_osm_id ON pizza_places(google_place_id) WHERE google_place_id LIKE 'osm:%';
CREATE INDEX IF NOT EXISTS idx_taco_osm_id ON taco_places(google_place_id) WHERE google_place_id LIKE 'osm:%';

-- For finding places pending enrichment
CREATE INDEX IF NOT EXISTS idx_pizza_pending ON pizza_places(enrichment_status) WHERE enrichment_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_taco_pending ON taco_places(enrichment_status) WHERE enrichment_status = 'pending';

-- For enrichment log queries
CREATE INDEX IF NOT EXISTS idx_log_osm_id ON enrichment_log(osm_id);
CREATE INDEX IF NOT EXISTS idx_log_phase ON enrichment_log(phase, status);
CREATE INDEX IF NOT EXISTS idx_log_created ON enrichment_log(created_at DESC);

-- For queue processing
CREATE INDEX IF NOT EXISTS idx_queue_pending ON enrichment_queue(priority DESC, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_osm_id ON enrichment_queue(osm_id);

-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- Enrichment progress summary
CREATE OR REPLACE VIEW enrichment_progress AS
SELECT
  'pizza' as place_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE enrichment_status = 'pending') as pending,
  COUNT(*) FILTER (WHERE enrichment_status = 'enriched') as enriched,
  COUNT(*) FILTER (WHERE enrichment_status = 'failed') as failed
FROM pizza_places
WHERE google_place_id LIKE 'osm:%'
UNION ALL
SELECT
  'taco' as place_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE enrichment_status = 'pending') as pending,
  COUNT(*) FILTER (WHERE enrichment_status = 'enriched') as enriched,
  COUNT(*) FILTER (WHERE enrichment_status = 'failed') as failed
FROM taco_places
WHERE google_place_id LIKE 'osm:%';

-- Phase progress summary
CREATE OR REPLACE VIEW phase_progress AS
SELECT
  phase,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'success') as success,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
  AVG(duration_ms) FILTER (WHERE status = 'success') as avg_duration_ms
FROM enrichment_log
GROUP BY phase
ORDER BY phase;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get next item from queue
CREATE OR REPLACE FUNCTION get_next_queue_item(p_phase TEXT)
RETURNS TABLE(id INTEGER, osm_id TEXT, place_type TEXT) AS $$
BEGIN
  RETURN QUERY
  UPDATE enrichment_queue
  SET status = 'processing', started_at = NOW(), attempts = attempts + 1
  WHERE id = (
    SELECT eq.id FROM enrichment_queue eq
    WHERE eq.phase = p_phase AND eq.status = 'pending'
    ORDER BY eq.priority DESC, eq.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING enrichment_queue.id, enrichment_queue.osm_id, enrichment_queue.place_type;
END;
$$ LANGUAGE plpgsql;

-- Mark queue item as completed
CREATE OR REPLACE FUNCTION complete_queue_item(p_id INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE enrichment_queue
  SET status = 'completed', completed_at = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Mark queue item as failed
CREATE OR REPLACE FUNCTION fail_queue_item(p_id INTEGER, p_error TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE enrichment_queue
  SET status = 'failed', last_error = p_error, completed_at = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INITIAL DATA LOAD (run after creating tables)
-- ============================================================

-- To populate the queue from the OSM cache, run:
-- node scripts/enrichment/populate-queue.mjs

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Check tables exist:
-- \dt

-- Check enrichment progress:
-- SELECT * FROM enrichment_progress;

-- Check queue status:
-- SELECT phase, status, COUNT(*) FROM enrichment_queue GROUP BY phase, status;
