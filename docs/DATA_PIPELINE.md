# Data Pipeline (Current)

This document describes how APizzaMichigan/TacoBoutMichigan data is **imported**, **enriched**, and **maintained**.

> Source of truth for coverage numbers: `docs/world-coverage.md` and `public/data/dashboard-stats.json`.

## Overview

We maintain two primary datasets in Supabase (PostgreSQL):

- `pizza_places`
- `taco_places`

Data is sourced primarily from **OpenStreetMap (OSM)** via the **Overpass API**, then optionally enriched via a **local-first enrichment pipeline** (OSM deep tags + website scraping + local LLM classification) before syncing updates back to Supabase.

## 1) Import: OSM → Supabase

### Primary source: OpenStreetMap (Overpass)

**Query approach (high level):**
- Overpass API queries for `amenity=restaurant` and `amenity=fast_food`
- Filter by cuisine tags (e.g. `cuisine=pizza`) and/or name patterns for global scripts
- Extract at minimum: name, coordinates, OSM identifiers, and any available tags (address/website/phone/hours when present)

### Import scripts

**US state-by-state:**
- `scripts/import-osm-pizza.mjs`
- `scripts/import-osm-tacos.mjs`
- `scripts/import-all-states.mjs`
- `scripts/import-all-tacos-states.mjs`

**Region-based international imports:**
- `scripts/import-international.mjs` (Canada + Mexico)
- `scripts/import-europe.mjs`
- `scripts/import-latin-america.mjs`

**Global/country-level scripts (name/chains/cuisine heuristics):**
- `scripts/import-pizzerias-by-name.mjs`
- `scripts/import-chains.mjs`
- `scripts/import-additional-cuisines.mjs`
- `scripts/import-street-food.mjs`
- `scripts/import-retry-failed.mjs`

### Coverage

Coverage has expanded well beyond US-only.

See:
- `docs/world-coverage.md` (country-by-country)

## 2) Baseline enrichment (existing scripts)

These are “in-Supabase” enrichment steps that infer metadata from existing fields (name, chain match, etc.):

- Pizza: `scripts/populate-pizza-metadata.mjs` using `scripts/lib/style-inference.mjs`
- Tacos: `scripts/populate-taco-metadata.mjs` using `scripts/lib/type-inference-tacos.mjs`

These are useful, but they are limited by what OSM provided during import.

## 3) Local-first enrichment pipeline (recommended path forward)

For deeper enrichment (style/price/address/website/phone/hours confidence), we use a **local working database** and worker agents.

Canonical docs:
- Architecture: `docs/data-enhancement-architecture.md`
- Setup guide: `scripts/enrichment/SETUP.md`

### What it does

1. **One-time seed:** pull Supabase tables down to local Postgres
   - `scripts/enrichment/sync-from-supabase.mjs`

2. **Enrichment loop:**
   - **OSM deep extract**: query Overpass by known OSM element IDs to fetch full tags
   - **Website scrape**: simple fetch-based scrape when a website URL is present
   - **LLM classification** (planned): run **Ollama** locally to classify into the project’s exact taxonomy

3. **Sync back to Supabase** (planned): batch UPDATE enriched fields from local Postgres

### Current implementation status

Implemented foundation:
- Queue + worker tracking: `scripts/enrichment/queue.mjs` (SQLite)
- Local DB schemas: `scripts/enrichment/local-schema.sql`, `local-schema-v2.sql`
- Agents: `scripts/enrichment/agents/coordinator.mjs`, `osm-extractor.mjs`, `web-scraper.mjs`

Planned (not implemented yet):
- `scripts/enrichment/agents/llm-classifier.mjs`
- `scripts/enrichment/agents/sync-agent.mjs`

## 4) Maintenance / operational cadence

Recommended cadence:
- **Imports:** quarterly (or as-needed for new regions)
- **Metadata inference scripts:** after imports
- **Local-first enrichment:** run continuously or in batches (MI → major US → broader)
- **Sync back to Supabase:** daily batch (once implemented)

## 5) Common issues

- **OSM region name mismatch:** OSM boundaries often use native-language names (e.g. “Bayern”, not “Bavaria”).
- **Overpass timeouts/429s:** use built-in retry/fallback endpoints and respect delays.
- **Country/state code conflicts:** some global scripts use ISO country codes in the `state` field; this can collide with regional codes and affect dashboard counts. See `docs/world-coverage.md`.
