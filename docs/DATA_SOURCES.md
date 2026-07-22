# Data Sources and Trust Contract

APizzaMichigan is a pizza-specific map/search product. Anthony's picks are an
important editorial layer, but the core database should be broad enough to power
discovery beyond personally reviewed places.

The source-of-record rule is:

> Google Maps is an outbound navigation destination, not an ingestion source.

Every ingestion source follows the same two-stage contract: it may discover
candidate places and/or match an existing canonical place, then contribute
evidence for enrichment. A source never writes public canonical fields merely
because it found a value. Promotion is a separate policy decision: currently
only high-confidence website/phone evidence may fill blank contact fields;
identity fields stay review-owned and style/price/editorial fields stay
classifier or editorial-owned.

The machine-readable capabilities are `discover`, `match_existing`,
`enrich_evidence`, and `promote_contact` in
`config/source-pipeline.json`. This keeps discovery and enrichment unified
without allowing a new source to silently gain write authority.

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

### Website Fetch Strategy

Official websites are fetched with a normal HTTP client first. A browser-rendered
fallback is available only for explicitly configured domains where the ordinary
request fails transiently. It uses the existing Chrome installation on the
worker machine, makes one bounded attempt, and records `scrape_method=browser`
when it succeeds. It is disabled by default and must be enabled with:

```bash
SCRAPE_BROWSER_FALLBACK_DOMAINS=cpk.com,pizzahut.com \
SCRAPE_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

This fallback is for JavaScript-heavy or selectively served first-party pages;
it is not a mechanism for bypassing access controls, robots rules, or rate
limits. Dead links, DNS failures, and explicit block responses remain recorded
without repeated browser attempts.

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
| Foursquare OS Places | Second broad open POI backbone | Durable under Apache 2.0 notice/license compliance | High | Bounded Hugging Face export and review/provenance handoff active; canonical promotion remains review-gated |
| All the Places | Chain and official location-finder supplement | Durable according to project output license; retain spider/source URL | High | Active for accepted pizza matches into `place_sources`; ambiguous and likely-new rows remain review artifacts |
| Overture Places | External IDs, dedupe, confidence/source metadata | Generally durable, but release/theme attribution must be checked | Medium | Bounded Michigan export, review-gated canonical imports, and provenance verification active |
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

### Bounded OSM Regional Export

Use the tiled runner for regional refreshes so each Overpass request is
bounded and resumable:

```bash
node scripts/ops/export-osm-tiles.mjs \
  --bbox 41.6,-84.0,45.0,-82.0 \
  --step 0.5 \
  --output reports/osm/mi-pizza.json \
  --manifest reports/osm/mi-pizza.manifest.json
```

The runner records each tile as `success` or `failed`, deduplicates OSM IDs,
and skips completed tiles when rerun. Successful tiles are ingested even when
another tile fails; the failed tile remains in the manifest for retry. After
one consecutive provider failure,
the hourly cursor rotates to the next configured region while preserving the
failed region's manifest for later resumable retry. Use `--max-tiles` for a bounded trial;
review failed tiles before expanding the geographic scope. Do not run a broad
single-bbox Overpass request as the production schedule.

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
  - `17,356` accepted `all_the_places` source links
  - `164,487` accepted `osm` source links
- Foursquare OS Places has a bounded authenticated Hugging Face export path on
  the iMac. Its adapter is allowed to write matched evidence to
  `place_sources` and review artifacts to the local source-review queue; it
  does not directly create canonical rows or write Supabase.
- Overture Places now has a bounded Michigan review/import path. Candidate
  imports are duplicate-guarded, provenance-verified, and handed to the local
  scrape queue; Supabase publication remains a separate guarded step.
- Review JSON artifacts for ambiguous and likely-new source rows under
  `reports/source-review/` on the iMac. These files are intentionally ignored by
  Git because they are generated operational artifacts.
- A durable local `source_review_queue` table can track those review rows after
  import. It is local operator state, not a Supabase/public product table.
- Current local review queue state:
  - `1,156` ambiguous ATP rows linked to canonical rows
  - `665` likely-new ATP rows accepted as future import candidates
  - `6,074` likely-new ATP rows imported and linked to new canonical rows
  - `5,368` likely-new ATP rows pending review
- The FSQ sample workflow verifies against the checked-in fixture on the iMac.
  The iMac has an authenticated Hugging Face route, an ignored Python
  DuckDB/PyArrow environment, and the bounded Parquet exporter needed for
  repeatable US samples. The optional Places Portal route remains incomplete:
  its ignored setup SQL does not currently expose queryable `places` and
  `categories` tables. The Portal token is separate from the Hugging Face
  token and is not required for the current bounded export path.

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

The US-first source-to-production runner is defined in
`config/source-pipeline.json` and `scripts/ops/run-source-pipeline.mjs`. It
advances bounded OSM, FSQ, All the Places, Overture, Wikidata, and official
website work units through the shared provenance/review workflow. New
canonical rows require four source identity/contact signals and a 150-meter
duplicate guard; Wikidata and official websites remain enrichment-only.

The original next-candidate chain search is now resolved for ATP: Domino's,
Papa John's, Marco's, Little Caesars, and Pizza Hut have accepted source
evidence plus durable review queue rows. Papa Murphy's now has both published
and local-only reviewed-new import slices; &pizza remains review-only in the
current data because the matcher found no accepted existing canonical rows. The
next ATP work is reviewed-new triage/import, not rerunning the same broad chain
spiders.

Most recent reviewed-new import slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. The acceptance dry
run scanned 250 pending Little Caesars rows, skipped 66 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `4557`, `4558`, `4559`, `4561`, `4562`, `4563`, `4564`, `4565`,
`4567`, `4568`, `4569`, `4570`, `4571`, `4572`, `4573`, `4574`, `4577`,
`4579`, `4581`, `4583`, `4584`, `4585`, `4586`, `4587`, and `4588`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186561`-`186585`. Reviewed-new import verification found 0 issue
rows and no linked reviews missing provenance. Scrape queue handoff found 25
website-backed candidates but did not add or boost any SQLite scrape jobs in
dry-run mode. Deterministic chain inference filled all 25 rows as
`Traditional`, `$`, `inferred`. No Supabase rows were written. Little Caesars
now has 116 accepted likely-new rows, 475 linked likely-new rows, and 720
pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 101 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12358`,
`12359`, `12360`, `12362`, `12363`, `12364`, `12365`, `12366`, `12367`,
`12368`, `12369`, `12370`, `12371`, `12372`, `12373`, `12374`, `12375`,
`12377`, `12379`, `12380`, `12381`, `12382`, `12383`, `12384`, and `12386`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186536`-`186560`. Reviewed-new import verification found 0 issue
rows and no linked reviews missing provenance. Scrape queue handoff found 25
website-backed candidates but did not add or boost any SQLite scrape jobs in
dry-run mode. Deterministic chain inference filled all 25 rows as
`Traditional`, `$$`, `inferred`. No Supabase rows were written. Pizza Hut now
has 183 accepted likely-new rows, 1,635 linked likely-new rows, and 1,739
pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Domino's rows, skipped 49 nearby-canonical duplicate-risk rows, used
one canonical prefetch query, and selected exact review IDs `2441`, `2442`,
`2443`, `2444`, `2445`, `2446`, `2447`, `2448`, `2449`, `2450`, `2451`,
`2452`, `2453`, `2454`, `2455`, `2456`, `2457`, `2458`, `2460`, `2461`,
`2462`, `2463`, `2465`, `2466`, and `2467`. Reviewed-new import preflight
found all 25 candidate-ready and imported them as local IDs `186511`-`186535`.
Reviewed-new import verification found 0 issue rows and no linked reviews
missing provenance. Scrape queue handoff found 25 website-backed candidates but
did not add or boost any SQLite scrape jobs in dry-run mode. Deterministic chain
inference filled all 25 rows as `Traditional`, `$`, `inferred`. No Supabase rows
were written. Domino's now has 139 accepted likely-new rows, 1,832 linked
likely-new rows, and 1,368 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Papa John's rows, skipped 53 nearby-canonical
duplicate-risk rows, used two canonical prefetch queries, and selected exact
review IDs `7217`, `7218`, `7219`, `7220`, `7221`, `7222`, `7223`, `7224`,
`7225`, `7226`, `7227`, `7228`, `7229`, `7230`, `7231`, `7232`, `7233`,
`7234`, `7235`, `7236`, `7237`, `7238`, `7239`, `7240`, and `7241`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186461`-`186485`. Reviewed-new import verification found 0 issue
rows and no linked reviews missing provenance. Scrape queue handoff found 25
website-backed candidates but did not add or boost any SQLite scrape jobs in
dry-run mode. Deterministic chain inference filled all 25 rows as
`Traditional`, `$$`, `inferred`. No Supabase rows were written. Papa John's now
has 90 accepted likely-new rows, 746 linked likely-new rows, and 771 pending
likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Domino's rows, skipped 48 nearby-canonical duplicate-risk rows, used
one canonical prefetch query, and selected exact review IDs `2414`, `2415`,
`2416`, `2417`, `2418`, `2419`, `2420`, `2421`, `2422`, `2423`, `2424`,
`2426`, `2427`, `2428`, `2429`, `2430`, `2431`, `2432`, `2433`, `2434`,
`2435`, `2436`, `2437`, `2438`, and `2439`. Reviewed-new import preflight
found all 25 candidate-ready and imported them as local IDs `186411`-`186435`.
Reviewed-new import verification found 0 issue rows and no linked reviews
missing provenance. Scrape queue handoff found 25 website-backed candidates but
did not add or boost any SQLite scrape jobs in dry-run mode. Deterministic chain
inference filled all 25 rows as `Traditional`, `$`, `inferred`. No Supabase rows
were written. Domino's now has 139 accepted likely-new rows, 1,807 linked
likely-new rows, and 1,393 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. The acceptance dry
run scanned 250 pending Little Caesars rows, skipped 59 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `4524`, `4525`, `4526`, `4528`, `4530`, `4532`, `4533`, `4535`,
`4536`, `4538`, `4539`, `4540`, `4541`, `4543`, `4544`, `4546`, `4547`,
`4548`, `4549`, `4550`, `4551`, `4552`, `4554`, `4555`, and `4556`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186361`-`186385`. Reviewed-new import verification found 0 issue
rows and no linked reviews missing provenance. Scrape queue handoff found 25
website-backed candidates but did not add or boost any SQLite scrape jobs in
dry-run mode. Deterministic chain inference filled all 25 rows as
`Traditional`, `$`, `inferred`. No Supabase rows were written. Little Caesars
now has 116 accepted likely-new rows, 450 linked likely-new rows, and 745
pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 92 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12241`,
`12242`, `12243`, `12244`, `12245`, `12247`, `12248`, `12249`, `12250`,
`12251`, `12252`, `12253`, `12254`, `12255`, `12256`, `12257`, `12258`,
`12259`, `12262`, `12263`, `12264`, `12265`, `12266`, `12267`, and `12268`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186336`-`186360`. Reviewed-new import verification found 0 issue
rows and no linked reviews missing provenance. Scrape queue handoff found 25
website-backed candidates but did not add or boost any SQLite scrape jobs in
dry-run mode. Deterministic chain inference filled all 25 rows as
`Traditional`, `$$`, `inferred`. No Supabase rows were written. Pizza Hut now
has 183 accepted likely-new rows, 1,535 linked likely-new rows, and 1,839
pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Papa John's rows, skipped 46 nearby-canonical
duplicate-risk rows, used two canonical prefetch queries, and selected exact
review IDs `7189`, `7190`, `7191`, `7192`, `7193`, `7194`, `7195`, `7196`,
`7197`, `7199`, `7200`, `7201`, `7202`, `7203`, `7204`, `7205`, `7206`,
`7207`, `7208`, `7209`, `7210`, `7211`, `7212`, `7213`, and `7214`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186286`-`186310`. Reviewed-new import verification found 0 issue
rows and no linked reviews missing provenance. Scrape queue handoff found 25
website-backed candidates but did not add or boost any SQLite scrape jobs in
dry-run mode. Deterministic chain inference filled all 25 rows as
`Traditional`, `$$`, `inferred`. No Supabase rows were written. Papa John's now
has 90 accepted likely-new rows, 721 linked likely-new rows, and 796 pending
likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch is present
in the current iMac state with exact linked review IDs `7157`, `7158`, `7159`,
`7160`, `7161`, `7163`, `7164`, `7166`, `7167`, `7168`, `7170`, `7171`,
`7173`, `7177`, `7178`, `7179`, `7180`, `7181`, `7182`, `7183`, `7184`,
`7185`, `7186`, `7187`, and `7188`. Reviewed-new import verification found
all 25 linked to local IDs `186261`-`186285` with 0 issue rows and no linked
reviews missing provenance. Scrape queue handoff found 25 website-backed
candidates, added 25 SQLite scrape jobs, boosted those 25 pending jobs by
`100000`, and the bounded foreground scraper completed 25 jobs. Scrape-derived
classification confirmed all 25 rows as `Traditional`, `$$`, `confirmed`. No
Supabase rows were written. Papa John's now has 90 accepted likely-new rows,
696 linked likely-new rows, and 821 pending likely-new rows in the local review
queue.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Domino's rows, skipped 46 nearby-canonical duplicate-risk rows, used
one canonical prefetch query, and selected exact review IDs `2356`, `2357`,
`2359`, `2361`, `2362`, `2363`, `2364`, `2365`, `2366`, `2367`, `2368`,
`2371`, `2372`, `2374`, `2375`, `2377`, `2379`, `2380`, `2381`, `2382`,
`2383`, `2384`, `2385`, `2386`, and `2387`. Reviewed-new import preflight
found all 25 candidate-ready and imported them as local IDs `186236`-`186260`.
Reviewed-new import verification found 0 issue rows and no linked reviews
missing provenance. Scrape queue handoff found 25 website-backed candidates but
did not add or boost any SQLite scrape jobs in dry-run mode. Deterministic chain
inference filled all 25 rows as `Traditional`, `$`, `inferred`. No Supabase rows
were written. Domino's now has 139 accepted likely-new rows, 1,757 linked
likely-new rows, and 1,443 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch is present in
the current iMac state with exact linked review IDs `2329`, `2330`, `2331`,
`2332`, `2333`, `2335`, `2336`, `2337`, `2338`, `2339`, `2340`, `2341`,
`2342`, `2343`, `2344`, `2345`, `2346`, `2347`, `2348`, `2349`, `2350`,
`2351`, `2352`, `2354`, and `2355`. Reviewed-new import verification found
all 25 linked to local IDs `186211`-`186235` with 0 issue rows and no linked
reviews missing provenance. Scrape queue handoff found 25 website-backed
candidates, added 25 SQLite scrape jobs, boosted those 25 pending jobs by
`100000`, and the bounded foreground scraper completed 25 jobs. Scrape-derived
classification confirmed 20 rows as `Traditional`, `$`, `confirmed`; five rows
remain locally pending classification. No Supabase rows were written. Domino's
now has 139 accepted likely-new rows, 1,732 linked likely-new rows, and 1,468
pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Little Caesars batch is
present in the current iMac state with exact linked review IDs `4459`, `4460`,
`4461`, `4464`, `4465`, `4466`, `4467`, `4469`, `4470`, `4471`, `4472`,
`4474`, `4475`, `4476`, `4478`, `4480`, `4481`, `4483`, `4484`, `4485`,
`4486`, `4487`, `4489`, `4490`, and `4492`. Reviewed-new import verification
found all 25 linked to local IDs `186186`-`186210` with 0 issue rows and no
linked reviews missing provenance. Scrape queue handoff found 25 website-backed
candidates, added 25 SQLite scrape jobs, boosted those 25 pending jobs by
`100000`, and the bounded foreground scraper completed 25 jobs. Scrape-derived
classification confirmed all 25 rows as `Traditional`, `$`, `confirmed`. No
Supabase rows were written. Little Caesars now has 116 accepted likely-new
rows, 425 linked likely-new rows, and 770 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch is present
in the current iMac state with exact linked review IDs `7125`, `7126`, `7129`,
`7132`, `7134`, `7135`, `7136`, `7137`, `7138`, `7139`, `7140`, `7141`,
`7142`, `7143`, `7145`, `7146`, `7147`, `7148`, `7150`, `7151`, `7152`,
`7153`, `7154`, `7155`, and `7156`. Reviewed-new import verification found
all 25 linked to local IDs `186161`-`186185` with 0 issue rows and no linked
reviews missing provenance. Scrape queue handoff found 25 website-backed
candidates, added 25 SQLite scrape jobs, boosted those 25 pending jobs by
`100000`, and the bounded foreground scraper completed 25 jobs. Scrape-derived
classification confirmed 21 rows, and deterministic chain inference filled the
remaining four rows as `Traditional`, `$$`, `inferred`. No Supabase rows were
written. Papa John's now has 90 accepted likely-new rows, 671 linked likely-new
rows, and 846 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Papa John's rows, skipped 38 nearby-canonical duplicate-risk
rows, used two canonical prefetch queries, and selected exact review IDs `7096`,
`7097`, `7099`, `7100`, `7101`, `7102`, `7103`, `7104`, `7105`, `7106`,
`7108`, `7110`, `7111`, `7112`, `7113`, `7114`, `7115`, `7116`, `7117`,
`7118`, `7119`, `7120`, `7121`, `7122`, and `7123`. Reviewed-new import
preflight found all 25 candidate-ready and imported them as local IDs
`186136`-`186160`. All 25 imported rows have official
`locations.papajohns.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written.

The previous reviewed-new import slice: a follow-up Domino's batch is present in
the current iMac state with exact linked review IDs `2301`, `2302`, `2304`,
`2305`, `2306`, `2307`, `2308`, `2309`, `2310`, `2311`, `2312`, `2313`,
`2314`, `2315`, `2316`, `2318`, `2319`, `2320`, `2321`, `2322`, `2323`,
`2325`, `2326`, `2327`, and `2328`. Reviewed-new import verification found
all 25 linked to local IDs `186111`-`186135` with 0 issue rows and no linked
reviews missing provenance. Scrape queue handoff found 25 website-backed
candidates, added 25 SQLite scrape jobs, boosted those 25 pending jobs by
`100000`, and the bounded foreground scraper completed 25 jobs. Deterministic
chain inference classified/priced all 25 rows as `Traditional`, `$`,
`inferred`. No Supabase rows were written. Domino's now has 139 accepted
likely-new rows, 1,707 linked likely-new rows, and 1,493 pending likely-new rows
in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 90 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12213`,
`12214`, `12215`, `12216`, `12217`, `12218`, `12219`, `12220`, `12222`,
`12224`, `12225`, `12226`, `12227`, `12228`, `12229`, `12230`, `12231`,
`12232`, `12233`, `12234`, `12235`, `12236`, `12237`, `12238`, and `12239`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186086`-`186110`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Pizza Hut now has 183 accepted likely-new rows, 1,510 linked
likely-new rows, and 1,864 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch is present in
the current iMac state with exact linked review IDs `2272`, `2273`, `2275`,
`2276`, `2277`, `2278`, `2279`, `2280`, `2281`, `2282`, `2283`, `2284`,
`2285`, `2286`, `2288`, `2289`, `2290`, `2291`, `2292`, `2293`, `2294`,
`2295`, `2297`, `2298`, and `2299`. Reviewed-new import verification found
all 25 linked to local IDs `186061`-`186085` with 0 issue rows and no linked
reviews missing provenance. Scrape queue handoff found 25 website-backed
candidates, added 25 SQLite scrape jobs, boosted those 25 pending jobs by
`100000`, and the bounded foreground scraper completed 25 jobs. Deterministic
chain inference classified/priced all 25 rows as `Traditional`, `$`,
`inferred`. No Supabase rows were written. Domino's now has 139 accepted
likely-new rows, 1,682 linked likely-new rows, and 1,518 pending likely-new rows
in the local review queue.

The previous reviewed-new import slice: a follow-up Little Caesars batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Little Caesars rows, skipped 45 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `4428`, `4429`, `4432`, `4433`, `4434`, `4435`, `4436`, `4437`,
`4438`, `4439`, `4440`, `4441`, `4443`, `4444`, `4445`, `4446`, `4447`,
`4448`, `4449`, `4450`, `4451`, `4453`, `4454`, `4455`, and `4456`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `186036`-`186060`. All 25 imported rows have official
`littlecaesars.com` store URLs. Scrape queue preflight found 25 website-backed
candidates but no new or boosted SQLite scrape jobs were needed. Deterministic
chain inference classified/priced all 25 rows as `Traditional`, `$`,
`inferred`. Provenance verification found 0 issue rows, and no Supabase rows
were written. Little Caesars now has 91 accepted likely-new rows, 400 linked
likely-new rows, and 820 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Papa John's rows, skipped 35 nearby-canonical duplicate-risk rows,
used one canonical prefetch query, and selected exact review IDs `7068`, `7069`,
`7070`, `7071`, `7072`, `7073`, `7074`, `7075`, `7076`, `7077`, `7078`,
`7079`, `7080`, `7082`, `7083`, `7084`, `7085`, `7086`, `7087`, `7088`,
`7089`, `7090`, `7093`, `7094`, and `7095`. Reviewed-new import preflight
found all 25 candidate-ready and imported them as local IDs `186011`-`186035`.
All 25 imported rows have official `locations.papajohns.com` store URLs. Scrape
queue preflight found 25 website-backed candidates but no new or boosted SQLite
scrape jobs were needed. Deterministic chain inference classified/priced all 25
rows as `Traditional`, `$$`, `inferred`. Provenance verification found 0 issue
rows, and no Supabase rows were written. Papa John's now has 90 accepted
likely-new rows, 621 linked likely-new rows, and 896 pending likely-new rows in
the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Domino's rows, skipped 39 nearby-canonical duplicate-risk rows, used
one canonical prefetch query, and selected exact review IDs `2243`, `2244`,
`2245`, `2246`, `2247`, `2248`, `2249`, `2250`, `2251`, `2252`, `2254`,
`2255`, `2256`, `2257`, `2258`, `2260`, `2261`, `2262`, `2263`, `2264`,
`2265`, `2267`, `2268`, `2270`, and `2271`. Reviewed-new import preflight
found all 25 candidate-ready and imported them as local IDs `185986`-`186010`.
All 25 imported rows have official `pizza.dominos.com` store URLs. Scrape queue
preflight found 25 website-backed candidates but no new or boosted SQLite scrape
jobs were needed. Deterministic chain inference classified/priced all 25 rows as
`Traditional`, `$`, `inferred`. Provenance verification found 0 issue rows, and
no Supabase rows were written. Domino's now has 139 accepted likely-new rows,
1,657 linked likely-new rows, and 1,543 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 85 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12183`,
`12185`, `12186`, `12187`, `12188`, `12189`, `12190`, `12191`, `12192`,
`12193`, `12194`, `12195`, `12198`, `12199`, `12201`, `12202`, `12203`,
`12204`, `12206`, `12207`, `12208`, `12209`, `12210`, `12211`, and `12212`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185961`-`185985`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Pizza Hut now has 183 accepted likely-new rows, 1,485 linked
likely-new rows, and 1,889 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 82 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12155`,
`12156`, `12157`, `12158`, `12159`, `12160`, `12161`, `12162`, `12163`,
`12164`, `12165`, `12166`, `12167`, `12168`, `12169`, `12170`, `12171`,
`12172`, `12173`, `12175`, `12176`, `12177`, `12179`, `12180`, and `12181`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185936`-`185960`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Pizza Hut now has 183 accepted likely-new rows, 1,460 linked
likely-new rows, and 1,914 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 79 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12129`,
`12130`, `12131`, `12132`, `12133`, `12134`, `12136`, `12137`, `12138`,
`12139`, `12140`, `12141`, `12142`, `12143`, `12144`, `12145`, `12146`,
`12147`, `12148`, `12149`, `12150`, `12151`, `12152`, `12153`, and `12154`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185911`-`185935`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Pizza Hut now has 183 accepted likely-new rows, 1,435 linked
likely-new rows, and 1,939 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch is present
in the current iMac state with exact linked review IDs `2216`, `2217`, `2218`,
`2219`, `2220`, `2221`, `2222`, `2223`, `2224`, `2225`, `2226`, `2227`,
`2228`, `2229`, `2230`, `2231`, `2232`, `2234`, `2235`, `2236`, `2237`,
`2238`, `2240`, `2241`, and `2242`. Reviewed-new import verification found
all 25 linked to local IDs `185886`-`185910` with 0 issue rows and no linked
reviews missing provenance. All 25 imported rows have official
`pizza.dominos.com` store URLs and are classified locally as `Traditional`,
`$`, `inferred`. No Supabase rows were written. Domino's now has 139 accepted
likely-new rows, 1,632 linked likely-new rows, and 1,568 pending likely-new rows
in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch is present
in the current iMac state with exact linked review IDs `12100`, `12101`,
`12102`, `12103`, `12104`, `12105`, `12106`, `12107`, `12108`, `12109`,
`12110`, `12111`, `12112`, `12113`, `12114`, `12116`, `12117`, `12118`,
`12119`, `12120`, `12122`, `12123`, `12125`, `12126`, and `12127`.
Reviewed-new import verification found all 25 linked to local IDs
`185861`-`185885` with 0 issue rows and no linked reviews missing provenance.
All 25 imported rows have official `locations.pizzahut.com` store URLs.
A bounded foreground scrape processed 25 queued scrape jobs; seven rows were
classified/priced as `Traditional`, `$$`, `confirmed`, and deterministic chain
inference filled the remaining 18 rows as `Traditional`, `$$`, `inferred`. No
Supabase rows were written. Pizza Hut now has 183 accepted likely-new rows,
1,410 linked likely-new rows, and 1,964 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 73 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12072`,
`12073`, `12075`, `12076`, `12077`, `12079`, `12080`, `12081`, `12082`,
`12083`, `12084`, `12085`, `12086`, `12087`, `12088`, `12089`, `12090`,
`12091`, `12093`, `12094`, `12095`, `12096`, `12097`, `12098`, and `12099`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185836`-`185860`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 70 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12046`,
`12047`, `12048`, `12049`, `12050`, `12051`, `12052`, `12053`, `12054`,
`12055`, `12056`, `12057`, `12058`, `12059`, `12060`, `12061`, `12062`,
`12063`, `12064`, `12065`, `12066`, `12067`, `12068`, `12069`, and `12071`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185811`-`185835`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Pizza Hut now has 183 accepted likely-new rows, 1,360 linked
likely-new rows, and 2,014 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance apply scanned
250 pending Pizza Hut rows, skipped 68 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `12019`,
`12020`, `12021`, `12022`, `12023`, `12024`, `12025`, `12026`, `12027`,
`12028`, `12029`, `12031`, `12032`, `12033`, `12034`, `12035`, `12036`,
`12037`, `12038`, `12039`, `12040`, `12041`, `12042`, `12044`, and `12045`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185786`-`185810`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. Scrape queue preflight found 25
website-backed candidates but no new or boosted SQLite scrape jobs were needed.
Deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Pizza Hut now has 183 accepted likely-new rows, 1,335 linked
likely-new rows, and 2,039 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 64 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11991`,
`11992`, `11994`, `11995`, `11996`, `11997`, `11998`, `12000`, `12001`,
`12002`, `12003`, `12004`, `12005`, `12006`, `12007`, `12008`, `12010`,
`12011`, `12012`, `12013`, `12014`, `12015`, `12016`, `12017`, and `12018`.
Reviewed-new import verification found all 25 linked to local IDs
`185761`-`185785` with 0 issue rows and no linked reviews missing provenance.
All 25 imported rows have official `locations.pizzahut.com` store URLs. A
bounded foreground scrape processed 25 queued scrape jobs; 21 rows were
classified/priced as `Traditional`, `$$`, `confirmed`, and deterministic chain
inference filled the remaining four rows as `Traditional`, `$$`, `inferred`. No
Supabase rows were written.

The previous reviewed-new import slice: a follow-up Domino's batch is present in
the current iMac state with exact linked review IDs `2185`, `2187`, `2189`,
`2190`, `2191`, `2192`, `2193`, `2195`, `2196`, `2199`, `2200`, `2202`,
`2203`, `2204`, `2205`, `2206`, `2207`, `2208`, `2209`, `2210`, `2211`,
`2212`, `2213`, `2214`, and `2215`. Reviewed-new import verification found
all 25 linked to local IDs `185736`-`185760` with 0 issue rows and no linked
reviews missing provenance. All 25 imported rows have official
`pizza.dominos.com` location URLs and are classified locally as `Traditional`,
`$`, `inferred`. No Supabase rows were written. Domino's now has 139 accepted
likely-new rows, 1,607 linked likely-new rows, and 1,593 pending likely-new rows
in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 60 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11964`,
`11965`, `11966`, `11967`, `11968`, `11969`, `11970`, `11971`, `11972`,
`11973`, `11974`, `11975`, `11976`, `11977`, `11978`, `11979`, `11980`,
`11981`, `11982`, `11984`, `11985`, `11986`, `11987`, `11988`, and `11990`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185711`-`185735`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. A bounded foreground scrape processed 25
queued scrape jobs; 19 rows were classified/priced as `Traditional`, `$$`,
`confirmed`, and deterministic chain inference filled the remaining six rows as
`Traditional`, `$$`, `inferred`. Provenance verification found 0 issue rows, and
no Supabase rows were written. Pizza Hut now has 183 accepted likely-new rows,
1,285 linked likely-new rows, and 2,089 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. The acceptance
dry run scanned 250 pending Little Caesars rows, skipped 39 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `4401`, `4402`, `4403`, `4404`, `4405`, `4406`, `4407`, `4408`,
`4409`, `4410`, `4411`, `4412`, `4413`, `4414`, `4415`, `4416`, `4417`,
`4419`, `4420`, `4421`, `4422`, `4423`, `4425`, `4426`, and `4427`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185686`-`185710`. All 25 imported rows have official
`littlecaesars.com` store URLs. A bounded foreground scrape processed 25 queued
scrape jobs, and deterministic chain inference classified/priced all 25 rows as
`Traditional`, `$`, `confirmed`. Provenance verification found 0 issue rows, and
no Supabase rows were written. Little Caesars now has 91 accepted likely-new
rows, 375 linked likely-new rows, and 845 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch is present
in the current iMac state with exact linked review IDs `11937`, `11938`,
`11939`, `11940`, `11941`, `11942`, `11943`, `11944`, `11945`, `11946`,
`11947`, `11948`, `11949`, `11950`, `11951`, `11953`, `11954`, `11955`,
`11956`, `11957`, `11959`, `11960`, `11961`, `11962`, and `11963`.
Reviewed-new import verification found all 25 linked to local IDs
`185661`-`185685` with 0 issue rows and no linked reviews missing provenance.
All 25 imported rows have official `locations.pizzahut.com` store URLs and are
classified locally as `Traditional`, `$$`, `inferred`. No Supabase rows were
written. Pizza Hut now has 183 accepted likely-new rows, 1,260 linked likely-new
rows, and 2,114 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 57 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11909`,
`11910`, `11911`, `11912`, `11913`, `11914`, `11916`, `11917`, `11918`,
`11919`, `11921`, `11922`, `11923`, `11924`, `11925`, `11926`, `11927`,
`11928`, `11929`, `11930`, `11932`, `11933`, `11934`, `11935`, and `11936`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185636`-`185660`. All 25 imported rows have official
`locations.pizzahut.com` store URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found 25 website-backed candidates, but no scrape jobs were written
because the check ran in dry-run mode. Provenance verification found 0 issue
rows, and no Supabase rows were written. Pizza Hut now has 183 accepted
likely-new rows, 1,235 linked likely-new rows, and 2,139 pending likely-new
rows in the local review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Papa John's rows, skipped 34 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `7040`, `7041`, `7042`, `7043`, `7044`, `7045`, `7046`, `7047`,
`7048`, `7049`, `7050`, `7052`, `7054`, `7056`, `7057`, `7058`, `7059`,
`7060`, `7061`, `7062`, `7063`, `7064`, `7065`, `7066`, and `7067`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185611`-`185635`. All 25 imported rows have official
`locations.papajohns.com` location URLs. A bounded foreground scrape processed
25 queued scrape jobs, and all 25 rows are now classified/priced as
`Traditional`, `$$`, `confirmed`. Provenance verification found 0 issue rows,
and no Supabase rows were written. Papa John's now has 90 accepted likely-new
rows, 596 linked likely-new rows, and 921 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 56 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11878`,
`11880`, `11881`, `11882`, `11883`, `11886`, `11887`, `11888`, `11891`,
`11892`, `11893`, `11894`, `11895`, `11896`, `11897`, `11898`, `11899`,
`11900`, `11901`, `11902`, `11903`, `11904`, `11905`, `11907`, and `11908`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185586`-`185610`. All 25 imported rows have official
`locations.pizzahut.com` store URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found 25 website-backed candidates, but no scrape jobs were written
because the check ran in dry-run mode. Provenance verification found 0 issue
rows, and no Supabase rows were written. Pizza Hut now has 183 accepted
likely-new rows, 1,210 linked likely-new rows, and 2,164 pending likely-new
rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 55 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11849`,
`11850`, `11852`, `11853`, `11854`, `11855`, `11856`, `11857`, `11858`,
`11859`, `11860`, `11861`, `11862`, `11863`, `11865`, `11866`, `11868`,
`11869`, `11870`, `11871`, `11873`, `11874`, `11875`, `11876`, and `11877`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185561`-`185585`. All 25 imported rows have official
`locations.pizzahut.com` store URLs. A bounded foreground scrape processed 25
queued scrape jobs; 20 rows were classified/priced as `Traditional`, `$$`,
`confirmed`, and deterministic chain inference filled the remaining five rows
as `Traditional`, `$$`, `inferred`. Provenance verification found 0 issue rows,
and no Supabase rows were written. Pizza Hut then had 183 accepted
likely-new rows, 1,185 linked likely-new rows, and 2,189 pending likely-new
rows in the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Domino's rows, skipped 35 nearby-canonical duplicate-risk rows,
used one canonical prefetch query, and selected exact review IDs `2158`,
`2159`, `2160`, `2162`, `2163`, `2164`, `2165`, `2166`, `2167`, `2168`,
`2169`, `2170`, `2171`, `2172`, `2173`, `2174`, `2175`, `2176`, `2177`,
`2178`, `2179`, `2180`, `2182`, `2183`, and `2184`. Reviewed-new import
preflight found all 25 candidate-ready and imported them as local IDs
`185536`-`185560`. All 25 imported rows have official `pizza.dominos.com`
location URLs. A bounded foreground scrape processed 25 queued scrape jobs, and
deterministic chain inference classified/priced all 25 rows as `Traditional`,
`$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written. Domino's now has 139 accepted likely-new rows, 1,582 linked
likely-new rows, and 1,618 pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 55 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11821`,
`11822`, `11823`, `11824`, `11825`, `11826`, `11827`, `11829`, `11831`,
`11832`, `11833`, `11834`, `11835`, `11836`, `11837`, `11838`, `11839`,
`11840`, `11841`, `11843`, `11844`, `11845`, `11846`, `11847`, and `11848`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185511`-`185535`. All 25 imported rows have official
`locations.pizzahut.com` store URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found 25 website-backed candidates, but no scrape jobs were written
because the check ran in dry-run mode. Provenance verification found 0 issue
rows, and no Supabase rows were written. Pizza Hut now has 183 accepted
likely-new rows, 1,160 linked likely-new rows, and 2,214 pending likely-new
rows in the local review queue.

The previous reviewed-new import slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. The acceptance
dry run scanned 250 pending Little Caesars rows, skipped 36 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `4372`, `4373`, `4374`, `4375`, `4376`, `4377`, `4378`, `4379`,
`4380`, `4381`, `4382`, `4383`, `4385`, `4386`, `4387`, `4388`, `4389`,
`4390`, `4391`, `4392`, `4393`, `4395`, `4396`, `4398`, and `4400`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185486`-`185510`. All 25 imported rows have official
`littlecaesars.com` store URLs and were classified locally by deterministic
chain inference as `Traditional`, `$`, `inferred`. Scrape queue preflight found
25 website-backed candidates, but no scrape jobs were written because the check
ran in dry-run mode. Provenance verification found 0 issue rows, and no
Supabase rows were written. Little Caesars now has 91 accepted likely-new rows,
350 linked likely-new rows, and 870 pending likely-new rows in the local review
queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Papa John's rows, skipped 32 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `7014`, `7015`, `7016`, `7017`, `7018`, `7019`, `7020`, `7021`,
`7023`, `7024`, `7025`, `7026`, `7027`, `7028`, `7029`, `7030`, `7031`,
`7032`, `7033`, `7034`, `7035`, `7036`, `7037`, `7038`, and `7039`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185461`-`185485`. All 25 imported rows have official
`locations.papajohns.com` location URLs. A bounded foreground scrape processed
25 queued scrape jobs; 17 rows were classified/priced as `Traditional`, `$$`,
`confirmed`, and deterministic chain inference filled the remaining eight rows
as `Traditional`, `$$`, `inferred`. Provenance verification found 0 issue rows,
and no Supabase rows were written. Papa John's now has 90 accepted likely-new
rows, 571 linked likely-new rows, and 946 pending likely-new rows in the local
review queue.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. The acceptance dry run
scanned 250 pending Papa John's rows, skipped 30 nearby-canonical
duplicate-risk rows, used one canonical prefetch query, and selected exact
review IDs `6987`, `6988`, `6989`, `6990`, `6992`, `6993`, `6994`, `6995`,
`6996`, `6997`, `6998`, `6999`, `7000`, `7001`, `7002`, `7003`, `7005`,
`7006`, `7007`, `7008`, `7009`, `7010`, `7011`, `7012`, and `7013`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185436`-`185460`. All 25 imported rows have official
`locations.papajohns.com` location URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found 25 website-backed candidates, but no scrape jobs were written
because the check ran in dry-run mode. Provenance verification found 0 issue
rows, and no Supabase rows were written. Papa John's now has 90 accepted
likely-new rows, 571 linked likely-new rows, and 946 pending likely-new rows in
the local review queue.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Domino's rows, skipped 32 nearby-canonical duplicate-risk rows, used
one canonical prefetch query, and selected 25 `candidate_ready` rows. Apply mode
accepted the exact next reviewed-new batch with review IDs `2130`, `2131`,
`2132`, `2133`, `2135`, `2136`, `2137`, `2138`, `2139`, `2140`, `2141`,
`2142`, `2143`, `2144`, `2145`, `2146`, `2147`, `2149`, `2150`, `2151`,
`2152`, `2154`, `2155`, `2156`, and `2157`. Reviewed-new import preflight
found all 25 candidate-ready and imported them as local IDs `185411`-`185435`.
All 25 imported rows have official `pizza.dominos.com` location URLs and were
classified locally by deterministic chain inference as `Traditional`, `$`,
`inferred`. Scrape queue preflight found 25 website-backed candidates, but no
scrape jobs were written because the check ran in dry-run mode. Provenance
verification found 0 issue rows, and no Supabase rows were written. Domino's now
has 139 accepted likely-new rows, 1,557 linked likely-new rows, and 1,643
pending likely-new rows in the local review queue.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. The acceptance dry run scanned
250 pending Pizza Hut rows, skipped 51 nearby-canonical duplicate-risk rows,
used two canonical prefetch queries, and selected exact review IDs `11765`,
`11766`, `11767`, `11768`, `11769`, `11771`, `11772`, `11774`, `11775`,
`11776`, `11777`, `11778`, `11779`, `11780`, `11781`, `11782`, `11783`,
`11785`, `11786`, `11787`, `11788`, `11789`, `11790`, `11791`, and `11792`.
Reviewed-new import preflight found all 25 candidate-ready and imported them as
local IDs `185386`-`185410`. All 25 imported rows have official
`locations.pizzahut.com` store URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found 25 website-backed candidates, but no scrape jobs were written
because the check ran in dry-run mode. Provenance verification found 0 issue
rows, and no Supabase rows were written. Pizza Hut now has 183 accepted
likely-new rows, 1,135 linked likely-new rows, and 2,239 pending likely-new
rows in the local review queue.

The previous reviewed-new import slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. Exact-ID
reviewed-new preflight used review IDs `4342`-`4352`, `4354`-`4358`, `4360`,
`4363`-`4365`, and `4367`-`4371`; all 25 were candidate-ready and imported as
local IDs `185361`-`185385`. All 25 imported rows have official
`littlecaesars.com` store URLs and were classified locally by deterministic
chain inference as `Traditional`, `$`, `inferred`. Scrape queue preflight found
25 website-backed candidates, but no scrape jobs were written because the check
ran in dry-run mode. Provenance verification found 0 issue rows, and no
Supabase rows were written.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. Exact-ID reviewed-new
preflight used review IDs `6959`-`6963`, `6965`-`6974`, `6976`-`6982`, `6984`,
`6985`, and `6986`; all 25 were candidate-ready and imported as local IDs
`185336`-`185360`. All 25 imported rows have official
`locations.papajohns.com` location URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found 25 website-backed candidates, but no scrape jobs were written
because the check ran in dry-run mode. Provenance verification found 0 issue
rows, and no Supabase rows were written.

The previous reviewed-new import slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. Exact-ID reviewed-new
preflight used review IDs `2071`-`2090`, `2092`, `2093`, `2095`, `2096`, and
`2097`; all 25 were candidate-ready and imported as local IDs
`185311`-`185335`. All 25 imported rows have official `pizza.dominos.com`
location URLs and were classified locally by deterministic chain inference as
`Traditional`, `$`, `inferred`. Scrape queue preflight found 25 website-backed
candidates, but no scrape jobs were written because the check ran in dry-run
mode. Provenance verification found 0 issue rows, and no Supabase rows were
written.

The previous reviewed-new import slice: the remaining exact-ID Marco's rows from
the prior accepted batch were imported on 2026-07-17. Reviewed-new preflight
used review IDs `5567`, `5568`, `5569`, `5570`, `5573`, `5574`, `5575`,
`5576`, and `5577`; all nine were candidate-ready and imported as local IDs
`185302`-`185310`. These rows had no per-location website URLs, so no scraper
jobs were applicable. All nine imported rows were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Provenance
verification found 0 issue rows, and no Supabase rows were written.

The previous reviewed-new import slice: a follow-up Marco's batch accepted 25
two-signal likely-new candidates on 2026-07-17. Reviewed-new import preflight
then held nine nearby-canonical rows for duplicate review and imported the 16
candidate-ready rows as local IDs `185286`-`185301`. These rows had no
per-location website URLs, so no scraper jobs were applicable. All 16 imported
rows were classified locally by deterministic chain inference as
`Traditional`, `$$`, `inferred`. Provenance verification found 0 issue rows,
and no Supabase rows were written.

The previous reviewed-new review slice: another follow-up Pizza Hut batch
accepted 25 four-signal likely-new candidates on 2026-07-17. Reviewed-new
import preflight then held all 25 as nearby-canonical duplicate-review rows, so
no canonical places, `place_sources` rows, scrape jobs, or Supabase rows were
written for that slice. Pizza Hut now has 158 accepted likely-new rows, 1,110
linked likely-new rows, and 2,289 pending likely-new rows in the local review
queue. The accepted rows remain queued for later duplicate resolution rather
than automatic canonical insertion.

The previous reviewed-new review slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. Reviewed-new
import preflight then held all 25 as nearby-canonical duplicate-review rows, so
no canonical places, `place_sources` rows, scrape jobs, or Supabase rows were
written for that slice. The accepted rows remain queued for later duplicate
resolution rather than automatic canonical insertion.

The previous reviewed-new review slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. Reviewed-new import
preflight then held all 25 as nearby-canonical duplicate-review rows, so no
canonical places, `place_sources` rows, scrape jobs, or Supabase rows were
written for that slice. The accepted rows remain queued for later duplicate
resolution rather than automatic canonical insertion.

The previous reviewed-new import slice: a follow-up Little Caesars batch
accepted 25 four-signal likely-new candidates on 2026-07-17. Reviewed-new
import preflight then held 20 nearby-canonical rows for duplicate review and
imported the five candidate-ready rows as local IDs `185281`-`185285`. All
five rows have official `littlecaesars.com` store URLs and were classified
locally by deterministic chain inference as `Traditional`, `$`, `inferred`.
Scrape queue preflight found no new scrape jobs to add for this five-row slice.
Provenance verification found 0 issue rows, and no Supabase rows were written.

The previous reviewed-new import slice: a follow-up Papa John's batch accepted
25 four-signal likely-new candidates on 2026-07-17. Reviewed-new import
preflight then held 18 nearby-canonical rows for duplicate review and imported
the seven candidate-ready rows as local IDs `185274`-`185280`. All seven rows
have official `locations.papajohns.com` location URLs and were classified
locally by deterministic chain inference as `Traditional`, `$$`, `inferred`.
Scrape queue preflight found no new scrape jobs to add for this seven-row
slice. Provenance verification found 0 issue rows, and no Supabase rows were
written.

The previous reviewed-new review slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. Reviewed-new import preflight
then held all 25 as nearby-canonical duplicate-review rows, so no canonical
places, `place_sources` rows, scrape jobs, or Supabase rows were written for
that slice. The result leaves those rows accepted for later duplicate review
while preserving the no-automatic-canonical-insert boundary.

The previous reviewed-new review slice: a follow-up Domino's batch accepted 25
four-signal likely-new candidates on 2026-07-17. Reviewed-new import preflight
then held all 25 as nearby-canonical duplicate-review rows, so no canonical
places, `place_sources` rows, scrape jobs, or Supabase rows were written for
that slice. This was a useful guard outcome: the rows moved from pending to
accepted review state, but the stricter import preflight prevented duplicate
canonical inserts.

The previous reviewed-new import slice: a second follow-up Pizza Hut batch
accepted 25 four-signal likely-new candidates on 2026-07-17. Reviewed-new
import preflight then held 23 nearby-canonical rows for duplicate review and
imported the two candidate-ready rows as local IDs `185272`-`185273`. Both
rows have official `locations.pizzahut.com` location URLs and were classified
locally by deterministic chain inference as `Traditional`, `$$`, `inferred`.
Scrape queue preflight found no new scrape jobs to add for this two-row slice.
Provenance verification found 0 issue rows, and no Supabase rows were written.

The previous reviewed-new import slice: a follow-up Pizza Hut batch accepted 25
four-signal likely-new candidates on 2026-07-17. Reviewed-new import preflight
then held 17 nearby-canonical rows for duplicate review and imported the eight
candidate-ready rows as local IDs `185264`-`185271`. All eight rows have
official `locations.pizzahut.com` location URLs and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Scrape queue
preflight found no new scrape jobs to add for this eight-row slice. Provenance
verification found 0 issue rows, and no Supabase rows were written.

The previous reviewed-new import slice: two accepted Papa Murphy's candidates
were imported on 2026-07-17. Preflight inspected 26 accepted rows from
`papa_murphys-review.json`, held 24 nearby-canonical rows for duplicate
review, and imported the two candidate-ready rows as local IDs
`185262`-`185263`. Both rows have official `locations.papamurphys.com`
location URLs and were classified locally by deterministic chain inference as
`Traditional`, `$`, `inferred`. Scrape queue preflight found no new scrape jobs
to add for this two-row slice. Provenance verification found 0 issue rows, and
no Supabase rows were written.

The previous reviewed-new import slice: four accepted LaRosa's candidates were
imported on 2026-07-17. Preflight inspected six accepted rows from
`larosas-review.json`, held two nearby-canonical rows for duplicate review,
and imported the four candidate-ready rows as local IDs `185258`-`185261`.
All four rows have official `larosas.com` location URLs, received
high-priority scrape jobs, and were classified locally by deterministic chain
inference as `Traditional`, `$$`, `inferred`. Provenance verification found 0
issue rows, and no Supabase rows were written.

The previous reviewed-new import slice: five accepted Round Table candidates
were imported on 2026-07-17. Preflight inspected 25 accepted rows from
`round_table_pizza-review.json`, held 20 nearby-canonical rows for duplicate
review, and imported the five candidate-ready rows as local IDs
`185253`-`185257`. All five rows have official Round Table ordering URLs,
received high-priority scrape jobs, and were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. Provenance
verification found 0 issue rows, and no Supabase rows were written.

The previous reviewed-new import slice: 25 two-signal Marco's candidates were
accepted on 2026-07-17. The accept preview scanned 250 pending rows, skipped 29
nearby-canonical rows, used 118 canonical prefetch tiles in 2 queries, and
exact-ID preflight imported all 25 candidate-ready rows as local IDs
`185203`-`185227`. These rows had no per-location website URLs, so no scraper
jobs were applicable. All 25 imported rows were classified by deterministic
chain inference as `Traditional`, `$$`, `inferred`. Provenance verification
found 0 issue rows, and no Supabase rows were written.

The previous reviewed-new import slice accepted 25 high-signal Little Caesars
candidates on 2026-07-17. The accept preview scanned 250 pending rows, skipped
22 nearby-canonical rows, used 39 canonical prefetch tiles in 1 query, and
exact-ID preflight imported all 25 candidate-ready rows as local IDs
`185178`-`185202`. All 25 imported rows were scraped from official
`littlecaesars.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. Provenance verification found 0 issue rows, and no Supabase rows
were written.

The previous reviewed-new import slice accepted 25 high-signal Papa John's
candidates on 2026-07-17. The accept preview scanned 250 pending rows, skipped
24 nearby-canonical rows, used 100 canonical prefetch tiles in 1 query, and
exact-ID preflight imported all 25 candidate-ready rows as local IDs
`185153`-`185177`. All 25 imported rows were scraped from official
`locations.papajohns.com` pages and classified/priced as `Traditional`, `$$`,
`confirmed`. Provenance verification found 0 issue rows, and no Supabase rows
were written.

The previous reviewed-new import slices accepted 50 high-signal Domino's
candidates on 2026-07-17. Exact-ID preflight imported all 50 candidate-ready
rows as local IDs `185103`-`185152`. The second accept preview scanned 250
pending rows, skipped 27 nearby-canonical rows, used 49 canonical prefetch
tiles in 1 query, and imported local IDs `185128`-`185152`. All 50 imported
rows were scraped from official `pizza.dominos.com` pages and classified/priced
as `Traditional`, `$`, `confirmed`. Provenance verification found 0 issue rows,
and no Supabase rows were written.

The previous Pizza Hut reviewed-new import slice accepted 25 high-signal
candidates on 2026-07-17. The accept preview scanned 250 pending rows, skipped
41 nearby-canonical rows, and exact-ID preflight imported all 25
candidate-ready rows as local IDs `185078`-`185102`. All 25 imported rows were
scraped from official `locations.pizzahut.com` pages and classified/priced as
`Traditional`, `$$`, `confirmed`. No Supabase rows were written.

The same bounded path also accepted 25 high-signal Pizza Hut candidates on
2026-07-17. The accept preview scanned 250 pending rows, skipped 40
nearby-canonical rows, and exact-ID preflight imported all 25 candidate-ready
rows as local IDs `185040`-`185064`. All 25 imported rows were scraped from
official `locations.pizzahut.com` pages and classified/priced as
`Traditional`, `$$`, `confirmed`. No Supabase rows were written.

The same bounded path also accepted 25 high-signal Pizza Hut candidates on
2026-07-17. The accept preview scanned 250 pending rows, skipped 37
nearby-canonical rows, and exact-ID preflight imported all 25 candidate-ready
rows as local IDs `184965`-`184989`. All 25 imported rows were scraped from
official `locations.pizzahut.com` pages and classified/priced as
`Traditional`, `$$`, `confirmed`. No Supabase rows were written.

The same bounded path also accepted 25 high-signal Domino's candidates on
2026-07-17. Exact-ID preflight imported 24 candidate-ready rows as
local IDs `184816`-`184839`; all 24 were scraped from official
`pizza.dominos.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. One accepted Domino's candidate stayed held for manual import
review after preflight. No Supabase rows were written.

The same bounded path also accepted 25 high-signal Pizza Hut candidates on
2026-07-17. Exact-ID preflight imported 24 candidate-ready rows as local IDs
`184792`-`184815`; all 24 were scraped from official `locations.pizzahut.com`
pages and classified/priced as `Traditional`, `$$`, `confirmed`. One adjacent
Pizza Hut candidate stayed accepted for manual review because the preflight
found a nearby Domino's within the duplicate-review radius. No Supabase rows
were written.

The next bounded slice imported, scraped, and classified 23 high-signal Papa
John's candidates on 2026-07-17. Two adjacent Papa John's candidates stayed
accepted for manual review because preflight found nearby canonical places
within the duplicate-review radius. No Supabase rows were written.

The next bounded slice imported, scraped, classified, and published 5
high-signal Papa Murphy's candidates on 2026-07-17. The batch accepted 10
review rows, found 9 candidate-ready rows at preflight, imported local IDs
`183244`-`183248`, and inserted those exact reviewed-new rows into Supabase
through guarded id-scoped sync. One adjacent Papa Murphy's candidate stayed
accepted for manual review because preflight found a nearby canonical place
within the duplicate-review radius.

The next bounded slice imported, scraped, classified, and published 5
high-signal LaRosa's candidates on 2026-07-17. The batch accepted 10 review
rows, found 9 candidate-ready rows at preflight, imported local IDs
`183266`-`183270`, and inserted those exact reviewed-new rows into Supabase
through guarded id-scoped sync. One adjacent LaRosa's candidate stayed accepted
for manual review because preflight found a nearby canonical place within the
duplicate-review radius.

A follow-up Round Table slice accepted 25 high-signal candidates on 2026-07-17;
17 passed duplicate preflight and were imported locally, while 8 stayed accepted
for manual review near existing Round Table rows. The ordering-site scrape path
was slow for this source, but follow-up bounded retries completed all 17 local
rows: 16 were scraped from official ordering URLs, one cached-abort row was
fresh-retried with cache bypass, and all 17 are now classified/priced as
`Traditional`, `$$`. No Supabase rows were written.

A LaRosa's slice then accepted and imported 17 high-signal candidates on
2026-07-17 using exact review IDs so older duplicate-risk accepted rows stayed
out of the canonical import. Local IDs `183271`-`183287` were created with
reviewed-new provenance and official location URLs. All 17 were scraped in
bounded foreground scraper runs and classified/priced by the local classifier.
No Supabase rows were written.

Three Fox's Pizza slices then accepted 86 high-signal candidates on 2026-07-17;
82 passed duplicate preflight and were imported as local IDs `183288`-`183369`,
while five accepted rows stayed accepted for manual review near existing
canonical places. All 82 imported rows were scraped and classified/priced as
`Traditional`, `$$`, `confirmed`. No Supabase rows were written.

A follow-up Fox's Pizza slice then accepted the remaining two strong-ready
candidates on 2026-07-17. Exact-ID preflight imported both candidate-ready rows
as local IDs `183860`-`183861`. Both rows were scraped and classified/priced as
`Traditional`, `$$`, `confirmed`. No Supabase rows were written.

A follow-up Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Preflight inspected 37 accepted rows, held six nearby-canonical
rows for duplicate review, and imported 25 candidate-ready rows as local IDs
`183394`-`183418`. All 25 imported rows were scraped from official
`locations.papamurphys.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

A follow-up Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `183419`-`183440`.
All 22 imported rows were scraped from official `pizza.dominos.com` pages and
classified/priced with style, price range, and confidence populated. No
Supabase rows were written.

A follow-up Simple Simon's slice then imported 24 candidate-ready rows as local
IDs `183441`-`183464` on 2026-07-17. These rows had chain name, coordinates,
full street address, and phone, but no per-location website or menu URL, so no
scrape jobs were applicable. All 24 imported rows have reviewed-new provenance
and were classified locally by deterministic chain inference as `Traditional`,
`$$`, `inferred`. No Supabase rows were written.

Follow-up &pizza slices then accepted 33 source candidates on 2026-07-17. These
rows used store labels from the source feed, but reviewed-new preflight
normalizes `and_pizza-review.json` imports to canonical `&pizza`. Exact-ID
preflight excluded duplicate accepted-source coordinate rows and held nearby
canonical rows for review, then imported 25 candidate-ready rows as local IDs
`183465`-`183483` and `183514`-`183519`. All 25 imported rows were classified
locally by deterministic chain inference as `Traditional`, `$$`, `inferred`. No
Supabase rows were written.

A follow-up Sal's Pizza slice then accepted nine source candidates on
2026-07-17. These rows had store labels, coordinates, full street address, and
phone, but no per-location website URL. Preflight held two nearby-canonical rows
for review and imported seven candidate-ready rows as local IDs
`183484`-`183490`. All seven imported rows were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. No Supabase
rows were written.

A follow-up Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `183491`-`183513`.
All 23 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced with style, price range, and confidence populated. No
Supabase rows were written.

A follow-up Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `183520`-`183542`.
All 23 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`183543`-`183567`. All 25 imported rows were scraped from official
`locations.pizzahut.com` store pages and classified/priced as `Traditional`,
`$$`, `confirmed`. No Supabase rows were written.

A second follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `183591`-`183614`.
All 24 imported rows were scraped from official `locations.pizzahut.com` store
pages and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase
rows were written.

A follow-up Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `183568`-`183590`.
All 23 imported rows were scraped from official `pizza.dominos.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A second follow-up Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `183661`-`183684`.
All 24 imported rows were scraped from official `pizza.dominos.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A third follow-up Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `183836`-`183859`.
All 24 imported rows were scraped from official `pizza.dominos.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A fourth follow-up Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported all 25 candidate-ready rows as local
IDs `183990`-`184014`. All 25 imported rows were scraped from official
`pizza.dominos.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

A further Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184391`-`184412`.
All 22 imported rows were scraped from official `pizza.dominos.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `184435`-`184457`.
All 23 imported rows were scraped from official `pizza.dominos.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported all 25 candidate-ready rows as local
IDs `184576`-`184600`. All 25 imported rows were scraped from official
`pizza.dominos.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

A further Domino's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported all 25 candidate-ready rows as local
IDs `184722`-`184746`. All 25 imported rows were scraped from official
`pizza.dominos.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

A follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `183615`-`183638`.
All 24 imported rows were scraped from official `locations.pizzahut.com` store
pages and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase
rows were written.

A third follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `183792`-`183815`.
All 24 imported rows were scraped from official `locations.pizzahut.com` store
pages and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase
rows were written.

Another follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `183862`-`183885`.
All 24 imported rows were scraped from official `locations.pizzahut.com` store
pages and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase
rows were written.

Another follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `183947`-`183968`.
All 22 imported rows were scraped from official `locations.pizzahut.com` store
pages and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase
rows were written.

Another follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported all 25 candidate-ready rows as local
IDs `184015`-`184039`. All 25 imported rows were scraped from official
`locations.pizzahut.com` store pages and classified/priced as `Traditional`,
`$$`, `confirmed`. No Supabase rows were written.

A follow-up Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `183639`-`183660`.
All 22 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A second follow-up Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held five nearby-canonical rows for duplicate
review and imported 20 candidate-ready rows as local IDs `183707`-`183726`.
All 20 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A third follow-up Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `183917`-`183938`.
All 22 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184040`-`184061`.
All 22 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `184062`-`184084`.
All 23 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184413`-`184434`.
All 22 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184529`-`184550`.
All 22 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `184676`-`184699`.
All 24 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `184769`-`184791`.
All 23 imported rows were scraped from official `locations.papajohns.com` pages
and classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows
were written.

A further Papa John's slice then accepted 25 high-signal candidates on
2026-07-17. The accept preview scanned 250 pending rows, skipped 22
nearby-canonical rows, and exact-ID preflight imported all 25 candidate-ready
rows as local IDs `184915`-`184939`. All 25 imported rows were scraped from
official `locations.papajohns.com` pages and classified/priced as
`Traditional`, `$$`, `confirmed`. No Supabase rows were written.

A follow-up Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `183685`-`183706`.
All 22 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A second follow-up Little Caesars slice then accepted 25 high-signal candidates
on 2026-07-17. Exact-ID preflight held five nearby-canonical rows for duplicate
review and imported 20 candidate-ready rows as local IDs `183749`-`183768`.
All 20 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184085`-`184106`.
All 22 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held four nearby-canonical rows for duplicate
review and imported 21 candidate-ready rows as local IDs `184107`-`184127`.
All 21 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `184458`-`184481`.
All 24 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184747`-`184768`.
All 22 imported rows were scraped from official `littlecaesars.com` store pages
and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A further Little Caesars slice then accepted 25 high-signal candidates on
2026-07-17. The accept preview scanned 250 pending rows, skipped 21
nearby-canonical rows, and exact-ID preflight imported all 25 candidate-ready
rows as local IDs `184940`-`184964`. All 25 imported rows were scraped from
official `littlecaesars.com` store pages and classified/priced as
`Traditional`, `$`, `confirmed`. No Supabase rows were written.

A follow-up Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `183727`-`183748`.
All 22 imported rows were scraped from official `locations.papamurphys.com`
pages and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase
rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `184153`-`184175`.
All 23 imported rows were scraped from official `locations.papamurphys.com`
pages and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase
rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184176`-`184197`.
All 22 imported rows were scraped from official `locations.papamurphys.com`
pages and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase
rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `184273`-`184296`.
All 24 imported rows were scraped from official `locations.papamurphys.com`
pages and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase
rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184297`-`184321`. All 25 imported rows were scraped from official
`locations.papamurphys.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `184322`-`184344`.
All 23 imported rows were scraped from official `locations.papamurphys.com`
pages and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase
rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held three nearby-canonical rows for duplicate
review and imported 22 candidate-ready rows as local IDs `184345`-`184366`.
All 22 imported rows were scraped from official `locations.papamurphys.com`
pages and classified/priced as `Traditional`, `$`, `confirmed`. No Supabase
rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight imported 25 candidate-ready rows as local IDs
`184651`-`184675` and left nearby-canonical rows in review. All 25 imported rows
have official `locations.papamurphys.com` URLs; 25 scrape jobs were queued, and
deterministic chain inference filled local classification as `Traditional`, `$`,
`inferred`. No Supabase rows were written.

A further Papa Murphy's slice then accepted 25 high-signal candidates on
2026-07-17. The accept preview scanned the remaining 44 strong-ready pending
rows, skipped seven nearby-canonical rows, and exact-ID preflight imported all
25 candidate-ready rows as local IDs `185015`-`185039`. All 25 imported rows
were scraped from official `locations.papamurphys.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A final Papa Murphy's strong-ready cleanup accepted the remaining 12
candidate-ready rows on 2026-07-17 as local IDs `185065`-`185076`. A follow-up
dry run scanned the last seven strong-ready rows and skipped all seven as
nearby-canonical duplicate-review cases, leaving no clean Papa Murphy's
strong-ready import candidates at the default 150m guard. The 12 imported rows
were scraped from official `locations.papamurphys.com` pages and
classified/priced as `Traditional`, `$`, `confirmed`. No Supabase rows were
written.

A follow-up Pizza Hut slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `184367`-`184390`.
Twenty-one rows were scraped from official `locations.pizzahut.com` pages and
classified/priced as `Traditional`, `$$`, `confirmed`; three GU/MP rows with no
usable scrape result were filled by deterministic chain inference as
`Traditional`, `$$`, `inferred`. No Supabase rows were written.

A further Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
Exact-ID preflight held two nearby-canonical rows for duplicate review and
imported 23 candidate-ready rows as local IDs `184482`-`184504`. All 23 imported
rows were scraped from official `locations.pizzahut.com` store pages and
classified/priced as `Traditional`, `$$`, `confirmed`. No Supabase rows were
written.

A further Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
Exact-ID preflight held three nearby-canonical rows for duplicate review and
imported 22 candidate-ready rows as local IDs `184700`-`184721`. All 22 imported
rows have official `locations.pizzahut.com` URLs; deterministic chain inference
filled local classification as `Traditional`, `$$`, `inferred`. No Supabase rows
were written.

A follow-up Simple Simon's slice then accepted 25 source candidates on
2026-07-17. Exact-ID preflight held two nearby-canonical rows for duplicate
review and imported 23 candidate-ready rows as local IDs `183769`-`183791`.
These rows had no per-location website URLs, so no scrape jobs were applicable.
All 23 imported rows were classified locally by deterministic chain inference
as `Traditional`, `$$`, `inferred`. No Supabase rows were written.

A further Simple Simon's slice then accepted 25 source candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 24 candidate-ready rows as local IDs `184198`-`184221`.
These rows had no per-location website URLs, so no scrape jobs were applicable.
All 24 imported rows were classified locally by deterministic chain inference
as `Traditional`, `$$`, `inferred`. No Supabase rows were written.

Two further Simple Simon's slices then accepted 50 source candidates on
2026-07-17. Exact-ID preflight held one nearby-canonical row for duplicate
review and imported 49 candidate-ready rows as local IDs `184222`-`184270`.
These rows had no per-location website URLs, so no scrape jobs were applicable.
All 49 imported rows were classified locally by deterministic chain inference
as `Traditional`, `$$`, `inferred`. No Supabase rows were written.

A final Simple Simon's strong-ready cleanup accepted two source candidates on
2026-07-17. Exact-ID preflight imported both as local IDs `184271`-`184272`.
These rows had no per-location website URLs, so no scrape jobs were applicable.
Both rows were classified locally by deterministic chain inference as
`Traditional`, `$$`, `inferred`. No Supabase rows were written.

A final two-signal Simple Simon's cleanup accepted one remaining candidate-ready
row on 2026-07-17. Exact-ID preflight imported it as local ID `185077`; it had
no per-location website URL, so no scrape job was applicable. Deterministic
chain inference classified it locally as `Traditional`, `$$`, `inferred`. No
Supabase rows were written.

A follow-up Round Table slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held five nearby-canonical rows for duplicate
review and imported 20 candidate-ready rows as local IDs `183816`-`183835`.
All 20 imported rows were scraped and classified/priced as `Traditional`, `$$`,
`confirmed`. No Supabase rows were written.

A second follow-up Round Table slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held nine nearby-canonical rows for duplicate
review and imported 16 candidate-ready rows as local IDs `183886`-`183901`.
All 16 imported rows were scraped and classified/priced as `Traditional`, `$$`,
`confirmed`. No Supabase rows were written.

A third follow-up Round Table slice then accepted 25 high-signal candidates on
2026-07-17. Exact-ID preflight held ten nearby-canonical rows for duplicate
review and imported 15 candidate-ready rows as local IDs `183902`-`183916`.
All 15 imported rows were scraped and classified/priced as `Traditional`, `$$`,
`confirmed`. No Supabase rows were written.

A final Round Table cleanup slice then accepted nine remaining strong-signal
candidates on 2026-07-17. Exact-ID preflight held one nearby-canonical row for
duplicate review and imported eight candidate-ready rows as local IDs
`183939`-`183946`. Six rows were scraped and classified/priced as
`Traditional`, `$$`, `confirmed`; the two no-website rows were filled by
deterministic chain inference as `Traditional`, `$$`, `inferred`. No Supabase
rows were written.

A first Marco's slice then accepted 25 two-signal candidates on 2026-07-17.
Exact-ID preflight held four nearby-canonical rows for duplicate review and
imported 21 candidate-ready rows as local IDs `183969`-`183989`. These rows had
no per-location website URLs, so no scrape jobs were applicable. All 21
imported rows were classified locally by deterministic chain inference as
`Traditional`, `$$`, `inferred`. No Supabase rows were written.

A second Marco's slice then accepted 25 two-signal candidates on 2026-07-17.
Exact-ID preflight held one nearby-canonical row for duplicate review and
imported 24 candidate-ready rows as local IDs `184505`-`184528`. These rows had
no per-location website URLs, so no scrape jobs were applicable. All 24
imported rows were classified locally by deterministic chain inference as
`Traditional`, `$$`, `inferred`. No Supabase rows were written.

A third Marco's slice then accepted 25 two-signal candidates on 2026-07-17.
Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184551`-`184575`. These rows had no per-location website URLs, so no scrape
jobs were applicable. All 25 imported rows were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. No Supabase
rows were written.

A fourth Marco's slice then accepted 25 two-signal candidates on 2026-07-17.
Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184601`-`184625`. These rows had no per-location website URLs, so no scrape
jobs were applicable. All 25 imported rows were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. No Supabase
rows were written.

A fifth Marco's slice then accepted 25 two-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 26 nearby-canonical rows,
and exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184990`-`185014`. These rows had no per-location website URLs, so no scrape
jobs were applicable. All 25 imported rows were classified locally by
deterministic chain inference as `Traditional`, `$$`, `inferred`. No Supabase
rows were written.

A sixth Marco's slice then accepted 25 two-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 33 nearby-canonical rows,
used 115 canonical prefetch tiles in 2 queries, and exact-ID preflight imported
all 25 candidate-ready rows as local IDs `185228`-`185252`. These rows had no
per-location website URLs, so no scrape jobs were applicable. All 25 imported
rows were classified locally by deterministic chain inference as `Traditional`,
`$$`, `inferred`. Provenance verification found 0 issue rows, and no Supabase
rows were written.

A further Domino's slice then accepted 25 high-signal candidates on 2026-07-17.
Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184128`-`184152`. All 25 imported rows were scraped from official
`pizza.dominos.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

Another Domino's slice then accepted 25 high-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 22 nearby-canonical rows,
and exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184890`-`184914`. All 25 imported rows were scraped from official
`pizza.dominos.com` pages and classified/priced as `Traditional`, `$`,
`confirmed`. No Supabase rows were written.

Another Domino's slice then accepted 25 high-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 48 nearby-canonical rows,
used 79 canonical prefetch tiles in 1 query, and exact-ID preflight imported
all 25 candidate-ready rows as local IDs `186311`-`186335`. All 25 imported
rows were scraped from official `pizza.dominos.com` pages. The classifier
confirmed 23 rows as `Traditional`, `$`, `confirmed`, and deterministic chain
inference filled the remaining two rows as `Traditional`, `$`, `inferred`.
Provenance verification found 0 issue rows, and no Supabase rows were written.

Another Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184015`-`184039`. All 25 imported rows were scraped from official
`locations.pizzahut.com` pages and classified/priced as `Traditional`, `$$`,
`confirmed`. No Supabase rows were written.

Another Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
Exact-ID preflight imported all 25 candidate-ready rows as local IDs
`184626`-`184650`. All 25 imported rows were scraped from official
`locations.pizzahut.com` pages and classified/priced as `Traditional`, `$$`,
`confirmed`. No Supabase rows were written.

Another Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 94 nearby-canonical rows,
used 160 canonical prefetch tiles in 2 queries, and exact-ID preflight imported
all 25 candidate-ready rows as local IDs `186386`-`186410`. All 25 imported
rows were scraped from official `locations.pizzahut.com` pages. The classifier
confirmed 24 rows as `Traditional`, `$$`, `confirmed`, and deterministic chain
inference filled the remaining row as `Traditional`, `$$`, `inferred`.
Provenance verification found 0 issue rows, and no Supabase rows were written.

Another Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 98 nearby-canonical rows,
used 160 canonical prefetch tiles in 2 queries, and exact-ID preflight imported
all 25 candidate-ready rows as local IDs `186436`-`186460`. All 25 imported
rows were scraped from official `locations.pizzahut.com` pages. The classifier
confirmed 23 rows as `Traditional`, `$$`, `confirmed`, and deterministic chain
inference filled the remaining two rows as `Traditional`, `$$`, `inferred`.
Provenance verification found 0 issue rows, and no Supabase rows were written.

Another Pizza Hut slice then accepted 25 high-signal candidates on 2026-07-17.
The accept preview scanned 250 pending rows, skipped 99 nearby-canonical rows,
used 157 canonical prefetch tiles in 2 queries, and exact-ID preflight imported
all 25 candidate-ready rows as local IDs `186486`-`186510`. All 25 imported
rows were scraped from official `locations.pizzahut.com` pages. The classifier
confirmed 22 rows as `Traditional`, `$$`, `confirmed`, and deterministic chain
inference filled the remaining three rows as `Traditional`, `$$`, `inferred`.
Provenance verification found 0 issue rows, and no Supabase rows were written.

Current ATP spider gaps are explicit disabled rows in
`config/atp-pizza-spiders.json`: Hungry Howie's has no matching spider in the
July 2026 ATP stats, and `jet` matches non-pizza fuel/convenience spiders rather
than Jet's Pizza. A live discovery audit on 2026-07-17 against ATP run
`2026-07-11-13-32-25` still found `howie=0`, `howies=0`, unrelated `hungry_*`
brands, and only `jet_de_at` / `jet_gb` for `jet`. Additional
checked-but-unusable regional spiders in that run are also disabled in the
manifest: zero-feature `blaze_pizza`,
`lou_malnatis_pizzeria_us`, `godfathers_pizza`, and `old_chicago_us`.

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

Use this to rank likely-new source buckets by import readiness and evidence
quality:

```bash
node scripts/ops/reviewed-new-source-backlog-report.mjs \
  --min-signals 3 \
  --max-rows 20
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
  --limit 100 \
  --nearby-radius-m 150
```

Apply only after reviewing the dry-run sample:

```bash
node scripts/ops/accept-likely-new-source-candidates.mjs \
  --entity pizza \
  --min-signals 3 \
  --limit 100 \
  --nearby-radius-m 150 \
  --apply
```

This tool only changes pending `likely_new` rows to `accepted` when they are
`candidate_ready`, have enough evidence signals, and pass a fresh
nearby-canonical duplicate check using the same default 150m radius as import
preflight. It does not create canonical places, write `place_sources`, promote
fields, or sync Supabase. Accepted rows must still pass reviewed-new import
preflight before any local canonical row is created.

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
