# Source Provenance Contract

This is the current simple provenance model. It has been applied to the iMac
local Postgres database for APizzaMichigan pizza rows only. It has not been
applied to Supabase, and TacoBoutMichigan rows have not been backfilled.

The near-term model is intentionally small:

> One canonical place row, many source records.

The current `pizza_places` and `taco_places` tables continue serving the app.
New source evidence goes into one shared table: `place_sources`.
Ambiguous and likely-new source rows go into one local operator table:
`source_review_queue`.

## Freshness and source priority

Operational source policy is defined in
[`config/source-policy.json`](../config/source-policy.json). Each source has a
priority, freshness window, minimum match confidence, and role. This keeps
cadence and evidence policy configurable without adding source-specific
columns or migrations.

Run the read-only report before promotion or sync:

```bash
node scripts/ops/source-freshness-report.mjs
```

By default, freshness is scoped to the operational regions in
`config/source-pipeline.json` (currently MI and NY for pizza). The same config
also catalogs CA and TX as future expansion regions, but they are not part of
the default production scope until `operational_regions` changes or an
explicit region override is supplied. Historical or future-expansion regions
remain queryable but do not make the core operational report look unhealthy. Use
`--states MI,NY` or `SOURCE_FRESHNESS_STATES=MI,NY` for a narrower operational
check. This prevents historical evidence outside the active geographic scope
from masking the freshness of the production input pipeline.

Stale evidence remains available for audit but is not eligible to refresh
contact fields. Source evidence cannot promote classifier or editorial fields,
and lower-priority evidence must not overwrite newer higher-priority evidence.

The report's `eligible_rows` count is the operational intersection of each
source's configured freshness window and minimum match confidence. Its
confidence-band counts are diagnostic only; they do not authorize promotion.
The report also includes `fresh_ratio_percent`, which measures current refresh
coverage across the scoped evidence rows. A rotating source such as OSM can
legitimately have many older rows while its regional tile cycle is still
healthy; the operational alert therefore warns when a source has no fresh
evidence or when stale coverage exceeds its configured ratio threshold, rather
than treating the historical row count alone as a failure.
For OSM, when the current regional JSON inputs are present, the report also
includes `stale_rows_observed_in_latest_input` and
`stale_rows_unobserved_in_latest_input`. The first group can be refreshed by
the normal exact-ID pass; the second group is retained for audit but is not
present in the latest export, so it requires source-history review rather than
repeated refresh attempts. These fields explain stale coverage without
reclassifying it as fresh.
To review the actual bounded candidate rows without changing provenance, run:

```bash
node scripts/ops/source-freshness-report.mjs --include-stale-rows --limit 100 --json
```

The output labels each OSM row as `observed_in_latest_input` or
`unobserved_in_latest_input`. Absence from an OSM export is never, by itself,
permission to mark a place closed, replaced, or demolished.
The promotion CLI applies the same freshness, source-priority, match-method,
and confidence rules again at query time, so a report cannot become a stale
authorization to mutate canonical data.

The canonical contract verifier also checks the configuration boundary itself:
every source enabled in `config/source-pipeline.json` must have a matching
policy entry with a valid priority, freshness window, confidence threshold,
role, and declared capabilities. It also rejects policy entries that are not
configured in the pipeline and rejects promotion orders that do not follow
descending source priority. Run this before changing source configuration:

```bash
node scripts/ops/verify-canonical-contract.mjs
```

## Current Table Count

The near-term model manages two product tables and two provenance/review tables:

| Table | Scope | Supabase Sync |
| --- | --- | --- |
| `pizza_places` | Canonical APizzaMichigan product rows | Yes, guarded canonical row sync only |
| `taco_places` | Canonical TacoBoutMichigan product rows | Not active in the current APizza sync |
| `place_sources` | Shared source evidence for pizza and taco places | No, local-only |
| `source_review_queue` | Shared ambiguous/likely-new review workflow | No, local-only |

Do not double the provenance tables for TacoBoutMichigan. `place_sources` and
`source_review_queue` are shared by `entity_type`.

`scripts/lib/supabase-sync-policy.mjs` is the machine-readable source of truth
for the current Supabase boundary: only `pizza_places` can sync, while
`place_sources` and `source_review_queue` are local-only.

## Why This Exists

The current `google_place_id` column is overloaded. Many rows contain OSM IDs
such as `osm:node/12064802655`, while some user-suggestion/admin flows may use
real Google Place IDs.

The additive `place_external_ids` migration in
`scripts/enrichment/external-ids-migration.sql` provides an explicit identity
namespace. Known `osm:` values are stored as `source='osm'`; unknown historical
values are preserved as `source='legacy'` rather than being guessed as Google
IDs. Existing application reads remain compatible during the transition.

Before adding Foursquare OS Places, All the Places, Overture, Wikidata, DENUE,
or government records, we need somewhere to store each source's view of a place
without adding columns for every source.

## Current Tables

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

### `source_review_queue`

One row per ambiguous or likely-new source record awaiting an operator decision.

```sql
CREATE TABLE source_review_queue (
  id BIGSERIAL PRIMARY KEY,

  entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
  review_kind TEXT NOT NULL CHECK (review_kind IN ('ambiguous', 'likely_new')),

  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  source_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  nearest_place_id BIGINT,
  nearest_google_place_id TEXT,
  nearest_place_name TEXT,
  nearest_distance_m NUMERIC(10, 3),
  nearest_name_score NUMERIC(8, 4),
  review_reason TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'linked', 'rejected', 'ignored')),
  decision TEXT,
  canonical_place_id BIGINT,
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,

  report_file TEXT,
  report_generated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (entity_type, source, source_id, review_kind)
);
```

This is local workflow state. It should not be synced to Supabase unless an
admin review product needs it there. It does not imply that a source row should
be imported into `pizza_places` or linked into `place_sources`; it only records
that the row needs a decision.

## Business Replacements At The Same Location

An exact OpenStreetMap ID is normally a strong identity match. It can also mean
that the source record has been updated after one business closed and another
opened at the same location. The data-review portal handles this as a separate
**Update existing place** action, not a normal “same place” link.

The action is deliberately narrow: it is available only when the source and
canonical rows have the exact same OSM ID, a different business name, and the
canonical record is unvisited, unrated, and has no notes. It updates current
source facts (name, coordinates, address, and non-empty phone/website values), clears stale
classifier/scrape values, and marks the row pending for enrichment. It does not
overwrite state, visits, ratings, notes, photos, or editorial fields.

Each update writes the previous and resulting canonical snapshots to the
existing local `source_review_decision_history` audit table and records the
fresh source evidence in `place_sources`. If the old place has personal review
data, do not update it in place: retain the historical place and review the new
business through a dedicated replacement/import workflow.

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

For now, canonical field promotion happens through explicit policy code or
manual review. We do not need a field-level provenance table until real
ambiguity in production makes it worth the added complexity.

`scripts/lib/source-promotion-policy.mjs` is the machine-readable source of
truth for source-to-canonical promotion. Current policy:

- `website_url` and `phone` may be auto-promoted only as fill-if-blank contact
  fields from eligible high-confidence source evidence. Apply mode is bounded
  by `--max-updates` so contact promotion runs as inspected batches, not broad
  table sweeps.
- `menu_url`, social/contact extras, hours, service flags, and accessibility
  flags remain evidence-only.
- `name`, `address`, `lat`, `lng`, `state`, `google_place_id`, brand/operator
  fields, classifier fields, ratings, notes, status, and photos are not
  auto-promoted from source adapters.

## Migration Strategy

1. Create `place_sources` in local Postgres first. Completed on the iMac on
   2026-07-16.
2. Backfill OSM rows from current `pizza_places.google_place_id` values.
   Completed on the iMac on 2026-07-16:
   - `google_place_id='osm:node/123'` becomes:
     - `source='osm'`
     - `source_id='node/123'`
3. Do not backfill `taco_places` in the first phase. Current status: not done.
4. Keep `google_place_id` in place until app and sync code no longer depend on it.
5. Prototype new source families with read-only sample reports first.
6. Add accepted matches to `place_sources`, not directly to `pizza_places`.
7. Add ambiguous and likely-new candidates to `source_review_queue` for durable
   local review.
8. Promote only clearly useful canonical fields after reviewing source quality.
   The current automated path is fill-if-null contact data only
   (`website_url`, `phone`) from eligible `place_sources` evidence with
   `match_confidence >= 0.9` by default. `--limit` controls dry-run sample
   display; `--max-updates` controls the apply batch size. Future factual fields
   such as `menu_url`, social links, hours, and service flags remain evidence-only
   until source-specific rules exist. Identity fields such as `address`,
   `name`, `lat`, `lng`, `state`, and `google_place_id` remain manual-review
   only.
9. Keep `place_sources` and `source_review_queue` local-only for now. Supabase
   should receive canonical product fields, not raw source evidence, until a
   public/admin provenance feature requires it. `scripts/lib/supabase-sync-policy.mjs`
   enforces the current sync target as `pizza_places` and names those two tables
   as local-only.

The first-phase tooling is:

```bash
node scripts/ops/backfill-place-sources.mjs
node scripts/ops/backfill-place-sources.mjs --apply-schema
node scripts/ops/backfill-place-sources.mjs --apply-backfill
```

The source input adapter is:

```bash
node scripts/ops/source-input-sample-report.mjs --list-sources
node scripts/ops/source-input-sample-report.mjs --source all_the_places --input data/source-samples/example.geojson
node scripts/ops/import-source-review-queue.mjs --input-dir reports/source-review
node scripts/ops/import-source-review-queue.mjs --apply-schema --apply
```

## What We Are Not Adding Yet

Do not add these tables now:

- `data_sources`
- `place_external_ids`
- `place_field_sources`
- `source_import_runs`

Those may become useful later, but they are overkill for the current stage.

## Explicit Non-Goals

- Do not mirror `place_sources` or `source_review_queue` to Supabase until a
  concrete public/admin feature needs them.
- Do not add `data_sources`, `place_external_ids`, `place_field_sources`, or
  `source_import_runs` during this phase.
- Do not auto-promote identity, editorial, classifier, rating, status, or photo
  fields from source adapters.
- Do not create separate pizza/taco copies of the provenance tables.
- Do not move to a shared `places` table until APizzaMichigan's source/review
  workflow has proven the simpler model insufficient.

## Still To Decide Later

- Which provenance summaries should be exposed in admin UI.
- Whether public attribution should be dataset-level, row-level, or both.
- Whether ODbL-derived source records need special separation before FSQ/ATP are
  merged into broader production outputs.
