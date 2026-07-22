-- Allow the bounded browser fallback to be recorded as successful evidence.
-- Run against the local pizza_enrichment database and its Supabase counterpart.

BEGIN;

ALTER TABLE pizza_places DROP CONSTRAINT IF EXISTS pizza_places_scrape_method_check;
ALTER TABLE pizza_places
  ADD CONSTRAINT pizza_places_scrape_method_check
  CHECK (scrape_method IN ('fetch', 'browser', 'failed'));

ALTER TABLE taco_places DROP CONSTRAINT IF EXISTS taco_places_scrape_method_check;
ALTER TABLE taco_places
  ADD CONSTRAINT taco_places_scrape_method_check
  CHECK (scrape_method IN ('fetch', 'browser', 'failed'));

COMMIT;
