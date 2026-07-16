# Source Inputs

This is the input contract for adding more source data without overbuilding the
schema or importing unreviewed facts.

The rule is:

> Every new source starts as a read-only sample input.

No source below should write to `pizza_places`, `place_sources`, or Supabase
until a sample report shows useful coverage and acceptable ambiguity.

## Current Input Adapter

Use the generic read-only source report:

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

The report accepts GeoJSON, JSON arrays, JSON objects with `rows` or `places`,
NDJSON / JSONL, and CSV. It compares source records to the local canonical table
by coordinates and normalized name. It does not write anything.

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

Read-only sample reports produce three buckets:

| Bucket | Meaning | Next Action |
| --- | --- | --- |
| Matched existing places | Source likely describes a row already in `pizza_places`. | Candidate for `place_sources` only. |
| Ambiguous review candidates | Nearby source record exists but name confidence is weak. | Manual review before source record import. |
| Likely new/unmatched candidates | No nearby current row inside the configured radius. | Candidate for future import review, not automatic canonical insert. |

When a source graduates from sample report to persistence:

1. Write source evidence to `place_sources`, not directly to `pizza_places`.
2. Use the stable source key from this document.
3. Preserve the source's native identifier in `source_id`.
4. Preserve license/attribution expectations.
5. Store raw source fields in `place_sources.data`.
6. Set `match_method` and `match_confidence`.
7. Promote canonical fields only through a later explicit review path.

## Source Notes

### All the Places

All the Places publishes periodic spider outputs. Each spider output is a
GeoJSON `FeatureCollection`; each `Feature` represents a scraped item and
usually has `properties` plus point geometry. The output data is CC0, while the
spider software is MIT licensed.

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

First APizza use: chain and regional pizzeria location finders.

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
