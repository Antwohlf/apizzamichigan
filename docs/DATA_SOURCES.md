# Data Sources and Trust Contract

APizzaMichigan is a pizza-specific map/search product. Anthony's picks are an
important editorial layer, but the core database should be broad enough to power
discovery beyond personally reviewed places.

The source-of-record rule is:

> Google Maps is an outbound navigation destination, not an ingestion source.

## Allowed Ingestion Sources

| Source | Role | Notes |
| --- | --- | --- |
| OpenStreetMap / Overpass | Broad place backbone | Primary machine-ingested source for place candidates, coordinates, OSM tags, website links, phone, hours, brands, and service flags. |
| Foursquare OS Places | Open global POI backbone | Strongest next broad source after OSM. Apache 2.0 dataset; use downloaded open releases, not the commercial Places API, for canonical ingestion. |
| All the Places | Chain/location-finder supplement | Useful for official chain and regional restaurant location finders. Treat as a high-value supplement to OSM/FSQ and retain spider/source provenance. |
| Overture Places | Entity resolution and global IDs | Useful for normalized schema, GERS IDs, confidence/source metadata, and coverage comparison. Review release attribution before importing because licensing can vary by theme/source. |
| Wikidata | Structured enrichment | Useful for notable restaurants, chains, cuisine, official websites, parent companies, and external identifiers. Not comprehensive enough as a primary listing source. |
| Official restaurant websites | Enrichment evidence | Scraped only from URLs discovered through reusable sources or manual/admin input. Used for website/menu/contact/style evidence. |
| Government/open datasets | Supplemental coverage and validation | Use only when licensing is clearly reusable. Good for existence, address, inspection/license metadata, and freshness checks. |
| DENUE / INEGI | Future Mexico establishment backbone | Strong future TacoBout source for Mexico. Verify current INEGI attribution and metadata obligations before implementation. |
| Manual/admin input | Editorial source | Highest-trust source for reviewed places, corrections, photos, notes, status, and curated lists. |
| User suggestions | Pending input | Suggestions are not canonical until approved by admin/editorial flow. |

## Non-Ingestion Sources

| Source | Policy |
| --- | --- |
| Google Maps / Google Places | Do not use as a machine-seeded source of record. Do not bulk harvest place details, websites, phone numbers, or coordinates into the durable database. |
| Editorial/top lists | Deferred for now. If used later, store only curation/list membership with attribution, not copied article content. |
| Proprietary review platforms/directories | Do not ingest as durable place facts unless licensing explicitly allows it. |
| Random Kaggle dumps or scraper vendors | Do not ingest unless the upstream primary license is independently verified. |

## Source Registry

| Source | Canonical Use | Persistence | Current Priority | Implementation Status |
| --- | --- | --- | --- | --- |
| OSM / Overpass | Existing broad place backbone and OSM evidence | Durable, with OSM attribution/ODbL obligations | Active | Already imported, enriched locally, and backfilled into `place_sources` for pizza rows |
| Foursquare OS Places | Second broad open POI backbone | Durable under Apache 2.0 notice/license compliance | High | Read-only sample comparison tooling added; no imports yet |
| All the Places | Chain and official location-finder supplement | Durable according to project output license; retain spider/source URL | High | Active for accepted pizza matches into `place_sources`; ambiguous and likely-new rows remain review artifacts |
| Overture Places | External IDs, dedupe, confidence/source metadata | Generally durable, but release/theme attribution must be checked | Medium | Read-only sample adapter added; no imports yet |
| Wikidata | Chain/notable-place enrichment and external IDs | Durable under CC0 structured data | Medium | Read-only sample adapter added; no imports yet |
| Government/open data | License/inspection/existence overlays | Durable only when dataset license permits | Medium | Read-only sample adapter added; dataset registry still needed |
| DENUE / INEGI | Mexico establishment coverage | Likely durable with attribution/metadata obligations | Future high | Read-only sample adapter added for future TacoBout/Mexico work |
| Official restaurant websites | Field evidence from first-party sources | Store factual extracted fields and short evidence; avoid expressive content | Active/manual | Read-only sample adapter added; broad operation remains opt-in |
| Google Maps / Google Places | Navigation links only | Do not use for durable canonical ingestion | Navigation only | Popup/admin outbound links |

Stable source keys used by the generic input adapter and `place_sources`:

| Source Key | Source |
| --- | --- |
| `fsq_os_places` | Foursquare OS Places |
| `all_the_places` | All the Places |
| `overture_places` | Overture Places |
| `wikidata` | Wikidata |
| `government_open_data` | Government/open data |
| `denue` | DENUE / INEGI |
| `official_website` | Official restaurant websites |

## Build Order

1. Keep OSM as the current production backbone.
2. Add the shared `place_sources` provenance table before importing another broad source.
   The first implementation phase is pizza-only; do not backfill TacoBout yet.
3. Use source input adapters for FSQ, All the Places, Overture, Wikidata,
   government/open data, DENUE, and official website samples. Adapters are
   dry-run by default and may write accepted matches only to `place_sources`.
4. Prototype a Michigan or North America slice of Foursquare OS Places.
5. Measure FSQ overlap and gaps against current OSM-derived `pizza_places`.
6. Continue All the Places pizza chain/regional spiders as provenance-only
   imports. Do not backfill TacoBout yet.
7. Evaluate Overture only after FSQ and ATP show their incremental coverage.
8. Build a government/open-data registry for the jurisdictions that matter most.
9. Treat DENUE as a separate future track for Mexico/TacoBout expansion.

## Google Maps Links

Google Maps links are allowed for user navigation from the popup/admin UI.

Rules:

1. If a row has a verified Google Place ID, use a Google Maps Place URL.
2. If the external ID is OSM-style, such as `osm:node/12064802655`, do not treat it as a Google Place ID.
3. If no verified Google Place ID exists, generate a Google Maps search URL from APizzaMichigan-owned data such as name, address, city, state, or coordinates.

The current `google_place_id` column is overloaded. Many rows store OSM IDs in
that field. Treat it as a legacy external identifier until the schema is split
into explicit source IDs.

## Trust Layers

| Layer | Meaning | Automation Policy |
| --- | --- | --- |
| Editorial/manual | Human-reviewed facts and Anthony's picks | Highest trust. Automation must not overwrite without explicit review. |
| Official website | Restaurant-owned public facts and menu evidence | Can update supporting fields and evidence, but should not overwrite manual corrections blindly. |
| Government/open data | Licensed public records | Good for validation and supplemental metadata. Track dataset/source name. |
| OSM | Open community-maintained place data | Good broad default. Preserve OSM evidence and attribution. |
| AI inference | Derived classification from evidence | Reviewable output. Sync guarded; protected user-facing fields are fill-if-null in Supabase. |

## Current Column Ownership

| Column Group | Examples | Role |
| --- | --- | --- |
| Core identity | `id`, `name`, `lat`, `lng`, `address`, `state`, `google_place_id` | Canonical row identity. Current sync does not overwrite these in Supabase. |
| Product display | `status`, `style`, `price_range`, `rating`, `notes`, `website_url`, `phone` | Used by website/admin workflows today or near-term. |
| Manual/editorial | `status`, `rating`, `notes`, review photos | Human-authored layer. Should win over automation. |
| OSM evidence | `osm_tags`, `osm_last_fetched_at`, `osm_fetch_status`, `osm_fetch_error` | Machine evidence for extraction, QA, and future refresh. |
| Website/menu evidence | `scrape_method`, `scrape_notes`, `menu_url`, `menu_data`, `menu_parse_confidence`, `menu_parse_notes`, `menu_last_parsed_at` | Supporting evidence. Not all fields are product-facing yet. |
| Contact/service metadata | `hours`, `email`, `instagram_url`, `facebook_url`, `twitter_url`, `whatsapp`, `delivery`, `takeaway`, `drive_through`, `outdoor_seating`, `indoor_seating`, `wheelchair`, `brand`, `operator` | Useful metadata, currently underused in UI. Treat as source-derived facts. |
| Enrichment operations | `enrichment_status`, `last_enriched_at`, `enrichment_agent`, `enrichment_run_id` | Pipeline metadata. Useful for operations and sync. |

## Target Model

The current table can keep serving production, but future schema work should
separate these concepts:

- canonical place facts
- source evidence and source licenses
- external identifiers by source system
- editorial/curation layers
- reviews and photos
- derived AI fields

Near-term migrations should be additive and should not block the current local
enrichment and guarded sync pipeline.

The simplified provenance table design lives in `docs/SOURCE_PROVENANCE_SCHEMA.md`.
The FSQ sample-first workflow lives in `docs/FSQ_OS_PLACES_PROTOTYPE.md`.
The shared input contract for all source families lives in `docs/SOURCE_INPUTS.md`.

## Current APizza Source State

As of 2026-07-17, the iMac local database has:

- OSM pizza provenance backfilled for all OSM-backed `pizza_places` rows.
- All the Places accepted matches persisted to `place_sources` for selected
  pizza chain/regional spiders:
  - `14,014` accepted `all_the_places` source links
  - `164,487` accepted `osm` source links
- Review JSON artifacts for ambiguous and likely-new source rows under
  `reports/source-review/` on the iMac. These files are intentionally ignored by
  Git because they are generated operational artifacts.
- A durable local `source_review_queue` table can track those review rows after
  import. It is local operator state, not a Supabase/public product table.
- Current local review queue state:
  - `1,156` ambiguous ATP rows linked to canonical rows
  - `241` likely-new ATP rows accepted as future import candidates
  - `2,732` likely-new ATP rows imported and linked to new canonical rows
  - `9,134` likely-new ATP rows pending review
- The FSQ sample workflow verifies against the checked-in fixture on the iMac.
  A real FSQ OS Places import still requires an exported FSQ slice or an
  FSQ/Hugging Face token.

The current ATP batch set includes the original chain shortlist plus a small
regional batch. The machine-readable source of truth for
`import-atp-spiders --default-spiders` is `config/atp-pizza-spiders.json`:

- Original shortlist: `little_caesars_us`, `pizza_hut_us`,
  `dominos_pizza_us`, `papa_johns`, `marcos`, `papa_murphys`, `mod_pizza`,
  `california_pizza_kitchen`, `foxs_pizza`, `monicals_pizza_us`,
  `mr_gattis_pizza_us`, `and_pizza`, `grimaldis_pizzeria`
- Regional batch: `round_table_pizza`, `simple_simons_pizza_us`,
  `pizza_ranch_us`, `vocelli_pizza_us`, `sals_pizza_us`,
  `flippin_pizza_us`, `mountain_mikes_us`, `bc_pizza`, `larosas`

The original next-candidate chain search is now resolved for ATP: Domino's,
Papa John's, Marco's, Little Caesars, and Pizza Hut have accepted source
evidence plus durable review queue rows. Papa Murphy's and &pizza are
review-only in the current data because the matcher found no accepted existing
canonical rows. The next ATP work is review triage of ambiguous rows, not
rerunning the same broad chain spiders.

Most recent reviewed-new import slice: 24 high-signal Pizza Hut candidates were
accepted, preflighted, imported locally, scraped, and classified on 2026-07-17.
One adjacent Pizza Hut candidate stayed accepted for manual review because the
preflight found a nearby Domino's within the duplicate-review radius. No
Supabase rows were written.

The same bounded path also imported, scraped, and classified 24 high-signal
Domino's candidates on 2026-07-17. One adjacent Domino's candidate stayed
accepted for manual review because the preflight found a nearby Your Pie within
the duplicate-review radius. No Supabase rows were written.

The next bounded slice imported, scraped, and classified 23 high-signal Papa
John's candidates on 2026-07-17. Two adjacent Papa John's candidates stayed
accepted for manual review because preflight found nearby canonical places
within the duplicate-review radius. No Supabase rows were written.

Current ATP spider gaps: Hungry Howie's has no matching spider in the July 2026
ATP stats, and `jet` matches non-pizza fuel/convenience spiders rather than
Jet's Pizza. Additional checked-but-unusable regional spiders in that run
include zero-feature `blaze_pizza`, `lou_malnatis_pizzeria_us`,
`godfathers_pizza`, and `old_chicago_us`.

`bc_pizza` is enabled after inspection, but remains marked
`active_with_errors` because the July 2026 ATP run reports spider errors. Future
runs should keep treating its preflight warning as an operator review signal.

`larosas` is enabled as review-only evidence for now: the July 2026 run had 61
features, no spider errors, no accepted existing-place matches, 11 ambiguous
rows, and 50 likely-new rows.

Use this to summarize the review backlog:

```bash
node scripts/ops/source-review-summary.mjs
```

Use this to export ambiguous and likely-new rows into an operator review CSV:

```bash
node scripts/ops/source-review-export.mjs --kind all --output reports/source-review-queue.csv
```

Use this to import generated review JSONs into the local durable review queue:

```bash
psql pizza_enrichment < scripts/enrichment/source-review-queue-schema.sql
node scripts/ops/import-source-review-queue.mjs --input-dir reports/source-review --apply
```

Use this to export reviewed rows after admin decisions have been recorded:

```bash
node scripts/ops/export-reviewed-source-candidates.mjs \
  --status accepted \
  --output reports/source-reviewed-candidates.csv
```

The reviewed-candidate export is a handoff artifact only. It does not create
canonical places, mutate `place_sources`, or sync anything to Supabase.

Use this to preview high-confidence ambiguous rows that can be linked to their
nearest canonical place without clicking through the admin UI one row at a time:

```bash
node scripts/ops/auto-link-source-review-queue.mjs \
  --entity pizza \
  --report-file dominos_pizza_us-review.json \
  --min-name-score 0.98 \
  --max-distance-m 100 \
  --limit 100
```

For known source reports where the source display name is generic but the
spider/report proves the brand, enable explicit brand rules:

```bash
node scripts/ops/auto-link-source-review-queue.mjs \
  --entity pizza \
  --report-file papa_murphys-review.json \
  --brand-rules \
  --limit 100
```

Apply only after reviewing the dry-run sample:

```bash
node scripts/ops/auto-link-source-review-queue.mjs \
  --entity pizza \
  --report-file dominos_pizza_us-review.json \
  --min-name-score 0.98 \
  --max-distance-m 100 \
  --limit 100 \
  --apply
```

The auto-link tool only considers pending `ambiguous` rows with an existing
nearest canonical place and no existing `place_sources` row for the same source
ID. Apply mode marks those review rows `linked` and writes provenance with
`match_method='auto_reviewed_link'` or, when an explicit brand rule matched,
`match_method='auto_brand_reviewed_link'`. It does not create canonical places,
promote contact fields, decide likely-new rows, or sync Supabase. Neither
auto-link match method is eligible for default canonical field promotion.
Use `--report-file` to keep the review batch bounded to one generated source
report/spider at a time.

Use this to preview high-signal pending likely-new rows that can be accepted as
future import candidates:

```bash
node scripts/ops/accept-likely-new-source-candidates.mjs \
  --entity pizza \
  --min-signals 3 \
  --limit 100
```

Apply only after reviewing the dry-run sample:

```bash
node scripts/ops/accept-likely-new-source-candidates.mjs \
  --entity pizza \
  --min-signals 3 \
  --limit 100 \
  --apply
```

This tool only changes pending `likely_new` rows to `accepted` when they are
`candidate_ready` and have enough evidence signals. It does not create
canonical places, write `place_sources`, promote fields, or sync Supabase.
Accepted rows must still pass reviewed-new import preflight before any local
canonical row is created.

The admin source review queue supports four decisions:

| Decision | Valid For | Effect |
| --- | --- | --- |
| `linked` | Ambiguous or likely-new rows | Validates the chosen canonical place ID and upserts reviewed evidence into `place_sources` with `match_method='reviewed_link'`. |
| `accepted` | Likely-new rows only | Marks the row as a candidate for later canonical-place import. It does not create a place by itself. |
| `rejected` | Ambiguous or likely-new rows | Records that the source row should not be used. |
| `ignored` | Ambiguous or likely-new rows | Records that the row is intentionally skipped without a stronger rejection. |

Accepted likely-new rows can be imported from the admin Source Provenance
preflight panel only when they are still `candidate_ready` after a fresh
duplicate/nearby-place check. That import is local-only: it creates canonical
rows, writes `place_sources` with `match_method='reviewed_new_import'`, and does
not sync Supabase.

After a reviewed-new import, enqueue website scraping by source ID namespace
instead of relying on the old OSM-only queue population:

```bash
node scripts/enrichment/populate-scrape-from-db.mjs \
  --id-prefix all_the_places: \
  --min-place-id 181254 \
  --max-place-id 181347 \
  --priority-boost 100000 \
  --limit 100
```

Then process a bounded foreground scrape batch:

```bash
SCRAPE_REQUEUE_BATCH=0 node scripts/enrichment/agents/web-scraper.mjs \
  --worker-id scraper-reviewed-source-smoke \
  --max-jobs 10
```

Use `SCRAPE_REQUEUE_BATCH=0` for bounded reviewed-source runs so the scraper
does not requeue unrelated transient failed jobs at startup.

If those reviewed-new rows need to finish classification ahead of the broader
backlog, boost the same ID range. Use `--state '*'` when reviewed-new imports
may be outside Michigan:

```bash
node scripts/enrichment/populate-classify-from-db.mjs \
  --state '*' \
  --id-prefix all_the_places: \
  --min-place-id 181254 \
  --max-place-id 181347 \
  --priority-boost 100000 \
  --limit 100
```

Reviewed-new canonical rows may be published to Supabase only with an explicit
`scripts/sync-local-to-supabase.mjs --ids ... --insert-missing-reviewed-new`
run. The guard requires matching local `place_sources` evidence with
`match_method='reviewed_new_import'`; provenance and review tables remain
local-only.

Use this to preview safe contact-field promotion from accepted source evidence:

```bash
node scripts/ops/promote-source-contact-fields.mjs --entity pizza
```

Apply only after reviewing the dry-run summary:

```bash
node scripts/ops/promote-source-contact-fields.mjs --entity pizza --apply
```

The source promotion policy is intentionally narrow and machine-verified:
`website_url` and `phone` may be filled only when blank from eligible accepted
evidence. Identity fields, classifier/editorial fields, and future factual
fields such as menus, social links, hours, and service flags stay out of
automated promotion until explicit source-specific rules exist.

```bash
node scripts/ops/verify-source-promotion-policy.mjs
```

## Primary References

- Foursquare OS Places: https://opensource.foursquare.com/os-places/
- Foursquare OS Places notice: https://opensource.foursquare.com/places-notice-txt/
- All the Places: https://alltheplaces.xyz/
- Overture attribution: https://docs.overturemaps.org/attribution/
- Overture AWS registry: https://registry.opendata.aws/overture/
- INEGI terms: https://en.www.inegi.org.mx/inegi/terminos.html
- DENUE: https://en.www.inegi.org.mx/app/mapa/denue/default.aspx
