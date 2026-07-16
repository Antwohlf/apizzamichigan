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
| All the Places | Chain and official location-finder supplement | Durable according to project output license; retain spider/source URL | High | Prototype after FSQ slice |
| Overture Places | External IDs, dedupe, confidence/source metadata | Generally durable, but release/theme attribution must be checked | Medium | Evaluate after FSQ/ATP overlap measurement |
| Wikidata | Chain/notable-place enrichment and external IDs | Durable under CC0 structured data | Medium | Add as enrichment after external IDs table exists |
| Government/open data | License/inspection/existence overlays | Durable only when dataset license permits | Medium | Jurisdiction-by-jurisdiction registry |
| DENUE / INEGI | Mexico establishment coverage | Likely durable with attribution/metadata obligations | Future high | Investigate before Mexico expansion |
| Official restaurant websites | Field evidence from first-party sources | Store factual extracted fields and short evidence; avoid expressive content | Active/manual | Scraper exists but broad operation remains opt-in |
| Google Maps / Google Places | Navigation links only | Do not use for durable canonical ingestion | Navigation only | Popup/admin outbound links |

## Build Order

1. Keep OSM as the current production backbone.
2. Add the shared `place_sources` provenance table before importing another broad source.
   The first implementation phase is pizza-only; do not backfill TacoBout yet.
3. Prototype a Michigan or North America slice of Foursquare OS Places with a
   read-only exported sample.
4. Measure FSQ overlap and gaps against current OSM-derived `pizza_places`.
5. Prototype All the Places for pizza/taco chains and regional restaurant groups.
6. Evaluate Overture only after FSQ and ATP show their incremental coverage.
7. Build a government/open-data registry for the jurisdictions that matter most.
8. Treat DENUE as a separate future track for Mexico/TacoBout expansion.

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

## Primary References

- Foursquare OS Places: https://opensource.foursquare.com/os-places/
- Foursquare OS Places notice: https://opensource.foursquare.com/places-notice-txt/
- All the Places: https://alltheplaces.xyz/
- Overture attribution: https://docs.overturemaps.org/attribution/
- Overture AWS registry: https://registry.opendata.aws/overture/
- INEGI terms: https://en.www.inegi.org.mx/inegi/terminos.html
- DENUE: https://en.www.inegi.org.mx/app/mapa/denue/default.aspx
