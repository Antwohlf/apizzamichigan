-- Slowlane LLM enrichment schema (LOCAL ONLY)
-- Adds menu parsing outputs + QA flags.

BEGIN;

-- Menu parsing outputs on pizza_places
ALTER TABLE pizza_places
  ADD COLUMN IF NOT EXISTS menu_data JSONB,
  ADD COLUMN IF NOT EXISTS menu_parse_confidence TEXT,
  ADD COLUMN IF NOT EXISTS menu_parse_notes TEXT,
  ADD COLUMN IF NOT EXISTS menu_last_parsed_at TIMESTAMPTZ;

-- QA flags table
CREATE TABLE IF NOT EXISTS qa_flags (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL,
  place_type TEXT NOT NULL DEFAULT 'pizza',
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  message TEXT NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_flags_place_id ON qa_flags(place_id);
CREATE INDEX IF NOT EXISTS idx_qa_flags_created_at ON qa_flags(created_at);

COMMIT;
