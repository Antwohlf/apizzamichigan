# Product data flow

APizzaMichigan and TacoBoutMichigan publish reviewed place data from canonical
PostgreSQL tables to narrowly exposed Supabase tables and views. This repository
owns the product schema, editorial policy, human decisions, and guarded
publication interface.

Scheduled acquisition and processing infrastructure now lives in the separate
[Map Data Aggregation and Enhancement Pipeline](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
See [PIPELINE_BOUNDARY.md](PIPELINE_BOUNDARY.md) for the exact ownership and
cutover rules.

## Desired flow

```text
source adapters
  -> source/profile normalization
  -> canonical matching
  -> durable review evidence
  -> human or policy decision
  -> proposed canonical patch
  -> app-owned guarded writer
  -> canonical Postgres
  -> app-owned guarded publisher
  -> public Supabase projection
  -> website
```

Outside sources provide evidence and proposals. They do not directly rewrite
personal ratings, notes, photos, visits, identity, or lifecycle history.

## Product-owned contracts

- `config/entity-profiles.json` maps APizza and Taco to their canonical tables,
  taxonomy, and source-policy configuration.
- `config/pipeline-boundary.json` is the fail-closed registry for external write
  enablement and for entity/lane-specific status selection.
- `config/canonical-contract.json` defines the existing application field and
  publication boundary. It will be split into versioned input/output contracts
  as each external-pipeline slice is introduced.
- `contracts/pipeline-targets/*.json` are separate Pizza and Taco inventories of
  the current legacy mirror capability. They are not executable external-write
  authorization: external apply, effects, and operations are all disabled.
- `contracts/pipeline-status.v1.schema.json` defines the bounded,
  operations-display-only snapshot accepted by the administrator interface.
- `scripts/lib/supabase-sync-profiles.mjs` maps product entities to guarded
  publication RPCs.
- SQL under `scripts/enrichment/` owns the canonical/public schema and RPC
  definitions.
- `place_sources` and `source_review_queue` are protected operational/review
  state; they are not public sync targets.

The checked-in code supports both Pizza and Taco publication profiles. That
capability is not proof that either corresponding scheduled service is loaded
on a host. Deployment state must come from a redacted live inventory, never
from repository documentation.

## Extracted compatibility runtime

The scheduled compatibility implementation now runs from
`packages/food-runtime` in the external pipeline repository. It contains the
existing implementations for:

- OpenStreetMap and other source acquisition;
- local SQLite job queues and worker heartbeats;
- website, menu, and classifier enrichment;
- source-review reports and decision workflows;
- guarded local-to-Supabase publication.

These entrypoints remain temporary compatibility authorities while individual
stages are replaced by reusable adapters. New reusable behavior belongs in the
external pipeline repository; do not build a second app-local framework.

The admin server now reads external publication-status files without executing
pipeline scripts. Its operator commands explicitly target the external private
workspace. Historical manual tools and shared product-policy helpers remain
under `scripts/` during cleanup; they are not the scheduled production owner.

The compatibility work also closes known cross-entity leaks in that temporary
path: new queue schemas use entity-scoped identity, workers can claim one
entity, reviewed-new processing resolves the exact canonical table and forwards
the entity through scrape, QA, readiness, RPC, and guarded publication gates,
and Taco payload fields match the Taco RPC rather than inheriting Pizza-only
fields. The production SQLite queue has completed the offline, backed-up
entity-identity migration after all workers were stopped and drained. Existing
jobs and retry history were preserved. Other installations with the old global
identity must use the external runtime's explicit offline migration; ordinary
worker startup does not rewrite an existing queue.

## Safety rules

1. Discovery and enrichment are not publication authority.
2. Real source data must have approved terms, field, retention, privacy, and
   redistribution policy before processing.
3. APizza, Taco, and BuildHere.city use distinct profile policies and state
   namespaces, even when an adapter is shared.
4. Apply mode requires a versioned app-owned target contract and an exact
   profile/target binding.
5. Stop the legacy owner and capture all planner, acquisition, delivery, queue,
   and referenced-artifact state before enabling a replacement writer.
6. Publication moves last and retains health, QA, readiness, dry-run,
   protected-field, and post-verification gates.

## Current extraction status

The external repository contains shared contracts and executors plus the
trusted-host Pizza/Taco production runtime and a distinct BuiltHere runtime.
Food acquisition and publication use narrow credentials for app-owned contracts.
The older artifact-based FSQ shadow and its apply lane remain a separate,
restricted path. Do not generalize that lane's restrictions to all deployed
adapters, or assume the runtime migration rewrote every legacy stage.

This repository now exposes the application side of the boundary: inert,
entity-specific target inventories and a read-only, entity/lane-specific status
contract. Pizza legacy status is the only registered lane and remains its safe
default. Every Taco lane is unregistered, and Taco status defaults to disabled
pending an entity-safe collector for that older contract. This does not disable
Taco's scheduled runtime or its separate food-runtime publication status. Both external
shadow lanes and both external apply lanes are explicitly unregistered;
environment selection alone cannot make a status snapshot authoritative. No
external apply profile is activated. This boundary release also rejects any
attempt to register Taco legacy through configuration alone.

## Local verification

Application contract and compatibility checks remain available here:

```sh
npm run verify:release
npm run test:ops
npm run verify:pipeline-boundary
```

Production runtime planning and verification belong to
`docs/FOOD_PRODUCTION_RUNTIME.md` in the external pipeline repository. Do not
start scheduled jobs from this application checkout.

Real hostnames, filesystem paths, schedules, installed service definitions, logs,
credentials, and runtime snapshots must live outside the public repository.
The old host-specific runbooks were preserved privately and replaced with
handoff documentation. The sole retained health template uses placeholders and
must be configured privately. Other release gates, including state, record
licensing, and Git history, remain in [PUBLIC_RELEASE.md](PUBLIC_RELEASE.md).
