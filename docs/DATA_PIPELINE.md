# Product data flow

APizzaMichigan and TacoBoutMichigan publish reviewed place data from canonical
PostgreSQL tables to narrowly exposed Supabase tables and views. This repository
owns the product schema, editorial policy, human decisions, and guarded
publication interface.

Reusable acquisition and processing infrastructure is moving to the separate
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

## Legacy application pipeline

Until cutover, the app repository contains the legacy implementations for:

- OpenStreetMap and other source acquisition;
- local SQLite job queues and worker heartbeats;
- website, menu, and classifier enrichment;
- source-review reports and decision workflows;
- guarded local-to-Supabase publication.

These entrypoints remain temporary authorities. New reusable behavior belongs
in the external pipeline repository; do not build a second app-local framework.

The compatibility work also closes known cross-entity leaks in that temporary
path: new queue schemas use entity-scoped identity, workers can claim one
entity, reviewed-new processing resolves the exact canonical table and forwards
the entity through scrape, QA, readiness, RPC, and guarded publication gates,
and Taco payload fields match the Taco RPC rather than inheriting Pizza-only
fields. An existing legacy SQLite queue is deliberately left unchanged for
rolling-code compatibility; moving it to entity-scoped uniqueness requires an
offline, backed-up migration after every old worker is stopped. These fixes
make migration safer; they do not move execution out of this repository.

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

The external repository contains general contracts and executors plus a
read-only APizza FSQ shadow path. It cannot download a real FSQ release or write
canonical, review, or public product data. APizza/Taco production remains on
the legacy application path until source-by-source parity and rollback gates
are complete.

This repository now exposes the application side of the boundary: inert,
entity-specific target inventories and a read-only, entity/lane-specific status
contract. Pizza legacy status is the only registered lane and remains its safe
default. Every Taco lane is unregistered, and Taco status defaults to disabled
pending an entity-safe collector and a live host inventory. Both external
shadow lanes and both external apply lanes are explicitly unregistered;
environment selection alone cannot make a status snapshot authoritative. No
external apply profile is activated. This boundary release also rejects any
attempt to register Taco legacy through configuration alone.

## Local verification

These commands are read-only unless a separately documented command includes
an explicit apply flag:

```sh
npm run verify:release
npm run test:ops
node scripts/ops/source-pipeline-readiness-report.mjs
node scripts/ops/supabase-sync-readiness-report.mjs --entity pizza --batch 25 --sample 3
node scripts/ops/supabase-sync-readiness-report.mjs --entity taco --batch 25 --sample 3
```

Real hostnames, filesystem paths, schedules, installed service definitions, logs,
credentials, and runtime snapshots must live outside the public repository.
The existing host-specific runbooks and launchd templates are retained only
until they can be reconciled with a live inventory and copied to private host
storage; they block the repository visibility change in the meantime.
