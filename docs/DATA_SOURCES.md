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
| Official restaurant websites | Enrichment evidence | Scraped only from URLs discovered through reusable sources or manual/admin input. Used for website/menu/contact/style evidence. |
| Government/open datasets | Supplemental coverage and validation | Use only when licensing is clearly reusable. Good for existence, address, inspection/license metadata, and freshness checks. |
| Manual/admin input | Editorial source | Highest-trust source for reviewed places, corrections, photos, notes, status, and curated lists. |
| User suggestions | Pending input | Suggestions are not canonical until approved by admin/editorial flow. |

## Non-Ingestion Sources

| Source | Policy |
| --- | --- |
| Google Maps / Google Places | Do not use as a machine-seeded source of record. Do not bulk harvest place details, websites, phone numbers, or coordinates into the durable database. |
| Editorial/top lists | Deferred for now. If used later, store only curation/list membership with attribution, not copied article content. |
| Proprietary review platforms/directories | Do not ingest as durable place facts unless licensing explicitly allows it. |

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
