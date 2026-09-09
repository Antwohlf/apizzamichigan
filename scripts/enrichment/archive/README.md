# Enrichment Archive

This folder contains the previous enrichment pipeline generation:

- `orchestrator.mjs`
- `watchdog.mjs`
- `watchdog-keepalive.mjs`
- legacy workers under `legacy-workers/`

These files are historical references, not supported launch instructions.
`watchdog-keepalive.mjs` now exits without starting anything; its historical
implementation was preserved privately and remains in Git history.

Active workers and schedules live in `packages/food-runtime` in the
[external pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
Do not start archived workers or restore website-owned pipeline schedules.
