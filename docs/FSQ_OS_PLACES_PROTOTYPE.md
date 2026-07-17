# Foursquare OS Places Prototype

This is the next broad source evaluation after the OSM provenance backfill.

Goal:

> Measure whether Foursquare OS Places adds useful pizza coverage before we
> import or sync any FSQ-derived facts.

## Current Rule

FSQ is a comparison source first.

Do not write FSQ rows into `pizza_places`, `taco_places`, Supabase, or
`place_sources` until a sample report shows useful incremental coverage and
manageable ambiguity.

## Current Access Reality

Foursquare now delivers FSQ OS Places primarily through the Foursquare Places
Portal using an Iceberg-based catalog. A user has to create a Places Portal
account, browse the open datasets, and generate an access token before querying
the catalog with DuckDB, Spark, PyIceberg, or another Iceberg-compatible engine.

Foursquare also lists Hugging Face as an additional delivery option, but the
dataset is gated there too. Either way, APizzaMichigan needs an exported slice
before the local source adapter can run.

For small samples, the iMac can export authenticated Hugging Face Parquet shards
after the user has been granted gated dataset access and provides `HF_TOKEN` or
`HUGGINGFACE_HUB_TOKEN`. Prefer that path for APizza sampling because it is
independent of the Hugging Face Dataset Viewer search index. The Dataset Viewer
JSON exporter remains available as a fallback. A Foursquare Places Portal token
is a separate Iceberg-catalog credential; use it with the Portal-provided
DuckDB, Spark, or PyIceberg connection snippet to export a sample file first.

The official access docs describe two separate unblock paths:

- Places Portal / Iceberg: create a Places Portal account, browse the Places,
  Categories, and Deltas datasets, generate a token, and use the
  Portal-provided connection snippet for DuckDB, Spark, PyIceberg, or another
  Iceberg-compatible engine.
- Hugging Face: accept the gated dataset terms, provide `HF_TOKEN` or
  `HUGGINGFACE_HUB_TOKEN`, and query/download the release files. As of the
  official Hugging Face dataset page checked on 2026-07-17, the current release
  paths are `release/dt=2026-07-09/places/parquet/*.parquet` and
  `release/dt=2026-07-09/categories/parquet/*.parquet`.

## Why Sample-Driven

Foursquare OS Places is currently distributed through the Foursquare Places
Portal / Iceberg-compatible access pattern, with examples for tools such as
DuckDB and Spark. The project repository does not need to carry Parquet,
Iceberg, or Arrow dependencies just to answer the first product question.

The first product question is small:

> Are there pizza places in FSQ that we are missing from the current OSM-backed
> APizzaMichigan table?

So the repo accepts a small exported sample in one of these formats:

- JSON array
- JSON object with `rows` or `places`
- NDJSON / JSONL
- CSV

Keep the full FSQ/Iceberg/Spark/DuckDB dependency outside the web app. Export a
small slice first, then feed that file into the generic source adapter.

## Expected FSQ Fields

The report understands the public FSQ OS Places field names:

- `fsq_place_id`
- `name`
- `latitude`
- `longitude`
- `address`
- `locality`
- `region`
- `postcode`
- `country`
- `tel`
- `website`
- `fsq_category_ids`
- `fsq_category_labels`
- `date_closed`
- `unresolved_flags`

It also accepts common aliases such as `lat`, `lng`, `lon`, `city`, `state`,
`phone`, `categories`, and `category`.

## Report Command

Prerequisite: export a small FSQ slice to a local JSON/CSV/NDJSON file with at
least `fsq_place_id`, `name`, `latitude`, `longitude`, category fields, and
status/closed fields. The source adapter is the import boundary.

Check local readiness with:

```bash
node scripts/ops/fsq-sample-preflight.mjs
```

Verify the local FSQ sample workflow without gated credentials:

```bash
node scripts/ops/verify-fsq-sample-workflow.mjs
node scripts/ops/verify-fsq-review-summary.mjs
```

That verifier uses the small checked-in fixture at
`data/source-samples/fixtures/fsq-os-places-pizza-fixture.json`. The fixture is
not product data and is not imported; it only proves that the sample-first
preflight recognizes a local FSQ-like export and builds the correct
`fsq_os_places` adapter command.

To run the next available FSQ step without branching manually, use:

```bash
node scripts/ops/fsq-sample-preflight.mjs --run-or-handoff
```

That command:

1. Runs the read-only adapter report if `--input` or `FSQ_OS_PLACES_SAMPLE`
   points to an exported sample.
2. Exports a bounded Hugging Face sample and runs the report if a Hugging Face
   token is present. When the ignored Python/pyarrow environment exists,
   preflight prefers the authenticated Parquet exporter.
3. Reports `portal_setup_needed` if `FSQ_PLACES_TOKEN` is present but the
   ignored Portal DuckDB setup SQL, Python DuckDB venv, or queryable `places`
   table alias is missing.
4. Exports a bounded Places Portal sample and runs the report when the state is
   `portal_export_ready`.
5. Writes `reports/fsq-os-places-handoff.sh` when no sample/export path is ready.

The FSQ helper scripts read `HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN` for the
Hugging Face exporter, and report `FSQ_PLACES_TOKEN` as Places Portal/Iceberg
readiness. A token is only needed to export a sample. If an FSQ sample file
already exists locally, preflight and `--run` can use that file without a token.

DuckDB is optional for the Hugging Face sample path. The preferred Hugging Face
Parquet exporter needs `pyarrow`, which is installed in the same ignored
`scripts/.fsq-venv` environment used by the Portal helper. DuckDB is required
for a local Places Portal/Iceberg export unless the sample is exported through
another Portal-supported engine. The first APizza FSQ comparison only needs a
bounded exported sample file.

If Hugging Face access has been granted, export a small US pizza sample from
authenticated Parquet shards:

```bash
scripts/.fsq-venv/bin/python \
  scripts/ops/export-fsq-hf-parquet-sample.py \
  --query pizza \
  --country US \
  --limit 100 \
  --max-files 1 \
  --output data/source-samples/fsq-os-places-us-pizza-sample.json \
  --entity pizza \
  --review-output reports/source-review/fsq-os-places-us-review.json \
  --run-report
```

If the Parquet path is not available, export a small Dataset Viewer text-search
sample:

```bash
HF_TOKEN=... \
node scripts/ops/export-fsq-hf-sample.mjs \
  --query pizza \
  --length 100 \
  --pages 3 \
  --output data/source-samples/fsq-os-places-pizza-sample.json
```

To export the sample and immediately run the read-only source report:

```bash
HF_TOKEN=... \
node scripts/ops/export-fsq-hf-sample.mjs \
  --query pizza \
  --length 100 \
  --pages 3 \
  --output data/source-samples/fsq-os-places-pizza-sample.json \
  --entity pizza \
  --review-output reports/source-review/fsq-os-places-review.json \
  --run-report
```

`--pages` is capped at 20 and each page is capped at 100 rows so this remains a
sample workflow. The Parquet exporter is capped separately by `--limit` and
`--max-files`. Use either exporter to answer the overlap/gap question before
considering any broader FSQ ingestion.

## First APizza FSQ Result

On 2026-07-17, the iMac used authenticated Hugging Face Parquet metadata and
the first `places` shard to export a bounded US pizza-name sample:

```bash
scripts/.fsq-venv/bin/python \
  scripts/ops/export-fsq-hf-parquet-sample.py \
  --query pizza \
  --country US \
  --limit 100 \
  --max-files 1 \
  --output data/source-samples/fsq-os-places-us-pizza-sample.json \
  --entity pizza \
  --review-output reports/source-review/fsq-os-places-us-review.json \
  --run-report
```

The resulting source-input report found:

| Bucket | Count |
| --- | ---: |
| Input rows inspected | 100 |
| Usable active pizza candidates | 100 |
| Matched existing places | 30 |
| Ambiguous review candidates | 7 |
| Likely new/unmatched candidates | 63 |
| Accepted for `place_sources` import | 30 |

Those 30 exact/strong matches were then applied to the local iMac
`place_sources` table with `--apply`. No `pizza_places` rows, Supabase rows, or
canonical field values were written. The 7 ambiguous and 63 likely-new rows
remain review artifacts until they are deliberately imported to the local review
queue.

The Hugging Face route is gated separately from the Places Portal route. If the
Places Portal token is present but `validate_portal_tables` remains blocked,
the alternate unblock path is to accept the Hugging Face dataset terms and add
`HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN` to the ignored runtime environment.

Run this against a small exported FSQ sample:

```bash
node scripts/ops/source-input-sample-report.mjs \
  --input data/fsq-os-places-mi-pizza-sample.ndjson \
  --source fsq_os_places \
  --entity pizza \
  --max-distance-m 100 \
  --limit 1000 \
  --sample 25
```

The report is read-only. It:

1. Loads the local Postgres connection from `.env`, `.env.local`, or `PG*` env vars.
2. Filters the sample to active pizza-ish candidates.
3. Compares each candidate to `pizza_places` by distance and normalized name.
4. Prints matched, ambiguous, and likely-new samples.

Add `--review-output reports/source-review/fsq-mi-pizza-review.json` to preserve
ambiguous and likely-new rows for later review.

After a sample report writes review JSON, summarize whether the sample is large
and clean enough to continue:

```bash
node scripts/ops/fsq-review-summary.mjs \
  --input reports/source-review/fsq-mi-pizza-review.json
```

The summary is read-only. It recommends one of the next actions:

- export a larger sample
- review ambiguous duplicate candidates first
- dry-run FSQ `place_sources` evidence import
- import likely-new rows to review queue
- try a broader or different FSQ sample

Once a sample file exists, the preflight can run the adapter directly:

```bash
node scripts/ops/fsq-sample-preflight.mjs \
  --input data/source-samples/fsq-os-places-mi-pizza.csv \
  --review-output reports/source-review/fsq-mi-pizza-review.json \
  --run
```

Without `--input`, preflight prints the exact Hugging Face export command when
a Hugging Face token is available. If only `FSQ_PLACES_TOKEN` is present,
preflight reports `portal_setup_needed` until `scripts/.fsq-portal-init.sql`
and `scripts/.fsq-venv/bin/python` both exist. Once those are present, it
reports `portal_export_ready` and can run the Places Portal export command
directly. Use `--export-length` and `--export-pages` to size the sample. Use
`--dataset`, `--config`, `--split`, `--query`, and `--output` if the Hugging
Face Dataset Viewer exposes different settings than the defaults:

```bash
node scripts/ops/fsq-sample-preflight.mjs \
  --dataset foursquare/fsq-os-places \
  --config places \
  --split train \
  --query pizza \
  --output data/source-samples/fsq-os-places-pizza-sample.json \
  --export-length 100 \
  --export-pages 3
```

To persist the next operator handoff on the iMac without embedding a secret,
add `--write-handoff`. The generated shell file expects `HF_TOKEN` or
`HUGGINGFACE_HUB_TOKEN` to be present for the Hugging Face path. If only
`FSQ_PLACES_TOKEN` is available, use the Places Portal connection snippet to
export the sample file first:

```bash
node scripts/ops/fsq-sample-preflight.mjs \
  --query pizza \
  --output data/source-samples/fsq-os-places-pizza-sample.json \
  --review-output reports/source-review/fsq-os-places-review.json \
  --export-length 100 \
  --export-pages 3 \
  --write-handoff \
  --handoff-output reports/fsq-os-places-handoff.sh

bash reports/fsq-os-places-handoff.sh
```

## Places Portal DuckDB Export Helper

When `FSQ_PLACES_TOKEN` is available, the next step is to save the
Portal-provided DuckDB setup SQL into the ignored file
`scripts/.fsq-portal-init.sql`. The setup SQL may include catalog URLs, account
details, or a `${FSQ_PLACES_TOKEN}` / `{{FSQ_PLACES_TOKEN}}` placeholder. Keep
the token in `.env`; do not commit either file.

Use `scripts/ops/fsq-portal-init.example.sql` as the checked-in setup checklist.
It documents the expected `places` and `categories` table aliases and the token
placeholder forms that the exporter can substitute at runtime. Copy the real
Portal SQL into `scripts/.fsq-portal-init.sql`; do not edit the example with
account-specific details.

Do not copy the checked-in example file itself to
`scripts/.fsq-portal-init.sql`. Preflight and the Python exporter both inspect
the ignored target file and keep reporting `portal_setup_needed` when the file
is empty, still looks like the example, or does not contain executable DuckDB
SQL. `portal_export_ready` means the token, Python DuckDB environment, setup
SQL, and queryable `places` table alias are all present. The preflight validates
that table visibility with the Python exporter before declaring the portal path
ready.

A generic H3 Hub Iceberg attachment is not enough by itself. On 2026-07-17, a
token-backed generic endpoint check attached successfully but exposed no
`places` or `categories` tables, so it remained `portal_setup_needed`. Use the
actual Places Portal-provided DuckDB/Iceberg snippet, or create explicit
`places` and `categories` views in `scripts/.fsq-portal-init.sql` from the
Portal tables it exposes.

Additional 2026-07-17 probes confirmed that this is a table-discovery/setup
issue, not just a DuckDB display issue:

- PyIceberg against the same generic H3 endpoint did not list usable FSQ Places
  namespaces/tables.
- Older public S3 Parquet release paths tested from the iMac were no longer
  readable as a fallback sample source.
- The checked-in preflight now has a separate `validate_portal_tables` checklist
  step. It stays blocked until `SELECT * FROM places LIMIT 0` works after
  running `scripts/.fsq-portal-init.sql`.

The preflight command exposes these same steps as `portal_setup_steps` in JSON
and prints them in text mode, so the admin panel and generated handoff can show
the current missing prerequisite instead of relying on memory.

Create the ignored Python tooling environment on the iMac. This is the same
command emitted by `portal_setup_command`:

```bash
python3 -m venv scripts/.fsq-venv
scripts/.fsq-venv/bin/python -m pip install duckdb pyiceberg pyarrow
```

Then export a bounded pizza sample and immediately run the read-only adapter
report:

```bash
scripts/.fsq-venv/bin/python \
  scripts/ops/export-fsq-portal-duckdb-sample.py \
  --init-sql-file scripts/.fsq-portal-init.sql \
  --query pizza \
  --limit 100 \
  --output data/source-samples/fsq-os-places-pizza-sample.json \
  --entity pizza \
  --review-output reports/source-review/fsq-os-places-review.json \
  --run-report
```

The helper does not import FSQ rows into canonical tables or Supabase. It only
writes an ignored sample JSON file and optionally runs the existing read-only
source adapter report.

## Match Meaning

| Bucket | Meaning | Action |
| --- | --- | --- |
| Matched existing places | FSQ likely points to a row we already have. | Later candidate for `place_sources`, not canonical promotion. |
| Ambiguous review candidates | Nearby but name confidence is weak, or spatial-only. | Review before importing source record. |
| Likely new/unmatched candidates | No nearby current place inside the configured radius. | Best candidates for manual/product review. |

## Promotion Path

If FSQ sample quality is good:

1. Keep `pizza_places` unchanged.
2. Add matched FSQ records to `place_sources` as `source='fsq_os_places'`.
3. Store FSQ fields in `place_sources.data`.
4. Use `match_confidence` and `match_method` to separate exact/strong/weak matches.
5. Promote canonical fields only in later review workflows.

## References

- Foursquare OS Places: https://opensource.foursquare.com/os-places/
- Access FSQ OS Places: https://docs.foursquare.com/data-products/docs/access-fsq-os-places
- FSQ OS Places schema: https://docs.foursquare.com/data-products/docs/places-os-data-schema
- FSQ OS Places notice: https://opensource.foursquare.com/places-notice-txt/
