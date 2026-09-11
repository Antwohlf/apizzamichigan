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
- Operator command handoffs explicitly targeting the private external workspace.
- Inert target inventories under `contracts/pipeline-targets/`.

The admin server reads publication status without launching pipeline workers
or publication commands. Manual tools, source-review helpers, and shared policy
code remain under `scripts/`; they are not production scheduler owners.
Release checks validate app contracts, not current host health.

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
