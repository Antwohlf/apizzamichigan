# Enrichment Pipeline Setup

The current iMac operating guide lives in:

- `docs/IMAC_PIPELINE_RUNBOOK.md`

This file remains as a short pointer because older notes and commands reference
`scripts/enrichment/SETUP.md`.

Canonical active pipeline code:

- `scripts/enrichment/agents/llm-classifier.mjs`
- `scripts/enrichment/agents/coordinator.mjs`
- `scripts/enrichment/agents/osm-extractor.mjs`
- `scripts/enrichment/agents/web-scraper.mjs`
- `scripts/enrichment/queue.mjs`
- `scripts/sync-local-to-supabase.mjs`
- `scripts/ops/home-status-report.mjs`
- `scripts/ops/stale-worker-cleanup.mjs`

Archived legacy pipeline code is under `scripts/enrichment/archive/`.
