# Repository Structure

This repo stays a monorepo for now. The immediate priority is a stable
APizzaMichigan production runner on the Michigan iMac, not a broad package
split.

## Current Ownership Boundaries

```text
src/                         React app
public/                      CRA public assets and generated dashboard JSON
api/                         serverless-style API handlers
server/                      local Express API/server
scripts/                     imports, sync, one-off tools
scripts/enrichment/          current local enrichment pipeline
scripts/enrichment/archive/  retired pipeline generation
infra/local/                 local service templates and machine operations
docs/                        current architecture and operations docs
docs/archive/                historical references and postmortems
```

## Active Pipeline Boundary

Active enrichment code is under `scripts/enrichment/agents/`, supported by
`scripts/enrichment/queue.mjs`, local schemas, and the ops scripts under
`scripts/ops/`.

The archived `orchestrator.mjs + watchdog.mjs + workers/* + enrichment_queue`
generation is kept for reference only. Do not use archived scripts for current
operations.

## Future Reuse

TacoBoutMichigan and future database projects should not drive abstraction yet.
Stabilize APizzaMichigan first. Once the iMac runner is reliable, extract only
the stable contracts:

- place type definitions
- taxonomies
- sync allowlists
- status/report shapes
- launchd/service templates

Avoid moving the CRA app until the frontend build tool decision is explicit.

## Guardrails

- Keep behavior changes separate from large file moves where practical.
- Do not stage `.env`, logs, queue DBs, progress JSON, status JSON, caches, or auth files.
- Do not run direct Supabase write syncs as part of structural changes.
- Keep data ingestion changes aligned with `docs/DATA_SOURCES.md`.
- Verify active scripts after pipeline edits:

```bash
find scripts/enrichment scripts/ops -name '*.mjs' -print0 | xargs -0 -n1 node --check
npm run typecheck
npm run lint
CI=true npm test -- --watchAll=false
```

Dry-run sync before any write:

```bash
node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1
```
