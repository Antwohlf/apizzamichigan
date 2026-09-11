# Website and pipeline separation

Verified on September 9, 2026.

The website and pipeline are separately deployed projects. This repository owns
the public maps, editorial interface, product schemas, and publication contracts.
The public [pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline)
owns scheduled acquisition, matching, review ingestion, enrichment, publication,
and backups. The website server does not launch pipeline processes.

## What is running

- Pizza and Taco use separate product configurations and source checkpoints.
- Source acquisition, matching, and review ingestion run as registered stages
  in the shared trusted-host executor. Publication and shared workers also use
  that executor; their existing database/review safeguards remain in place.
- The shared queue distinguishes jobs by product as well as source identifier.
  Its offline migration preserved existing jobs and retry history.
- Both products completed bounded source runs and guarded publication after the
  stage-executor rollout. No new canonical places were created by those tests.
- The obsolete website worker schedules and duplicate worker/publisher
  implementations have been removed. Historical manual utilities are not the
  production execution path.

The trusted-host executor runs approved adapter code with host permissions. It
is not a sandbox. The separate artifact-preview executor remains read-only;
its inactive apply declarations must not be mistaken for production authority.

## Work deliberately kept separate

- Taco-specific Overture support is deferred; the Pizza-only adapter is disabled
  for Taco.
- BuiltHere's host-only work is preserved. BuiltHere has not been cut over.
- This application repository and the generalized pipeline repository are public.
  The owner accepted residual GitHub-retained historical exposure; see
  [publication status](PUBLIC_RELEASE.md). BuiltHere's visibility is separate.
- Production jobs use task-specific, non-administrator database accounts with
  password authentication. Publication credentials live outside the shared
  worker environment; private host recovery material is not part of either repo.
  This is credential separation, not a sandbox between processes on the same host.

The administrator publication display reads an explicit external status root.
Without that configuration it reports unavailable external status; it does not
infer that publication is disabled or that no updates are waiting.

## App-side boundary update — September 11, 2026

The administrator server no longer imports legacy script helpers, probes source
credentials/setup files, reads raw OSM inputs, or reads a shared CSV queue.
Editorial policy is app-owned under `server/product/`. Optional historical
review summaries use the bounded, entity-specific external report adapter;
current review work remains in the canonical database. This code change does
not configure an operator's private report mount or change production workers.
Vercel deploys the frontend; a separately running administrator API must use the
updated code to receive these backend changes. Unconfigured historical reports
remain unavailable without blocking canonical review decisions.
