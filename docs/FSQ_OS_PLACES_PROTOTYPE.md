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

For small samples, Hugging Face's Dataset Viewer API can export JSON rows after
the user has been granted gated dataset access and provides `FSQ_PLACES_TOKEN`,
`HF_TOKEN`, or `HUGGINGFACE_HUB_TOKEN`. The viewer API limits each `/rows` or
`/search` request to small slices, so this is a prototype/sample path rather
than a full-ingest path.

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
2. Exports a bounded Hugging Face sample and runs the report if an FSQ/HF token
   is present.
3. Writes `reports/fsq-os-places-handoff.sh` if neither a sample nor token is
   available.

The FSQ helper scripts read `FSQ_PLACES_TOKEN`, `HF_TOKEN`, or
`HUGGINGFACE_HUB_TOKEN` from the shell, `.env`, or `.env.local`. A token is only
needed to export a sample. If an FSQ sample file already exists locally,
preflight and `--run` can use that file without a token.

DuckDB is optional for this Hugging Face sample path. It will matter later for a
larger Iceberg/full-slice workflow, but the first APizza FSQ comparison only
needs a bounded exported sample file.

If Hugging Face access has been granted, export a small text-search sample:

```bash
FSQ_PLACES_TOKEN=... \
node scripts/ops/export-fsq-hf-sample.mjs \
  --query pizza \
  --length 100 \
  --pages 3 \
  --output data/source-samples/fsq-os-places-pizza-sample.json
```

To export the sample and immediately run the read-only source report:

```bash
FSQ_PLACES_TOKEN=... \
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
sample workflow. Use this to answer the overlap/gap question before considering
any broader FSQ ingestion.

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

Without `--input`, preflight prints the exact Hugging Face export command. Use
`--export-length` and `--export-pages` to size that sample. Use `--dataset`,
`--config`, `--split`, `--query`, and `--output` if the Hugging Face Dataset
Viewer exposes different settings than the defaults:

```bash
node scripts/ops/fsq-sample-preflight.mjs \
  --dataset foursquare/fsq-os-places \
  --config default \
  --split train \
  --query pizza \
  --output data/source-samples/fsq-os-places-pizza-sample.json \
  --export-length 100 \
  --export-pages 3
```

To persist the next operator handoff on the iMac without embedding a secret,
add `--write-handoff`. The generated shell file expects one of
`FSQ_PLACES_TOKEN`, `HF_TOKEN`, or `HUGGINGFACE_HUB_TOKEN` to be present when it
is run:

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
