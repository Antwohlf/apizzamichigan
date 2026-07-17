-- Additive canonical identity layer.
-- Keeps legacy google_place_id reads working while giving every external
-- identifier an explicit source namespace.

CREATE TABLE IF NOT EXISTS place_external_ids (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  place_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, source, external_id),
  UNIQUE (entity_type, place_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_place_external_ids_place
  ON place_external_ids(entity_type, place_id);

CREATE INDEX IF NOT EXISTS idx_place_external_ids_source
  ON place_external_ids(entity_type, source, external_id);

-- Backfill only identifiers that are already present. Unknown legacy values
-- remain namespaced as legacy rather than being misclassified as Google IDs.
INSERT INTO place_external_ids (entity_type, place_id, source, external_id, is_primary)
SELECT 'pizza', p.id,
       CASE WHEN p.google_place_id LIKE 'osm:%' THEN 'osm' ELSE 'legacy' END,
       CASE WHEN p.google_place_id LIKE 'osm:%'
            THEN regexp_replace(p.google_place_id, '^osm:', '')
            ELSE p.google_place_id END,
       TRUE
FROM pizza_places p
WHERE NULLIF(btrim(p.google_place_id), '') IS NOT NULL
ON CONFLICT (entity_type, source, external_id) DO UPDATE SET
  place_id = EXCLUDED.place_id,
  is_primary = TRUE,
  updated_at = NOW();

INSERT INTO place_external_ids (entity_type, place_id, source, external_id, is_primary)
SELECT 'taco', p.id,
       CASE WHEN p.google_place_id LIKE 'osm:%' THEN 'osm' ELSE 'legacy' END,
       CASE WHEN p.google_place_id LIKE 'osm:%'
            THEN regexp_replace(p.google_place_id, '^osm:', '')
            ELSE p.google_place_id END,
       TRUE
FROM taco_places p
WHERE NULLIF(btrim(p.google_place_id), '') IS NOT NULL
ON CONFLICT (entity_type, source, external_id) DO UPDATE SET
  place_id = EXCLUDED.place_id,
  is_primary = TRUE,
  updated_at = NOW();
