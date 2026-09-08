# Enrichment Pipeline Setup

The current iMac operating guide lives in:

- `docs/IMAC_PIPELINE_RUNBOOK.md`

This file remains as a short pointer because older notes and commands reference
`scripts/enrichment/SETUP.md`.

Active workers are in `packages/food-runtime` of the separate
[pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
Use that repository's production entrypoint and private workspace. Do not start
workers, a coordinator, or a publication job from this website checkout.

The former coordinator, its keepalive, and the manual classifier batch launcher
are retired; the external runtime's individually supervised jobs replace them.
Remaining files here are application-owned schemas/policy and historical manual
tools being retired. Archived code is not a supported execution path.
