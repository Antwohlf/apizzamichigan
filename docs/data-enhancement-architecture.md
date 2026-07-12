# Local-First Multi-Agent Enrichment Pipeline (Current Architecture)

**Status:** Implemented foundation (OSM extract + web scrape + local DB + queue). LLM classification + Supabase sync agents are planned but not yet implemented (see `scripts/enrichment/SETUP.md`).

This document describes the **current** enrichment approach in this repo.

## Executive summary

We enrich places **locally** (on the iMac) using:

- **Overpass / OSM calls** (read from OSM)
- **Website scraping** (simple fetch)
- **Local LLM** via **Ollama** (primary) to classify style/price
- **Local PostgreSQL** as the working/enriched database
- Periodic **batch UPDATE sync to Supabase** (writes back to hosted DB)

The key idea is: do expensive reads + processing locally, then only push results to Supabase.

## What “local-first” means here

### Data flow (canonical)

1. **One-time seed:** pull current tables from Supabase → local Postgres
   - Script: `scripts/enrichment/sync-from-supabase.mjs`

2. **Enrichment loop (repeatable):**
   - Use a **local job queue** to schedule/track work
   - Extract richer OSM tags (Overpass) for known OSM elements
   - Scrape restaurant websites when available
   - Run **local LLM** classification (Ollama) for style/price
   - Write results into **local Postgres**

3. **Sync back:** batch-update Supabase from local Postgres
   - (Planned) agent: `scripts/enrichment/agents/sync-agent.mjs`

### Why this approach

- **Cost + reliability:** local processing avoids repeated Supabase reads during enrichment.
- **Quality control:** we can iterate/inspect locally before writing changes back.
- **Resumability:** job queue + worker registry lets the pipeline pause/restart without losing state.

## Implementation in this repo (source of truth)

The source of truth is the code and setup guide under:

- `scripts/enrichment/SETUP.md` (how to run it)
- `scripts/enrichment/queue.mjs` (SQLite queue + worker tracking)
- `scripts/enrichment/local-schema.sql` and `local-schema-v2.sql` (local Postgres schema)
- `scripts/enrichment/agents/*` (worker agents)

### What is implemented today

- **Coordinator:** `scripts/enrichment/agents/coordinator.mjs`
  - Spawns/monitors workers
  - Populates jobs (by priority)

- **OSM extractor:** `scripts/enrichment/agents/osm-extractor.mjs`
  - Overpass queries by OSM element ID
  - Stores extracted tags/fields into local Postgres

- **Web scraper:** `scripts/enrichment/agents/web-scraper.mjs`
  - Simple fetch-based scraping (no browser automation yet)
  - Stores scrape outcomes/hints for later classification

- **Queue:** `scripts/enrichment/queue.mjs`
  - SQLite-backed queue for atomic job claiming, stats, and worker heartbeats

### What is planned (not implemented yet)

- **LLM classifier:** `scripts/enrichment/agents/llm-classifier.mjs`
  - Calls **Ollama** (`http://localhost:11434`) as primary
  - Optional Groq fallback
  - Writes style/price classifications + caches results

- **Supabase sync agent:** `scripts/enrichment/agents/sync-agent.mjs`
  - Batch UPDATE Supabase from local Postgres
  - Runs daily (or on demand)

## Notes on “zero egress” wording

You may see older references to “zero egress”. The intent is:

- Avoid **repeated Supabase reads** during enrichment (only seed once, then work locally)
- Push results back via **writes** (UPDATEs)

We still make outbound network calls to:

- Overpass (OSM)
- Restaurant websites (scraping)
- Optional LLM APIs (only if you enable a fallback)

## Outdated/removed architecture assumptions

Older drafts described a Redis/BullMQ worker system. The current repo implementation does **not** use Redis/BullMQ.

- Current queue: **SQLite** (`scripts/enrichment/queue.mjs`)
- Working DB: **PostgreSQL** (local)
- Orchestration: **Node agents** under `scripts/enrichment/agents/`

If we ever outgrow SQLite (scale/observability), Redis/BullMQ could be reintroduced intentionally, but it is not the current path.

## Setup guide

Follow:

- `scripts/enrichment/SETUP.md`

That doc is the operational playbook for getting the pipeline running locally.
