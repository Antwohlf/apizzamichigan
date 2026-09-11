-- Append-only audit trail for source review decisions and reversals.
CREATE TABLE IF NOT EXISTS source_review_decision_history (
  id BIGSERIAL PRIMARY KEY,
  review_queue_id BIGINT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  previous_review_kind TEXT,
  previous_status TEXT,
  previous_decision TEXT,
  previous_canonical_place_id BIGINT,
  review_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT,
  canonical_place_id BIGINT,
  action TEXT NOT NULL,
  reviewer_notes TEXT,
  reviewed_by TEXT,
  canonical_before JSONB,
  canonical_after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade earlier installations explicitly, outside the request-handling role.
ALTER TABLE source_review_decision_history
  ADD COLUMN IF NOT EXISTS canonical_before JSONB,
  ADD COLUMN IF NOT EXISTS canonical_after JSONB;

CREATE INDEX IF NOT EXISTS idx_source_review_history_queue
  ON source_review_decision_history(review_queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_review_history_source
  ON source_review_decision_history(entity_type, source, source_id, created_at DESC);
