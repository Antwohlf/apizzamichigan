# Data Pipeline

APizzaMichigan maintains public data in Supabase and enriches it locally on the
Michigan iMac before controlled sync-back.

## Import Path

OpenStreetMap imports populate Supabase using the root-level import scripts:

- `scripts/import-osm-pizza.mjs`
- `scripts/import-osm-tacos.mjs`
- region/global helpers such as `scripts/import-europe.mjs` and `scripts/import-pizzerias-by-name.mjs`

Coverage details live in `docs/world-coverage.md`.

## Local Enrichment Path

The current local-first pipeline is:

1. Seed or refresh local Postgres from Supabase with `scripts/enrichment/sync-from-supabase.mjs`.
2. Use SQLite `scripts/.job-queue.db` for queue state and worker heartbeats.
3. Enrich local Postgres through active agents:
   - OSM deep extraction: `scripts/enrichment/agents/osm-extractor.mjs`
   - website scraping: `scripts/enrichment/agents/web-scraper.mjs`
   - classification: `scripts/enrichment/agents/llm-classifier.mjs`
4. Sync approved local enrichment fields back to Supabase with `scripts/sync-local-to-supabase.mjs`.

Current production rollout is classifier-first. OSM extraction, scraping,
menu parse, QA, and Supabase write sync are manual until separately approved.

## Classifier Runtime

The classifier runs locally against Ollama:

- default model: `llama3.2:latest`
- override: `OLLAMA_MODEL`
- conservative output cap: `OLLAMA_NUM_PREDICT=80`
- conservative timeout: `OLLAMA_TIMEOUT_MS=240000`

It writes style, price range, confidence, and `last_enriched_at` to local
Postgres. Supabase is not updated until the manual sync path is run.

## Operations

Canonical iMac runbook:

- `docs/IMAC_PIPELINE_RUNBOOK.md`

Useful reports:

```bash
node scripts/ops/classifier-health-report.mjs
node scripts/ops/home-status-report.mjs
node scripts/ops/classifier-batch-report.mjs --max-jobs 25 --timeout-ms 240000 --num-predict 80 --temperature 0
node scripts/ops/stale-worker-cleanup.mjs
```

## Archived Legacy Path

The older `scripts/enrichment/orchestrator.mjs`, watchdog, and
`scripts/enrichment/workers/*` pipeline generation has been archived under
`scripts/enrichment/archive/`. It used a different model and is not the current
operational path.
