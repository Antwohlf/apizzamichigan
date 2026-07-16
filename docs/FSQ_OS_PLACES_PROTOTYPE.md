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

Run this against a small exported FSQ sample:

```bash
node scripts/ops/fsq-os-places-sample-report.mjs \
  --input data/fsq-os-places-mi-pizza-sample.ndjson \
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
