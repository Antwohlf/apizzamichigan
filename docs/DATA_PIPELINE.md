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

Current production rollout is classifier-first with guarded automated Supabase
sync. OSM extraction, scraping, and menu parse remain manual/opt-in until their
source and quality policies are tightened.

## Supabase Sync Scope

Supabase sync writes only canonical `pizza_places` rows. Provenance and review
tables such as `place_sources` and `source_review_queue` are local operator
state and are not public sync targets.

The normal automated path is the guarded recent-classification window:

```bash
node scripts/ops/guarded-supabase-sync.mjs
```

For reviewed/manual batches, use exact ID scope so unrelated recent
classifier/scraper changes are not swept into the same operation:

```bash
node scripts/ops/supabase-sync-readiness-report.mjs --ids 123,456
node scripts/ops/guarded-supabase-sync.mjs --ids 123,456
node scripts/ops/guarded-supabase-sync.mjs --ids 123,456 --apply
```

The ID-scoped guarded runner still performs health, QA, readiness, dry-run, and
post-check gates. It disables checkpoint mode for that run because the selected
IDs are the complete sync scope.

## Classifier Runtime

The classifier runs locally against Ollama:

- default model: `llama3.2:latest`
- override: `OLLAMA_MODEL`
- conservative output cap: `OLLAMA_NUM_PREDICT=80`
- conservative timeout: `OLLAMA_TIMEOUT_MS=240000`

It writes style, price range, confidence, and `last_enriched_at` to local
Postgres. Supabase is updated by the guarded launchd sync service only after
health, QA, readiness, dry-run, and protected-field gates pass.

## Source Policy

Data source and trust rules live in `docs/DATA_SOURCES.md`.

Important operating rule:

> Google Maps is an outbound navigation destination, not an ingestion source.

## Operations

Canonical iMac runbook:

- `docs/IMAC_PIPELINE_RUNBOOK.md`

Useful reports:

```bash
node scripts/ops/classifier-health-report.mjs
node scripts/ops/classification-qa-report.mjs --hours 24 --limit 500 --sample 25
node scripts/ops/home-status-report.mjs
node scripts/ops/classifier-batch-report.mjs --max-jobs 25 --timeout-ms 240000 --num-predict 80 --temperature 0
node scripts/ops/stale-worker-cleanup.mjs
```

## Archived Legacy Path

The older `scripts/enrichment/orchestrator.mjs`, watchdog, and
`scripts/enrichment/workers/*` pipeline generation has been archived under
`scripts/enrichment/archive/`. It used a different model and is not the current
operational path.
