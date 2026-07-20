-- Additive public-schema migration for explicit business lifecycle.
-- Apply this in the Supabase SQL editor before setting
-- ENABLE_LIFECYCLE_SYNC=1 on the production sync service.

ALTER TABLE IF EXISTS pizza_places
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT
    CHECK (lifecycle_status IN ('closed', 'replaced', 'demolished'));

ALTER TABLE IF EXISTS pizza_places
  ADD COLUMN IF NOT EXISTS lifecycle_replaced_by_id BIGINT;

-- Forward-compatible with a future TacoBoutMichigan public table.
ALTER TABLE IF EXISTS taco_places
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT
    CHECK (lifecycle_status IN ('closed', 'replaced', 'demolished'));

ALTER TABLE IF EXISTS taco_places
  ADD COLUMN IF NOT EXISTS lifecycle_replaced_by_id BIGINT;
