# Source Provenance Schema Design

This is a design document, not an applied migration. The next ingestion sources
should not write directly into overloaded columns like `google_place_id`.

The goal is to let one place carry several source identities and several
candidate values for the same field while keeping the current production tables
stable.

## Goals

- Preserve source-specific external IDs without overloading one column.
- Track source license, attribution, retrieval time, and retention policy.
- Store field-level provenance for values like website, phone, hours, style, and
  coordinates.
- Keep canonical `pizza_places` and `taco_places` serving production while new
  source evaluation happens in additive tables.
- Support future sources such as FSQ OS Places, All the Places, Overture,
  Wikidata, DENUE, and government datasets.

## Proposed Tables

### `data_sources`

Registry of source systems and their reuse policy.

```sql
CREATE TABLE data_sources (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN (
      'open_poi',
      'open_government',
      'official_website',
      'manual',
      'user_suggestion',
      'ai_inference',
      'navigation_only',
      'licensed_api'
    )
  ),
  license_id TEXT,
  license_url TEXT,
  attribution_text TEXT,
  permanent_storage_allowed BOOLEAN NOT NULL DEFAULT false,
  redistribution_allowed BOOLEAN NOT NULL DEFAULT false,
  commercial_use_allowed BOOLEAN NOT NULL DEFAULT false,
  ingestion_allowed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed examples:

```sql
INSERT INTO data_sources (
  source_system,
  display_name,
  source_type,
  license_id,
  license_url,
  attribution_text,
  permanent_storage_allowed,
  redistribution_allowed,
  commercial_use_allowed,
  ingestion_allowed,
  notes
) VALUES
  (
    'osm',
    'OpenStreetMap',
    'open_poi',
    'ODbL-1.0',
    'https://www.openstreetmap.org/copyright',
    'Data copyright OpenStreetMap contributors',
    true,
    true,
    true,
    true,
    'Track ODbL attribution/share-alike obligations separately before broad redistribution.'
  ),
  (
    'fsq_os_places',
    'Foursquare OS Places',
    'open_poi',
    'Apache-2.0',
    'https://opensource.foursquare.com/places-notice-txt/',
    'Copyright Foursquare Labs, Inc.',
    true,
    true,
    true,
    true,
    'Use open dataset releases, not commercial Places API, for canonical ingestion.'
  ),
  (
    'google_maps',
    'Google Maps',
    'navigation_only',
    NULL,
    'https://cloud.google.com/maps-platform/terms',
    NULL,
    false,
    false,
    false,
    false,
    'Outbound navigation only. Do not ingest as durable source of record.'
  );
```

### `place_external_ids`

External identifiers for existing canonical places. This avoids pretending that
`google_place_id` can represent OSM, FSQ, ATP, Overture, Wikidata, and Google at
the same time.

```sql
CREATE TABLE place_external_ids (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  place_id BIGINT NOT NULL,
  source_system TEXT NOT NULL REFERENCES data_sources(source_system),
  external_id TEXT NOT NULL,
  source_url TEXT,
  source_record JSONB,
  match_confidence NUMERIC(5, 4),
  match_method TEXT CHECK (
    match_method IN (
      'imported_primary',
      'exact_external_id',
      'exact_name_address',
      'spatial_name',
      'manual_confirmed',
      'candidate'
    )
  ),
  verified_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, source_system, external_id),
  UNIQUE (entity_type, place_id, source_system, external_id)
);

CREATE INDEX idx_place_external_ids_place
  ON place_external_ids(entity_type, place_id);

CREATE INDEX idx_place_external_ids_source
  ON place_external_ids(source_system, external_id);
```

### `place_field_sources`

Field-level source evidence. A single canonical field can have multiple source
values and one chosen normalized value.

```sql
CREATE TABLE place_field_sources (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  place_id BIGINT NOT NULL,
  field_name TEXT NOT NULL,
  source_system TEXT NOT NULL REFERENCES data_sources(source_system),
  source_external_id TEXT,
  source_url TEXT,
  source_value JSONB,
  normalized_value JSONB,
  evidence_text TEXT,
  trust_level TEXT NOT NULL CHECK (
    trust_level IN ('manual', 'official', 'open_data', 'source_derived', 'ai_inferred', 'unreviewed')
  ),
  confidence NUMERIC(5, 4),
  permanent_storage_allowed BOOLEAN NOT NULL DEFAULT false,
  redistribution_allowed BOOLEAN NOT NULL DEFAULT false,
  commercial_use_allowed BOOLEAN NOT NULL DEFAULT false,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_place_field_sources_place
  ON place_field_sources(entity_type, place_id, field_name);

CREATE INDEX idx_place_field_sources_source
  ON place_field_sources(source_system, source_external_id);

CREATE INDEX idx_place_field_sources_expiry
  ON place_field_sources(expires_at)
  WHERE expires_at IS NOT NULL;
```

### `source_import_runs`

Audit trail for source downloads and import attempts.

```sql
CREATE TABLE source_import_runs (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL REFERENCES data_sources(source_system),
  source_dataset_name TEXT,
  source_dataset_version TEXT,
  source_url TEXT,
  license_url TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  records_read INTEGER NOT NULL DEFAULT 0,
  records_matched INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_flagged INTEGER NOT NULL DEFAULT 0,
  summary JSONB,
  error_message TEXT
);
```

## Initial Source System Names

Use stable source keys in code and database records:

| Source Key | Meaning |
| --- | --- |
| `osm` | OpenStreetMap / Overpass |
| `fsq_os_places` | Foursquare OS Places open dataset |
| `all_the_places` | All the Places output |
| `overture_places` | Overture Places theme |
| `wikidata` | Wikidata structured data |
| `government_open_data` | Generic government source when no dedicated key exists yet |
| `denue` | INEGI DENUE |
| `official_website` | Restaurant-owned website |
| `manual_admin` | Admin/editorial input |
| `user_suggestion` | Pending user suggestion |
| `ai_classifier` | Local LLM-derived classification |
| `google_maps` | Navigation-only link target |

## Migration Strategy

1. Create these tables in local Postgres first.
2. Backfill `place_external_ids` from current `google_place_id`:
   - `osm:%` values become `source_system='osm'`.
   - non-OSM values become candidates for `source_system='google_maps'` only if
     manually verified as real Google Place IDs.
3. Do not remove or rename `google_place_id` until app and sync code no longer
   depend on it.
4. Prototype FSQ OS Places into staging tables, then write matched IDs into
   `place_external_ids`.
5. Only promote new canonical facts into `pizza_places`/`taco_places` after the
   field source row exists.

## Field Promotion Rules

Canonical fields should be promoted from source evidence with explicit rules:

| Field | Preferred Source Order |
| --- | --- |
| `name` | manual/admin, official website, government/open data, OSM, FSQ/ATP |
| `lat`/`lng` | manual/admin, government/open data, OSM, FSQ/Overture |
| `address` | manual/admin, government/open data, official website, OSM, FSQ/ATP |
| `website_url` | manual/admin, official website, OSM, FSQ/ATP, Wikidata |
| `phone` | manual/admin, official website, government/open data, OSM, FSQ/ATP |
| `hours` | manual/admin, official website, OSM, FSQ/ATP |
| `style` | manual/admin, official website/menu evidence, AI classifier |
| `price_range` | manual/admin, menu/website evidence, AI classifier |

Fields from Google Maps should not be promoted into canonical storage under the
current source policy.

## Open Questions

- Whether provenance tables should live in Supabase as well as local Postgres.
- Whether public UI needs to expose source attribution per field or only at a
  dataset level.
- Whether ODbL-derived rows require a separate public attribution surface before
  non-OSM datasets are merged.
- Whether `place_id` should eventually point to a new shared `places` table
  instead of separate `pizza_places` and `taco_places` tables.
