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

The repositories now have separate codebases, but the intended runtime boundary
is only declared and partially implemented. The application server still reads
legacy pipeline configuration and artifacts directly. App-owned target/status
contracts and the compatibility presenter are the next implementation slice.

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
