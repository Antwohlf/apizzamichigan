# Source Inputs

This is the input contract for adding more source data without overbuilding the
schema or importing unreviewed facts.

The rule is:

> Every new source starts as a dry-run sample input.

No source below should write to `pizza_places` or Supabase from the input
adapter. Accepted matches may be written to `place_sources` only after a dry-run
shows useful coverage and acceptable ambiguity.

## Current Input Adapter

Source cadence, priority, freshness windows, and minimum match confidence are
defined in `config/source-policy.json`. The read-only
`scripts/ops/source-freshness-report.mjs` reports evidence age and confidence
by source before promotion or sync. Adapters collect discovery/evidence; the
canonical promotion boundary remains explicit and auditable.

Use `scripts/ops/source-quality-report.mjs` for the complementary quality
check. It reports source confidence gaps, review candidates already linked near
canonical places, and likely duplicate canonical rows with the same normalized
name within 250 meters. These are risk signals for review, not automatic
deletions or merges.

Use the generic source input report:

```bash
node scripts/ops/source-input-sample-report.mjs \
  --source all_the_places \
  --input data/source-samples/all-the-places-example.geojson \
  --entity pizza \
  --sample 25
```

Supported source keys:

```bash
node scripts/ops/source-input-sample-report.mjs --list-sources
```

Current adapters:

- `fsq_os_places`
- `all_the_places`
- `overture_places`
- `wikidata`
- `government_open_data`
- `denue`
- `official_website`

Verify that the adapter contract and docs are still aligned with:

```bash
node scripts/ops/verify-source-input-adapters.mjs
```

The adapter accepts GeoJSON, JSON arrays, JSON objects with `rows` or `places`,
NDJSON / JSONL, and CSV. It compares source records to the local canonical table
by coordinates and normalized name.

### Geographic scope

Source review imports enforce the active geographic scope from
`config/source-pipeline.json` by default. The current production ingestion
scope is the United States regions listed there: Michigan, New York,
California, and Texas. Rows outside those bounding boxes are reported as
`outOfScopeRowsExcluded` and are not compared, queued for review, or written
to `place_sources`.

An intentional global or nonstandard import must opt out explicitly with
`--allow-out-of-scope` and use a separately reviewed input. Existing canonical
rows outside the current ingestion scope are legacy data and are not removed
by this gate; scope enforcement applies to new source input.

Default mode is dry-run. To persist strong matches as source evidence:

```bash
node scripts/ops/source-input-sample-report.mjs \
  --source all_the_places \
  --input data/source-samples/all-the-places-example.geojson \
  --entity pizza \
  --apply
```

The apply path writes only to `place_sources` for matched existing canonical
rows. It does not write `pizza_places`, `taco_places`, or Supabase.

By default, only `exact_name_nearby` and `strong_spatial_name` matches are
eligible for persistence. `weak_spatial_name` rows stay review-only unless the
operator explicitly adds `--include-weak`.

For durable review output:

```bash
node scripts/ops/source-input-sample-report.mjs \
  --source all_the_places \
  --input /tmp/pizza_hut_us.geojson \
  --entity pizza \
  --review-output reports/source-review/pizza_hut_us-review.json
```

The review output contains:

- `ambiguous`
- `likely_new`
- source fields
- nearest canonical match, when one exists
- review reason and distance/name scores

Summarize generated review files with:

```bash
node scripts/ops/source-review-summary.mjs
```

Export a spreadsheet-friendly review queue with blank decision columns:

```bash
node scripts/ops/source-review-export.mjs \
  --kind all \
  --output reports/source-review-queue.csv
```

Exports can be bounded to an individual source, chain/report artifact, and
source region for focused review batches:

```bash
node scripts/ops/source-review-export.mjs \
  --source all_the_places \
  --report-file bc_pizza-review.json \
  --state MI \
  --kind likely_new \
  --output reports/source-review-bc-pizza-mi.csv
```

For a durable local review queue, create the local table and import generated
review JSONs:

```bash
psql pizza_enrichment < scripts/enrichment/source-review-queue-schema.sql

node scripts/ops/import-source-review-queue.mjs \
  --input-dir reports/source-review \
  --apply
```

The importer only writes `source_review_queue`. It does not write
`pizza_places`, `taco_places`, `place_sources`, or Supabase. Existing reviewed
rows are preserved; reruns refresh only pending rows.

The admin Sources tab can page through the local queue and record conservative
decisions:

- `accepted`: pending likely-new source row looks like a future new canonical place candidate
- `linked`: source row should attach to an existing canonical place id
- `rejected`: source row should not be used
- `ignored`: not worth acting on now
- `Review as likely-new`: pending ambiguous source row is probably not the
  nearby canonical row and should move to likely-new review instead of being
  linked or discarded

`accepted`, `rejected`, and `ignored` decisions are review metadata only. A
`linked` decision validates the selected canonical place id and writes reviewed
evidence to `place_sources` with `match_method='reviewed_link'`. No decision
creates canonical places or syncs anything to Supabase.

`Review as likely-new` is not a final decision. It changes only
`source_review_queue.review_kind` from `ambiguous` to `likely_new`, leaves the
row pending, and keeps the nearby canonical context visible as duplicate-risk
evidence. Use it for cross-brand spatial collisions such as a Domino's source
row nearest to a Pizza Hut canonical row.

Bulk accept and bulk link actions preview eligible rows before asking for
confirmation. Bulk accept only affects pending likely-new rows; bulk link only
affects pending ambiguous rows with a valid nearest canonical place.

After review decisions exist, export accepted/linked candidates as a handoff
CSV for later manual/import tooling:

```bash
node scripts/ops/export-reviewed-source-candidates.mjs \
  --status accepted \
  --output reports/source-reviewed-candidates.csv
```

This export reads `source_review_queue` only. It does not create canonical
places or sync anything to Supabase. Linked decisions may already have written
reviewed evidence to `place_sources` through the admin endpoint.

Reviewed exports include `source_lat`, `source_lng`, source locality/region, and
an `import_readiness` column. Accepted `likely_new` rows without source
coordinates are not import-ready; regenerate/reimport the review artifact after
the adapter preserves coordinates instead of creating a canonical place from an
incomplete row.

Before importing reviewed likely-new rows, run the preflight:

```bash
node scripts/ops/preflight-reviewed-new-place-import.mjs \
  --entity pizza \
  --nearby-radius-m 150 \
  --output reports/reviewed-new-place-preflight.csv
```

Use `--report-file` and `--state` when the review/import work should stay
bounded to a specific source report or region. For example, Michigan-first
review of accepted B.C. Pizza candidates:

```bash
node scripts/ops/preflight-reviewed-new-place-import.mjs \
  --entity pizza \
  --report-file bc_pizza-review.json \
  --state MI \
  --nearby-radius-m 150 \
  --output reports/reviewed-new-place-preflight-mi-bc-pizza.csv
```

The preflight builds proposed canonical payloads, checks required source
identity/coordinate fields, warns about nearby canonical rows, and writes an
operator CSV if requested. Default mode is read-only. With `--apply`, only
`candidate_ready` rows are imported into the local canonical table, linked into
`place_sources` with `match_method='reviewed_new_import'`, and moved from
`accepted` to `linked` in `source_review_queue`.

Use `--limit` as the accepted-row scan window and `--ready-limit` as the write
cap. This lets operators scan past older accepted rows that now need duplicate
review while still importing a small bounded number of currently safe rows.
Use `--ids` when importing a hand-reviewed exact set; exact IDs are still
rechecked for accepted likely-new status, duplicate source IDs, nearby canonical
rows, and same-batch coordinate duplicates before any local insert.

For known chain/location-finder feeds, reviewed-new import preflight normalizes
the proposed canonical display name from the source report, such as `Little
Caesars` or `Round Table Pizza`, instead of using store IDs, branch labels, or
address-like source names as the public place name. The raw source name remains
in `source_review_queue` and `place_sources.data` for auditability.

The admin Source Provenance panel also shows reviewed-new import preflight
summary and row-level candidate previews for accepted likely-new rows. It checks
live duplicate/source ID and nearby-canonical readiness with a batched canonical
prefetch/grid scan before showing the proposed canonical name, raw source label,
address, source link, map link, and nearest canonical context. When
candidate-ready rows exist, the admin action can import the currently inspected
ready rows locally; the server recomputes readiness immediately before each
insert, writes `pizza_places`/`place_sources` only, and never syncs Supabase.
Use the panel's preflight source/report filters before importing when work
should stay bounded to a single reviewed ATP bucket.

```bash
node scripts/ops/preflight-reviewed-new-place-import.mjs \
  --entity pizza \
  --nearby-radius-m 150 \
  --limit 100 \
  --ready-limit 25 \
  --apply
```

For a small reviewed set, prefer exact review IDs:

```bash
node scripts/ops/preflight-reviewed-new-place-import.mjs \
  --entity pizza \
  --ids 849,1234 \
  --nearby-radius-m 150 \
  --ready-limit 10
```

Rows with missing required fields, duplicate source ids, or nearby canonical
places stay in the accepted review queue. This command never syncs anything to
Supabase.

Preflight also blocks accepted source rows with duplicate coordinates inside the
same reviewed-new batch. Those rows report
`duplicate_accepted_source_coordinate` and should be returned to manual review
or geocoded before import.

After a reviewed-new import, verify that local canonical rows, provenance, and
review decisions still agree:

```bash
node scripts/ops/verify-reviewed-new-imports.mjs \
  --entity pizza \
  --ids 180516,180517
```

Reviewed-new rows use source-scoped canonical IDs such as
`all_the_places:<source_id>`, not `osm:*`. To enqueue website scraping for those
new local rows, pass the source prefix explicitly:

```bash
node scripts/enrichment/populate-scrape-from-db.mjs \
  --id-prefix all_the_places: \
  --limit 100
```

Process those queued scrape jobs in a bounded foreground batch before relying on
the scrape-to-classify handoff:

```bash
SCRAPE_REQUEUE_BATCH=0 node scripts/enrichment/agents/web-scraper.mjs \
  --worker-id scraper-reviewed-source-smoke \
  --max-jobs 10
```

Use `SCRAPE_REQUEUE_BATCH=0` for bounded reviewed-source smoke runs so the
scraper does not also requeue unrelated transient failed scrape jobs at startup.

The default scrape population still targets `osm:` rows. Use `--id-prefix '*'`
only for an intentionally broad sweep across every canonical ID namespace.
For classification queue population, pass `--state '*'` when reviewed-new rows
may be outside Michigan.

Reviewed-new rows without per-location websites will not enter the normal
scrape-to-classify handoff. For those exact local IDs, use deterministic chain
inference instead. The command is dry-run by default and only fills null local
`style`, `price_range`, and `style_confidence` fields:

```bash
node scripts/ops/apply-deterministic-classification.mjs \
  --min-place-id 183441 \
  --max-place-id 183464 \
  --id-prefix all_the_places:

node scripts/ops/apply-deterministic-classification.mjs \
  --min-place-id 183441 \
  --max-place-id 183464 \
  --id-prefix all_the_places: \
  --apply
```

Reviewed-new canonical rows are not picked up by the normal local-to-Supabase
update sync because they do not exist in Supabase yet. Publish them only with an
explicit id list and the reviewed-new guard:

```bash
node scripts/sync-local-to-supabase.mjs \
  --dry-run \
  --ids 180512,180513 \
  --insert-missing-reviewed-new \
  --batch 2
```

Remove `--dry-run` only after the preview shows the expected inserts. This mode
still syncs only `pizza_places`; `place_sources` and `source_review_queue` stay
local-only.

For the recurring reviewed-new backlog, use the reconciliation helper. It is
read-only by default and prints the exact missing IDs; `--apply` is required to
publish the bounded batch it found:

```bash
node scripts/ops/reconcile-reviewed-new-supabase.mjs --limit 25
node scripts/ops/reconcile-reviewed-new-supabase.mjs --limit 25 --apply
```

The helper only considers local rows with reviewed-new provenance or an
`imported_new` review decision, and only rows that already have classification
output. It never publishes unreviewed source candidates or provenance tables.

The matcher prefetches canonical rows by source-coordinate tiles and uses an
in-memory coordinate grid. Large source files should still be run one source
family at a time, but they no longer need one Postgres query per source row or
one giant nationwide bounding-box pull.
Each report prints `canonical rows prefetched`, `canonical prefetch tiles`,
`canonical prefetch queries`, and `coordinate grid cells built` so a batch run
shows that the optimized matching path was used.

Verify that path before large ATP/FSQ runs:

```bash
node scripts/ops/verify-source-matching-prefetch.mjs
node scripts/ops/verify-fsq-sample-workflow.mjs
```

### Verified FSQ open-release path

The iMac has a working bounded export path through the gated Hugging Face
Parquet release. It uses `HF_TOKEN` from the machine-local environment, keeps
the downloaded shard cache and sample output ignored, and never writes a
canonical row directly:

```bash
scripts/.fsq-venv/bin/python scripts/ops/export-fsq-hf-parquet-sample.py \
  --dataset foursquare/fsq-os-places \
  --config places \
  --split train \
  --query pizza \
  --country US \
  --limit 100 \
  --max-files 1 \
  --output data/source-samples/fsq-os-places-pizza-sample.json \
  --entity pizza \
  --review-output reports/source-review/fsq-os-places-review.json

node scripts/ops/source-input-sample-report.mjs \
  --source fsq_os_places \
  --input data/source-samples/fsq-os-places-pizza-sample.json \
  --entity pizza \
  --max-distance-m 100 \
  --limit 5000 \
  --sample 25 \
  --review-output reports/source-review/fsq-os-places-review.json
```

The July 18, 2026 bounded run inspected 100 US rows: 88 active pizza-ish
candidates, 53 existing-place matches, 5 ambiguous candidates, and 30 likely
new candidates. The report used one canonical prefetch query across five tiles
and remained read-only. The resulting review artifact was imported into the
durable local review queue; duplicate rows were ignored by the queue upsert.

This proves the FSQ source-input and review-queue path. It does not authorize
automatic canonical creation or Supabase sync. Those remain gated by review,
duplicate preflight, local enrichment, and the guarded sync policy.

`verify-fsq-sample-workflow.mjs` uses a tiny local fixture and does not require
FSQ credentials. It proves the preflight can consume an exported FSQ-like sample
and produce the `fsq_os_places` adapter command. A real FSQ run still requires
either `FSQ_OS_PLACES_SAMPLE` / `--input` pointing at an exported slice, a
Hugging Face token for `export-fsq-hf-parquet-sample.py` or
`export-fsq-hf-sample.mjs`, or a Places Portal/Iceberg sample exported with the
Portal connection snippet. Prefer the Parquet exporter on the iMac when
`scripts/.fsq-venv/bin/python` is present; it does not depend on the Hugging
Face Dataset Viewer search index being current.

The production source scheduler uses this Parquet route for bounded regional
units. On July 18, 2026, the iMac completed an applied `fsq_os_places` unit for
NY with no adapter errors; it persisted only source-review artifacts and kept
canonical creation, enrichment, and Supabase sync behind their existing gates.
The Dataset Viewer JavaScript endpoint is a diagnostic/sample path only because
its index may return loading or transient errors even when authenticated
Parquet access is healthy.

## Source Input Matrix

| Source | Input Shape | First Use | Source Key |
| --- | --- | --- | --- |
| Foursquare OS Places | Small exported JSON/CSV/NDJSON slice from the open release | Broad POI coverage comparison | `fsq_os_places` |
| All the Places | GeoJSON FeatureCollection per spider or small extracted sample | Chain/location-finder coverage and official-source websites | `all_the_places` |
| Overture Places | Small exported JSON/CSV/NDJSON slice from Places theme | Entity resolution, source IDs, contact/website coverage | `overture_places` |
| Wikidata | SPARQL CSV/JSON result export | Notable restaurants, chains, official websites, external IDs | `wikidata` |
| Government/open data | Jurisdiction-specific CSV/JSON export | Existence/address/license/inspection validation | `government_open_data` |
| DENUE / INEGI | Future Mexico sample export | Mexico establishment coverage for TacoBout later | `denue` |
| Official restaurant websites | Scraper output JSON/CSV | Factual first-party evidence for menus/contact/style | `official_website` |

## Promotion Rules

Dry-run sample reports produce three buckets:

| Bucket | Meaning | Next Action |
| --- | --- | --- |
| Matched existing places | Source likely describes a row already in `pizza_places`. | Can be written to `place_sources` with `--apply`. |
| Ambiguous review candidates | Nearby source record exists but name confidence is weak. | Import to `source_review_queue`; manual review before source record import. |
| Likely new/unmatched candidates | No nearby current row inside the configured radius. | Import to `source_review_queue`; candidate for future import review, not automatic canonical insert. |

The admin review queue intentionally triages the two review kinds differently:
ambiguous rows are ordered by nearest canonical place first so possible duplicate
links are quick to resolve, while likely-new rows are ordered by source evidence
completeness and then by farther distance from the nearest canonical row. The
`signals n/4` card badge counts address, website, phone, and coordinate evidence
available on the source row.

When a source graduates from dry-run to persistence:

1. Write source evidence to `place_sources`, not directly to `pizza_places`.
2. Use the stable source key from this document.
3. Preserve the source's native identifier in `source_id`.
4. Preserve license/attribution expectations.
5. Store raw source fields in `place_sources.data`.
6. Set `match_method` and `match_confidence`.
7. Promote canonical fields only through a later explicit review path.

High-confidence ambiguous rows can be linked in bounded local batches after a
dry-run review:

```bash
node scripts/ops/auto-link-source-review-queue.mjs \
  --entity pizza \
  --report-file dominos_pizza_us-review.json \
  --min-name-score 0.98 \
  --max-distance-m 100 \
  --limit 100
```

Explicit brand rules can be enabled for source reports where the source display
name is generic but the source report itself proves the brand:

```bash
node scripts/ops/auto-link-source-review-queue.mjs \
  --entity pizza \
  --report-file papa_murphys-review.json \
  --brand-rules \
  --limit 100
```

Apply mode marks only pending `ambiguous` rows as `linked` and writes evidence
to `place_sources` with `match_method='auto_reviewed_link'` or
`match_method='auto_brand_reviewed_link'`. It skips rows that already have
source evidence, does not decide likely-new rows, does not create canonical
places, and does not make those fields eligible for default canonical field
promotion.
Use `--report-file` to keep the review batch bounded to one generated source
report/spider at a time.

If an ambiguous row is a cross-brand collision rather than a duplicate, use the
admin `Review as likely-new` action. That keeps the row local and pending but
moves it into the likely-new track so it can be accepted and later checked by
reviewed-new import preflight.

For obvious cross-brand collisions from known source reports, preview a bounded
bulk reclassification before clicking one row at a time:

```bash
node scripts/ops/reclassify-ambiguous-source-candidates.mjs \
  --entity pizza \
  --source all_the_places \
  --max-distance-m 25 \
  --max-name-score 0.9 \
  --limit 100
```

Apply mode only changes `source_review_queue.review_kind` from `ambiguous` to
`likely_new` for pending rows whose known source report proves a different chain
than the nearest canonical place. It does not write `place_sources`, create
canonical places, promote fields, or sync Supabase.

For reviewed edge cases that do not fit the thresholded rules, use exact IDs
after inspecting the source row and nearest canonical row:

```bash
node scripts/ops/reclassify-ambiguous-source-candidates.mjs \
  --entity pizza \
  --ids 123,456
```

The ambiguous linker also supports exact reviewed IDs for known-safe duplicate
links:

```bash
node scripts/ops/auto-link-source-review-queue.mjs \
  --entity pizza \
  --ids 789,790
```

Pending likely-new rows can be accepted as future import candidates in bounded
dry-run-gated batches:

```bash
node scripts/ops/accept-likely-new-source-candidates.mjs \
  --entity pizza \
  --state MI \
  --min-signals 3 \
  --limit 100 \
  --nearby-radius-m 150
```

Apply mode only changes `source_review_queue.status` from `pending` to
`accepted` for `candidate_ready` likely-new rows that also pass a fresh
nearby-canonical duplicate check. It scans ahead with `--scan-limit`, skips rows
with existing canonical places inside `--nearby-radius-m`, and reports the
skipped count plus canonical prefetch tile/query counts before accepting
anything. It does not import canonical places, write `place_sources`, promote
fields, or sync Supabase. Accepted rows must still pass
`preflight-reviewed-new-place-import.mjs` before local canonical import. Use
`--report-file` and `--state` for bounded source/region batches; without them,
the tool intentionally works the global queue order.

Candidate acceptance defaults to the region keys in
`config/source-pipeline.json` (currently MI, NY, CA, and TX). This prevents a
nationwide source feed from silently expanding production geographic scope.
Use `--allow-out-of-scope` only for a separately reviewed expansion batch.

For the full reviewed-new handoff path, use the batch runner. Default mode is
read-only and previews the accept/import set:

```bash
node scripts/ops/process-reviewed-new-batch.mjs \
  --entity pizza \
  --source all_the_places \
  --report-file dominos_pizza_us-review.json \
  --accept-limit 10 \
  --import-limit 5
```

Apply local review/import work, scrape, wait for the launchd classifier, and
publish only the exact imported IDs with guarded reviewed-new sync:

```bash
node scripts/ops/process-reviewed-new-batch.mjs \
  --entity pizza \
  --source all_the_places \
  --report-file dominos_pizza_us-review.json \
  --accept-limit 10 \
  --import-limit 5 \
  --apply \
  --run-scrape \
  --wait-classify \
  --publish
```

The runner calls the existing guarded tools rather than duplicating their
database rules. It does not sync `place_sources` or `source_review_queue`.

Foreground scraping is limited to 25 jobs by default. Larger batches still
enqueue their scrape jobs, but defer execution to the managed launchd scraper.
Override `REVIEW_BATCH_FOREGROUND_SCRAPE_LIMIT` only for a deliberate
diagnostic run; this prevents long foreground wrappers from competing with the
production scraper.

## Canonical Field Promotion Policy

Source adapters do not promote canonical fields. They preserve evidence in
`place_sources` and review artifacts only.

The promotion policy is defined in
`scripts/lib/source-promotion-policy.mjs` and verified by
`scripts/ops/verify-source-promotion-policy.mjs`. Current defaults:

| Field Group | Auto-Promote? | Rule |
| --- | --- | --- |
| `website_url`, `phone` | Fill-if-null only | Accepted source match, eligible match method, `match_confidence >= 0.9` by default, no manual value present. |
| `menu_url`, `email`, social links, `hours`, service flags | Evidence-only for now | Store source evidence first; promote only after source-specific normalization and conflict rules exist. |
| `name`, `address`, `lat`, `lng`, `state`, `google_place_id`, brand/operator fields | No | Identity fields need review because bad merges are expensive. |
| `style`, `price_range`, `style_confidence` | No from source adapters | These remain classifier/manual/editorial fields. |
| `rating`, `notes`, `status`, photos | Never | Editorial/user-facing fields stay manual unless an explicit admin action changes them. |

Supabase sync should continue to move product-facing canonical fields, not raw
source evidence. Keep `place_sources` local-only until the public app or admin
UI has a concrete provenance feature that needs it.

### Contact Field Promotion

The only automated canonical promotion path currently allowed is fill-if-null
contact data from accepted local source evidence:

```bash
node scripts/ops/promote-source-contact-fields.mjs \
  --entity pizza \
  --sources official_website,osm,fsq_os_places,all_the_places,overture_places,wikidata \
  --fields website_url,phone \
  --min-confidence 0.9 \
  --match-methods exact_name_nearby,strong_spatial_name,imported_primary
```

Default mode is dry-run. To apply:

```bash
node scripts/ops/promote-source-contact-fields.mjs \
  --entity pizza \
  --sources official_website,osm,fsq_os_places,all_the_places,overture_places,wikidata \
  --fields website_url,phone \
  --min-confidence 0.9 \
  --max-updates 50 \
  --apply
```

The script only fills blank `website_url` and/or `phone` values. It does not
change identity fields, style, price, rating, notes, status, photos,
`place_sources`, `source_review_queue`, or Supabase. Normal local-to-Supabase
sync is responsible for moving canonical field changes after review.
`--limit` controls the printed sample only; `--max-updates` is the write guard
for apply mode. Keep promotion batches small and inspect a dry-run sample before
raising the apply limit.

Requests to auto-promote identity fields such as `address`, `name`, `lat`,
`lng`, `state`, or `google_place_id` fail fast with a policy error. Requests to
promote future factual fields such as `menu_url`, social links, `hours`, or
service flags also fail until a source-specific promotion rule exists. Those
changes must go through manual/admin review because a wrong identity merge is
much more expensive than a missing contact field.

Verify that boundary before changing source adapters or promotion tooling:

```bash
node scripts/ops/verify-source-promotion-policy.mjs
```

## Source Notes

Run the read-only source-pipeline readiness report before choosing the next
source task:

```bash
node scripts/ops/source-pipeline-readiness-report.mjs
```

The report maps the current repo/operator state back to the eight active
source-pipeline backlog areas: batched matching, ATP spider readiness,
likely-new handling, durable review workflow, FSQ sample readiness, Supabase
provenance boundary, UI/search polish, and canonical field promotion policy.

### All the Places

All the Places publishes periodic spider outputs. Each spider output is a
GeoJSON `FeatureCollection`; each `Feature` represents a scraped item and
usually has `properties` plus point geometry. The output data is CC0, while the
spider software is MIT licensed.

Run repeatable ATP spider batches with:

```bash
node scripts/ops/import-atp-spiders.mjs --default-spiders
```

`--default-spiders` reads `config/atp-pizza-spiders.json`, which separates
import-enabled spiders from known gaps and false positives. The importer fails
fast if that manifest is missing, so the curated manifest remains the source of
truth instead of falling back to stale hard-coded spider names.

Verify the local manifest contract before a batch:

```bash
node scripts/ops/verify-atp-spider-manifest.mjs
```

Before a large ATP run, preflight the exact spider set against the current ATP
stats:

```bash
node scripts/ops/import-atp-spiders.mjs \
  --default-spiders \
  --preflight-only
```

The ATP manifest is grouped so large batches can be split into smaller runs:

```bash
node scripts/ops/import-atp-spiders.mjs --list-manifest
node scripts/ops/import-atp-spiders.mjs --group original_chain --preflight-only
node scripts/ops/import-atp-spiders.mjs --group regional_chain --preflight-only
```

Summarize what has already landed in local provenance and what remains in
review:

```bash
node scripts/ops/atp-batch-coverage-report.mjs
```

This read-only report joins the ATP manifest, `place_sources`, review artifacts,
and `source_review_queue`. Use it before rerunning a batch so zero accepted rows
are understood as either `review_only`, `ran_no_accepts`, `disabled`, or
`not_run`. It also prints `next_action` and `review_priority` so operators can
start with ambiguous duplicate/link review before moving to large likely-new
candidate imports.

The `Next Review Work` section includes two read-only commands per review
bucket:

- `review_export_command` writes a CSV handoff from `source_review_queue`.
- `review_dry_run_command` previews a bounded link or accept action without
  `--apply`.

The report also prints a suggested next ATP batch. It chooses import-enabled
`not_run` spiders, caps the command with `--max-spiders`, and warns when pending
ambiguous or likely-new review rows should be worked before adding more source
debt:

```bash
node scripts/ops/atp-batch-coverage-report.mjs --max-spiders 3
```

The generated command intentionally uses `--import-review-queue` and omits
`--apply`, so the first pass downloads source inputs, writes review artifacts,
and previews/upserts review queue rows without changing canonical places.

When the ATP report shows no not-run spiders left, use the reviewed-new backlog
report to choose the next import bucket from existing `source_review_queue`
debt:

```bash
node scripts/ops/reviewed-new-source-backlog-report.mjs --min-signals 3
```

This read-only report ranks `likely_new` buckets by pending `candidate_ready`
rows with enough evidence signals. It also separates rows blocked by nearby
canonical places or missing required data, so operators do not have to hand-query
each spider before deciding whether to accept a bounded import slice.

Use a group run when continuing ATP imports:

```bash
node scripts/ops/import-atp-spiders.mjs \
  --group regional_chain
```

Add `--apply` only after the dry-run review summary looks safe.

To include a dry-run preview of the durable review queue import after the ATP
batch finishes:

```bash
node scripts/ops/import-atp-spiders.mjs \
  --group regional_chain \
  --import-review-queue
```

To upsert the generated ambiguous and likely-new rows into
`source_review_queue` during the same batch, add `--apply-review-queue`. Use
`--apply-review-schema` only on a machine where the review queue table may not
exist yet:

```bash
node scripts/ops/import-atp-spiders.mjs \
  --group regional_chain \
  --apply-review-queue
```

The queue import step never creates canonical places and never writes Supabase.
It only records review candidates. You can still import explicit files when
repairing or replaying older artifacts:

```bash
node scripts/ops/import-source-review-queue.mjs \
  --input-files reports/source-review/round_table_pizza-review.json,reports/source-review/simple_simons_pizza_us-review.json,reports/source-review/pizza_ranch_us-review.json,reports/source-review/vocelli_pizza_us-review.json,reports/source-review/sals_pizza_us-review.json,reports/source-review/flippin_pizza_us-review.json,reports/source-review/mountain_mikes_us-review.json,reports/source-review/bc_pizza-review.json,reports/source-review/larosas-review.json \
  --entity pizza \
  --apply
```

Discover current spider names from the latest ATP run before adding new chains:

```bash
node scripts/ops/discover-atp-spiders.mjs \
  --terms howie,jet,domino,marco,papa,pizza \
  --validate-output
```

The discovery command is read-only. It searches ATP run stats, reports feature
counts/errors, and can optionally validate that matched GeoJSON URLs exist. If a
brand is absent from the stats, keep it out of `import-atp-spiders` until a real
spider appears. In ATP run `2026-07-11-13-32-25`, Hungry Howie's still had no
`howie`/`howies` matches and the broader `hungry` matches were unrelated
non-US brands. `jet` only matched `jet_de_at` and `jet_gb`, which are
fuel/convenience spiders rather than Jet's Pizza.

Audit the curated APizza ATP manifest against the latest run before a batch:

```bash
node scripts/ops/verify-atp-spider-manifest.mjs
node scripts/ops/discover-atp-spiders.mjs \
  --audit-manifest config/atp-pizza-spiders.json
```

The manifest verifier is offline and guards the committed contract: known-good
spiders stay enabled, known Hungry Howie's and Jet's gaps stay disabled,
zero-feature checked spiders stay disabled, and the importer reads the manifest
instead of a fallback hardcoded list. The live manifest audit is also read-only.
`enabled_ok` rows are safe to pass through normal import preflight.
`enabled_with_errors` rows need operator review before apply. `disabled_present`
rows are intentionally excluded even though ATP has a matching spider name,
usually because the name is a documented false positive or not the intended
brand. `disabled_unavailable` rows document spider names we checked and should
not run until a future ATP inventory proves they have usable features.

After reviewing the displayed names, generate an import command for the visible
zero-error matches with:

```bash
node scripts/ops/discover-atp-spiders.mjs \
  --terms domino,marco,papa \
  --print-import-command
```

Add `--apply` only after the dry-run summary looks acceptable:

```bash
node scripts/ops/import-atp-spiders.mjs \
  --spiders dominos_pizza_us,papa_johns,marcos \
  --apply
```

Useful fields:

- `id`
- `ref`
- `@spider`
- `@source_uri`
- `name`
- `brand`
- `brand:wikidata`
- `operator`
- `operator:wikidata`
- `addr:full`
- `website`
- `phone`
- OSM-like category fields such as `amenity`, `cuisine`, or `shop`

First APizza use: chain and regional pizzeria location finders. Current
production posture is accepted-match imports to local `place_sources` only;
ambiguous and likely-new rows remain in generated review files.

### Overture Places

Overture Places is useful for comparison, entity resolution, and source metadata.
The Places theme contains point features with fields such as ID, geometry,
sources, operating status, categories, confidence, websites, socials, emails,
and phones.

Useful fields:

- `id`
- `geometry`
- `sources`
- `operating_status`
- `categories`
- `basic_category`
- `confidence`
- `websites`
- `phones`

First APizza use: compare against OSM and FSQ coverage, then decide whether GERS
or source metadata is worth persisting.

### Wikidata

Wikidata should enrich known or notable entities, not seed broad restaurant
coverage. Use SPARQL exports from Wikidata Query Service and keep the QID as
`source_id`.

Useful fields:

- `item` or `qid`
- `label`
- coordinate latitude/longitude
- `official_website`
- `instance_of`
- `cuisine`
- brand/operator identifiers

First APizza use: chain/notable restaurant metadata and official websites.

### Government/Open Data

Government data is jurisdiction-specific. Every dataset needs its own license
check before persistence. Use it for validation and supplemental metadata, not as
the first broad global source.

Useful fields vary by jurisdiction:

- permit/license/facility identifier
- business name
- address
- coordinates
- facility type
- active/closed status
- inspection/license timestamps

First APizza use: high-value jurisdictions where restaurant open data is clearly
licensed and geographically relevant.

### DENUE / INEGI

DENUE is future-facing for Mexico and TacoBout. Do not make it part of the
APizza production path yet.

First use: separate Mexico/TacoBout prototype after the pizza source path is
stable.

### Official Restaurant Websites

Official websites are first-party evidence. They are useful for factual fields
such as menu URL, ordering URL, hours, phone, social links, delivery/takeaway,
and style evidence. Avoid storing expressive copied menu text.

First APizza use: refinement of existing rows discovered through OSM, FSQ, ATP,
manual admin, or user suggestions.

## References

- Foursquare OS Places: https://opensource.foursquare.com/os-places/
- All the Places data format: https://github.com/alltheplaces/alltheplaces/blob/master/DATA_FORMAT.md
- All the Places API: https://github.com/alltheplaces/alltheplaces/blob/master/API.md
- Overture Places guide: https://docs.overturemaps.org/guides/places/
- Overture Places schema: https://docs.overturemaps.org/schema/reference/places/place/
- Wikidata Query Service help: https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/Wikidata_Query_Help
