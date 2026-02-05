-- Extended Local PostgreSQL Schema for Multi-Agent Enrichment Pipeline
-- Run on iMac: psql pizza_enrichment < scripts/enrichment/local-schema-v2.sql
--
-- This extends local-schema.sql with tables for OpenClaw multi-agent support.
-- Generated: 2026-02-05

-- ============================================================
-- AGENT_STATE: Track OpenClaw agent sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_state (
  agent_id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'starting', 'running', 'paused', 'stopping', 'error')),
  current_job_id INTEGER,
  current_osm_id TEXT,
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  error_message TEXT,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeat ON agent_state(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_agent_status ON agent_state(status);

-- ============================================================
-- JOB_HISTORY: Detailed job history for analytics
-- ============================================================

CREATE TABLE IF NOT EXISTS job_history (
  id SERIAL PRIMARY KEY,
  job_id INTEGER,
  osm_id TEXT NOT NULL,
  place_type TEXT NOT NULL CHECK (place_type IN ('pizza', 'taco')),
  job_type TEXT NOT NULL CHECK (job_type IN ('osm_extract', 'scrape', 'classify', 'sync', 'google_places')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped', 'timeout')),
  duration_ms INTEGER,
  input_data JSONB,
  output_data JSONB,
  error_details TEXT,
  agent_id TEXT REFERENCES agent_state(agent_id),
  run_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_history_osm ON job_history(osm_id, job_type);
CREATE INDEX IF NOT EXISTS idx_job_history_agent ON job_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_job_history_run ON job_history(run_id);
CREATE INDEX IF NOT EXISTS idx_job_history_created ON job_history(created_at DESC);

-- ============================================================
-- WEBSITE_CACHE: Avoid re-fetching websites
-- ============================================================

CREATE TABLE IF NOT EXISTS website_cache (
  url TEXT PRIMARY KEY,
  final_url TEXT,
  status_code INTEGER,
  content_hash TEXT,
  extracted_data JSONB,  -- { phone, hours, menu_url, price_hints, style_hints }
  fetch_error TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_website_cache_expires ON website_cache(expires_at);

-- ============================================================
-- CLASSIFICATION_CACHE: Avoid duplicate LLM calls
-- ============================================================

CREATE TABLE IF NOT EXISTS classification_cache (
  cache_key TEXT PRIMARY KEY,  -- hash of (name + address + hints)
  place_type TEXT NOT NULL CHECK (place_type IN ('pizza', 'taco')),
  classification JSONB NOT NULL,  -- { style, price_range, confidence, reasoning }
  model TEXT NOT NULL,  -- 'ollama:llama3.2:8b', 'groq:llama-3.1-8b-instant'
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classification_cache_type ON classification_cache(place_type);

-- ============================================================
-- RATE_LIMITS: Track API usage to stay within free tiers
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  service TEXT PRIMARY KEY,  -- 'overpass', 'nominatim', 'groq', 'google_places'
  requests_today INTEGER DEFAULT 0,
  requests_this_minute INTEGER DEFAULT 0,
  last_request_at TIMESTAMPTZ,
  daily_limit INTEGER,
  minute_limit INTEGER,
  reset_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default rate limits
INSERT INTO rate_limits (service, daily_limit, minute_limit) VALUES
  ('overpass', 10000, NULL),
  ('nominatim', 86400, 1),  -- 1 req/sec = 86400/day
  ('groq', NULL, 30),
  ('google_places', 93, NULL)  -- ~2800/month = 93/day
ON CONFLICT (service) DO NOTHING;

-- ============================================================
-- PIPELINE_RUNS: Track daily pipeline executions
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  config JSONB,  -- { place_types, phases, limits }
  summary JSONB,  -- { processed, success, failed, by_phase }
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

-- ============================================================
-- GOOGLE_PLACES_QUEUE: High-value places for Google API lookups
-- ============================================================

CREATE TABLE IF NOT EXISTS google_places_queue (
  id SERIAL PRIMARY KEY,
  osm_id TEXT NOT NULL UNIQUE,
  place_type TEXT NOT NULL CHECK (place_type IN ('pizza', 'taco')),
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  state TEXT,
  priority INTEGER DEFAULT 0,  -- Higher = process first
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  result JSONB,  -- { website, phone, rating, price_level }
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_google_queue_pending ON google_places_queue(priority DESC, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_google_queue_state ON google_places_queue(state);

-- ============================================================
-- EXTEND ENRICHMENT_QUEUE WITH PRIORITY
-- ============================================================

-- Add priority column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enrichment_queue' AND column_name = 'priority'
  ) THEN
    ALTER TABLE enrichment_queue ADD COLUMN priority INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add agent tracking columns to place tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pizza_places' AND column_name = 'enrichment_agent'
  ) THEN
    ALTER TABLE pizza_places ADD COLUMN enrichment_agent TEXT;
    ALTER TABLE pizza_places ADD COLUMN enrichment_run_id INTEGER;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'taco_places' AND column_name = 'enrichment_agent'
  ) THEN
    ALTER TABLE taco_places ADD COLUMN enrichment_agent TEXT;
    ALTER TABLE taco_places ADD COLUMN enrichment_run_id INTEGER;
  END IF;
END $$;

-- ============================================================
-- PRIORITY CALCULATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_priority(p_state TEXT, p_country TEXT DEFAULT 'US')
RETURNS INTEGER AS $$
DECLARE
  priority INTEGER;
BEGIN
  -- Michigan first (home state)
  IF p_state = 'MI' THEN RETURN 100; END IF;

  -- Major US states
  IF p_state IN ('NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'NJ') THEN RETURN 95; END IF;

  -- Other US states (2-letter codes that are US states)
  IF p_state ~ '^[A-Z]{2}$' AND p_country = 'US' THEN RETURN 80; END IF;

  -- Canada
  IF p_country = 'CA' OR p_state IN ('ON', 'QC', 'BC', 'AB') THEN RETURN 60; END IF;

  -- Mexico
  IF p_country = 'MX' THEN RETURN 55; END IF;

  -- Europe
  IF p_country IN ('GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'PT', 'IE', 'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'GR', 'HU', 'RO') THEN RETURN 50; END IF;

  -- Default
  RETURN 30;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- AGENT HEARTBEAT CLEANUP
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_stale_agents()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Mark agents as error if no heartbeat in 5 minutes
  UPDATE agent_state
  SET status = 'error',
      error_message = 'No heartbeat received in 5 minutes'
  WHERE status = 'running'
    AND last_heartbeat < NOW() - INTERVAL '5 minutes';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- Release jobs from stale agents
  UPDATE enrichment_queue
  SET status = 'pending',
      started_at = NULL
  WHERE status = 'processing'
    AND started_at < NOW() - INTERVAL '10 minutes';

  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- MATERIALIZED VIEW: ENRICHMENT DASHBOARD
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS enrichment_dashboard AS
SELECT
  place_type,
  COUNT(*) as total_places,
  COUNT(*) FILTER (WHERE enrichment_status = 'pending') as pending,
  COUNT(*) FILTER (WHERE enrichment_status = 'enriched') as enriched,
  COUNT(*) FILTER (WHERE enrichment_status = 'failed') as failed,
  COUNT(*) FILTER (WHERE address IS NOT NULL) as has_address,
  COUNT(*) FILTER (WHERE style IS NOT NULL) as has_style,
  COUNT(*) FILTER (WHERE price IS NOT NULL OR price_range IS NOT NULL) as has_price,
  COUNT(*) FILTER (WHERE website_url IS NOT NULL) as has_website,
  COUNT(*) FILTER (WHERE phone IS NOT NULL) as has_phone,
  ROUND(100.0 * COUNT(*) FILTER (WHERE address IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as address_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE style IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as style_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE website_url IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as website_pct
FROM (
  SELECT 'pizza' as place_type, * FROM pizza_places WHERE google_place_id LIKE 'osm:%'
  UNION ALL
  SELECT 'taco' as place_type, * FROM taco_places WHERE google_place_id LIKE 'osm:%'
) combined
GROUP BY place_type;

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_enrichment_dashboard()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW enrichment_dashboard;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VIEW: AGENT STATUS SUMMARY
-- ============================================================

CREATE OR REPLACE VIEW agent_status_summary AS
SELECT
  agent_id,
  workspace,
  status,
  jobs_completed,
  jobs_failed,
  ROUND(EXTRACT(EPOCH FROM (NOW() - last_heartbeat))) as seconds_since_heartbeat,
  ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 3600, 1) as hours_running,
  error_message
FROM agent_state
ORDER BY
  CASE status
    WHEN 'running' THEN 1
    WHEN 'starting' THEN 2
    WHEN 'paused' THEN 3
    WHEN 'stopping' THEN 4
    WHEN 'error' THEN 5
    ELSE 6
  END,
  started_at DESC;

-- ============================================================
-- VIEW: RATE LIMIT STATUS
-- ============================================================

CREATE OR REPLACE VIEW rate_limit_status AS
SELECT
  service,
  requests_today,
  daily_limit,
  CASE
    WHEN daily_limit IS NOT NULL THEN ROUND(100.0 * requests_today / daily_limit, 1)
    ELSE NULL
  END as daily_pct_used,
  requests_this_minute,
  minute_limit,
  last_request_at,
  CASE
    WHEN minute_limit IS NOT NULL AND requests_this_minute >= minute_limit THEN 'THROTTLED'
    WHEN daily_limit IS NOT NULL AND requests_today >= daily_limit THEN 'DAILY_LIMIT'
    ELSE 'OK'
  END as status
FROM rate_limits;

-- ============================================================
-- RESET DAILY RATE LIMITS (call at midnight)
-- ============================================================

CREATE OR REPLACE FUNCTION reset_daily_rate_limits()
RETURNS void AS $$
BEGIN
  UPDATE rate_limits
  SET requests_today = 0,
      reset_at = NOW() + INTERVAL '1 day'
  WHERE reset_at IS NULL OR reset_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check all new tables exist:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;

-- Check agent status:
-- SELECT * FROM agent_status_summary;

-- Check rate limits:
-- SELECT * FROM rate_limit_status;

-- Check dashboard (after refresh):
-- SELECT refresh_enrichment_dashboard(); SELECT * FROM enrichment_dashboard;
