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

In apply mode, the scheduled source runner also performs a bounded contact
promotion step after source work. It fills blank `website_url` and `phone`
values from fresh, high-confidence `place_sources` evidence, capped by
`config/source-pipeline.json` -> `limits.contact_promotions_per_run`
(currently 50). This remains fill-if-blank only and never changes identity,
editorial, classifier, or Supabase data.

Current production rollout is classifier-first with guarded automated Supabase
sync. The iMac launchd source feeder refreshes Michigan and New York OSM tiles
on a bounded cadence, records source evidence, and promotes only approved blank
contact fields. Website scraping and menu parsing remain separately managed so
they cannot create an unbounded second writer.

The authenticated admin home exposes a regional basic-field coverage view for
active Michigan and New York places. It reports missing address, website, phone,
style, and price values without pretending that every gap is safe to fill
automatically: contact blanks can use accepted evidence, while identity and
editorial fields remain review- or classifier-owned.

## Supabase Sync Scope

Supabase sync writes only canonical `pizza_places` rows. Provenance and review
tables such as `place_sources` and `source_review_queue` are local operator
state and are not public sync targets.

### Public Search Performance

The public map keeps its existing substring search across names, addresses,
styles, brands, and operators. Apply
`scripts/enrichment/supabase-production-migration.sql` in the Supabase SQL
editor after the table columns are present. It enables `pg_trgm` and adds
idempotent indexes for the fields searched by both the pizza and taco sites;
the migration does not change records or search behavior.

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
