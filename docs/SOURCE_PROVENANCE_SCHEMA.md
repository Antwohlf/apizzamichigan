# Source Provenance Schema Design

This is a design document, not an applied migration.

The near-term model is intentionally small:

> One canonical place row, many source records.

The current `pizza_places` and `taco_places` tables continue serving the app.
New source evidence goes into one shared table: `place_sources`.

## Why This Exists

The current `google_place_id` column is overloaded. Many rows contain OSM IDs
such as `osm:node/12064802655`, while some user-suggestion/admin flows may use
real Google Place IDs.

Before adding Foursquare OS Places, All the Places, Overture, Wikidata, DENUE,
or government records, we need somewhere to store each source's view of a place
without adding columns for every source.

## Proposed Table

### `place_sources`

One row per source record attached to an existing pizza or taco place.

```sql
CREATE TABLE place_sources (
  id BIGSERIAL PRIMARY KEY,

  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  place_id BIGINT NOT NULL,

  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,

  license TEXT,
  attribution TEXT,

  data JSONB NOT NULL DEFAULT '{}'::jsonb,

  match_confidence NUMERIC(5, 4),
  match_method TEXT,

  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (entity_type, source, source_id)
);

CREATE INDEX idx_place_sources_place
  ON place_sources(entity_type, place_id);

CREATE INDEX idx_place_sources_source
  ON place_sources(source, source_id);
```

This table is shared by APizzaMichigan and TacoBoutMichigan. It should not be
duplicated into pizza-specific and taco-specific versions.

## Stable Source Names

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

## Example Rows

OSM source record:

```json
{
  "entity_type": "pizza",
  "place_id": 123,
  "source": "osm",
  "source_id": "node/12064802655",
  "source_url": "https://www.openstreetmap.org/node/12064802655",
  "license": "ODbL-1.0",
  "attribution": "Data copyright OpenStreetMap contributors",
  "data": {
    "name": "Piperno",
    "website_url": "https://example.com",
    "phone": "+1 734 555 1212",
    "osm_tags": {
      "amenity": "restaurant",
      "cuisine": "pizza"
    }
  },
  "match_confidence": 1.0,
  "match_method": "imported_primary"
}
```

Foursquare OS Places candidate:

```json
{
  "entity_type": "pizza",
  "place_id": 123,
  "source": "fsq_os_places",
  "source_id": "fsq_abc123",
  "license": "Apache-2.0",
  "attribution": "Copyright Foursquare Labs, Inc.",
  "data": {
    "name": "Piperno",
    "address": "Example Street",
    "categories": ["Pizzeria"]
  },
  "match_confidence": 0.93,
  "match_method": "spatial_name"
}
```

## Relationship To Canonical Tables

`pizza_places` and `taco_places` hold the current best product values:

- `name`
- `lat`
- `lng`
- `address`
- `website_url`
- `phone`
- `style`
- `price_range`

`place_sources` holds supporting evidence and external identities.

For now, canonical field promotion can happen in code or manual review. We do
not need a field-level provenance table until we feel real pain from ambiguity.

## Migration Strategy

1. Create `place_sources` in local Postgres first.
2. Backfill OSM rows from current `google_place_id` values:
   - `google_place_id='osm:node/123'` becomes:
     - `source='osm'`
     - `source_id='node/123'`
3. Keep `google_place_id` in place until app and sync code no longer depend on it.
4. Prototype Foursquare OS Places into staging/output files first.
5. Add FSQ matches to `place_sources`, not directly to `pizza_places`.
6. Promote only clearly useful canonical fields after reviewing source quality.

## What We Are Not Adding Yet

Do not add these tables now:

- `data_sources`
- `place_external_ids`
- `place_field_sources`
- `source_import_runs`

Those may become useful later, but they are overkill for the current stage.

## Open Questions

- Whether `place_sources` should eventually be mirrored to Supabase or remain
  local-only.
- Whether public attribution should be dataset-level, row-level, or both.
- Whether ODbL-derived source records need special separation before FSQ/ATP are
  merged into broader production outputs.
- Whether the long-term product should eventually move from `pizza_places` and
  `taco_places` to a shared `places` table with vertical-specific attributes.
