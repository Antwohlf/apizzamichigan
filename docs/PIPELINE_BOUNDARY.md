# Application and pipeline boundary

## Current state

This repository owns the APizzaMichigan and TacoBoutMichigan web application,
their canonical data model, the human review experience, and the guarded public
publication contract. It also temporarily contains the legacy production
source scheduler and enrichment workers.

Reusable execution infrastructure is developed in the public
[Map Data Aggregation and Enhancement Pipeline](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
That repository currently provides shared contracts, orchestration primitives,
state and artifact stores, adapters, and a read-only APizza FSQ shadow. It has
no authority to write this application's canonical or public data.

The repositories now have separate codebases. This application also owns two
distinct, versioned target inventories and a bounded status-snapshot contract.
The administrator interface reads only a selected Pizza or Taco status lane
through that contract; a status document is display-only and cannot authorize
or start pipeline work.

The production runtime is not cut over. Legacy source, enrichment, review, and
publication entrypoints still execute from this repository and remain
authoritative for their current scopes. The external pipeline has no write
authority, and neither app-owned target inventory represents an executable
external-write grant.

## Ownership

This application repository owns, or is the intended authoritative home for:

- canonical table schemas, migrations, public views, and guarded write RPCs;
- APizza and Taco taxonomies, field authority, promotion, and editorial policy;
- human review decisions and final publication authority;
- public and administrator interfaces, branding, maps, ratings, notes, and
  photographs;
- versioned input, output, and status contracts exposed to the external
  pipeline. The external repository currently carries the first pinned APizza
  read-view contract and provisioning template until that ownership is moved
  here through a coordinated change.

The pipeline repository owns:

- source transport adapters and reusable acquisition mechanics;
- execution, admission, retry, checkpoint, artifact, and receipt mechanics;
- reusable normalization, matching, review-event, and worker scaffolding;
- profile-isolated runtime identity and resource budgets;
- deployment-independent validation and dry-run/shadow execution.

Product-specific source selection and transformations live in distinct APizza,
Taco, and BuildHere.city profiles. Sharing an adapter never implies sharing a
source policy.

## Integration rules

The web client and application server must not import the pipeline runtime.
As the legacy coupling is removed, cross-repository integration will be limited
to versioned, digest-pinned contracts:

1. Narrow read-only database views used as pipeline inputs.
2. Review/evidence or canonical-write RPCs owned and migrated by this app.
3. Read-only status snapshots consumed by the administrator interface.
4. Immutable run and publication receipts used for reconciliation.

The implemented status boundary uses fixed entity-and-lane paths under a
host-selected root. Pizza defaults to its legacy lane. Taco defaults to
disabled because its live deployment authority has not been reconciled with
the checked-in configuration. Shadow and apply status are separate lanes;
selecting or displaying an apply-lane document cannot enable writes. The
administrator endpoint requires a valid, server-expiring session, rejects
unknown identities and schema fields, and does not require a database service
credential merely to read the local snapshot.

The two target inventories describe the existing legacy Pizza and Taco mirror
capabilities so integration work can be checked against the application-owned
field boundary. They keep external authorization disabled, publish empty effect
and operation allowlists, require different future database principals, and
state that production deployment is unverified. Activating either target needs
a new idempotent entity-scoped RPC, a database writer-generation fence, narrow
grants, a shadow reconciliation, legacy-writer revocation, and restore proof.

Credentials, concrete host paths, installed service definitions, schedules,
and runtime state stay outside both public repositories.

## Cutover invariant

One source and one effect move at a time. The legacy owner is stopped and its
checkpoint is captured before the new owner can apply. A shadow comparison,
complete rollback bundle, restore rehearsal, and observation window are
required. Two writers must never own the same target scope concurrently.

Until a source passes that sequence, the app-local legacy path remains
authoritative. OSM moves after the simpler source adapters because it currently
feeds shared queues and has the widest identity surface.

## What is separated now

- Repository ownership and reusable scaffolding.
- App-owned Pizza and Taco target identities and field inventories.
- Entity- and lane-isolated observational status files and admin presentation.
- Entity-scoped queue claims, reviewed-new table selection, and guarded
  publication argument routing. Fresh queues use Pizza/Taco-scoped uniqueness;
  an existing legacy queue is intentionally not rewritten during ordinary
  startup.

## What remains coupled

- The production schedulers and workers still launch app-local scripts.
- Their checkpoints, SQLite queue, source-review state, and host services have
  not moved to pipeline-owned state stores.
- The existing iMac queue still needs a stop-the-world, backed-up schema
  migration after all old workers are unloaded. Until then its legacy uniqueness
  rule cannot store the same source identity for both products.
- Publication still uses the legacy app publisher and broad legacy credential;
  no narrow external writer role is provisioned or enabled.
- The live iMac service inventory and Taco authority have not been verified.
- The external profiles remain non-deployable until their exact profile,
  catalog, host-policy, and target digests are bound in a deployment manifest.
