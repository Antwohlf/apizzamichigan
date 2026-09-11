# Application and pipeline boundary

## Current ownership

This repository owns the Pizza/Taco websites, admin application, canonical
schemas, editorial policy, public read interfaces, and guarded publication
contracts. The [external pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline)
owns acquisition, enrichment, scheduling, queues, checkpoints, receipts, and
compute admission. Pizza, Taco, and BuiltHere use distinct profiles and state;
BuiltHere's application owns its own database contracts.

Pizza/Taco production jobs launch from external `packages/food-runtime`, not
this checkout. Their offline queue identity migration completed with jobs and
retry history preserved. State and credentials remain in a private workspace.
The websites deploy independently of those jobs.

The extracted food runtime retains established SQLite/PostgreSQL formats and
guarded publication behavior. Separation of scheduled runtime ownership does
not mean every legacy algorithm has been rewritten.

## Integration surfaces

- App-owned schemas, public views, protected-field policy, and publication RPCs.
- External publication snapshots read through
  `shared/food-runtime-publication-status.cjs` and `FOOD_PIPELINE_STATUS_ROOT`.
- External review-report summaries adapted through
  `contracts/food-review-artifacts.v1.json` and `FOOD_PIPELINE_REPORT_ROOT`.
- Operator command handoffs explicitly targeting the private external workspace.
- Inert target inventories under `contracts/pipeline-targets/`.

The admin server reads publication status without launching pipeline workers
or publication commands. It imports no pipeline runtime or `scripts/` modules.
App-owned editorial lifecycle and identity rules live in `server/product/`;
manual review tools depend on them. Source setup and credential checks are
performed in the external pipeline, not inferred from the website environment.
Release checks validate app contracts, not current host health.

## Optional external report input

Set `FOOD_PIPELINE_REPORT_ROOT` privately to the external runtime workspace's
`reports` directory, or a separately mounted copy of that directory. It must be
an absolute, non-symlink path outside the website checkout. The app reads only
`source-review/*-review.json` through the v1 adapter; no external code is loaded.
The existing food runtime already writes this format, so no worker deployment
or new producer is required. The contract version describes the adapter; it
does not pretend older reports carried a version marker.

Reports must name the exact Pizza/Taco entity, a known source, an ISO timestamp,
and the five declared counts. The adapter limits file sizes and count, rejects
symlinks and malformed input, and returns only summary fields. Old reports are
labelled historical. Totals describe past artifacts, not current pending work.
The canonical review database remains authoritative for the worklist and human
decisions. Missing configuration or rejected input is reported as unavailable;
it is not zero backlog or a stopped pipeline.

The old app-local report-directory/CSV settings and FSQ setup probes are no
longer consumed by the admin server. Neither raw OSM input arrays nor partial
tile manifests are an app interface. Stale evidence alone cannot establish a
closure or absence from a later source run; the admin view reports that
observation as unavailable rather than inferring a negative result.

## Distinct status and authorization contracts

External food-runtime publication status supports both products. Separately,
the older `config/pipeline-boundary.json` registry registers only the Pizza
legacy collector. Taco's older lane remains disabled because that collector
is not entity-safe. **This does not disable Taco's production pipeline.**

The older external shadow/apply lanes and target inventories remain inert, with
empty effect and operation allowlists. Displaying a snapshot cannot grant write
authority. Environment overrides cannot register a producer or activate a lane.
Future activation requires verified profile, catalog, host-policy, deployment,
and target bindings plus app-owned write contracts.

The trusted-host food runtime has separately provisioned narrow credentials
for existing app-owned contracts. An inert artifact lane does not mean no
external production publisher exists; the host publisher does not authorize
activation of that lane.

## Future changes and safeguards

The web client and server must not import the runtime. Reusable worker changes
belong externally; product schema and editorial changes belong here. The
external repository still carries a pinned APizza read-view contract and
provisioning template; moving their authoritative home requires coordination.

Before replacing a writer, back up its queues, cursors, checkpoints, and
referenced artifacts; drain the old owner; validate reconciliation; retain
rollback evidence. Never run competing writers for the same scope or rewrite
old queues during ordinary startup.

Live inventories, credentials, installed services, and cutover evidence stay
private. Follow external `docs/FOOD_PRODUCTION_RUNTIME.md` for operations and
[PUBLIC_RELEASE.md](PUBLIC_RELEASE.md) for public repository maintenance.
