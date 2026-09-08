# Application and pipeline boundary

## Current state

This repository owns the APizzaMichigan and TacoBoutMichigan web application,
their canonical data model, the human review experience, and the guarded public
publication contract. Residual compatibility scripts remain here only where
the application server, administrator UI, or release verification still uses
them.

Reusable execution infrastructure is developed in the public
[Map Data Aggregation and Enhancement Pipeline](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
That repository provides shared contracts, orchestration primitives, state and
artifact stores, adapters, and a read-only APizza FSQ shadow. Its
`packages/food-runtime` compatibility package is also the launch owner for the
scheduled Pizza/Taco acquisition, enrichment, and guarded-publication jobs. The
compatibility package preserves the established app-owned database contracts;
it is distinct from granting the generalized executor authority to write this
application's canonical or public data.

The repositories now have separate codebases. This application also owns two
distinct, versioned target inventories and a bounded status-snapshot contract.
The administrator interface reads only a selected Pizza or Taco status lane
through that contract; a status document is display-only and cannot authorize
or start pipeline work.

Production scheduling has moved out of the application checkout to the
external repository's extracted compatibility runtime. The retained app-local
copies are not production entrypoints. The generalized pipeline still has no
write authority, and neither app-owned target inventory represents an
executable external-write grant. Runtime-host evidence and service definitions
remain private operational records rather than claims inferred from either
repository.

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
- deployment-independent validation and dry-run/shadow execution;
- the extracted `packages/food-runtime` compatibility launcher and runtime
  implementations used by the current scheduled Pizza/Taco jobs.

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
host-selected root. Pizza defaults to its registered legacy lane. Every Taco
lane is unregistered because no entity-safe Taco status collector or external
runtime has been verified. Taco therefore defaults to disabled. This boundary
release code-binds legacy registration to the Pizza/APizza identity, so a Taco
configuration edit cannot activate the unsafe legacy collector. Every external
shadow and apply lane is also explicitly unregistered and cannot be selected,
even through an environment override. Registering one will require a future
contract change that verifies exact profile, catalog, host-policy, deployment, and target bindings rather
than accepting syntactically valid digests. Selecting or displaying an
apply-lane document cannot enable writes. The administrator endpoint requires
a valid, server-expiring session, rejects unknown identities and schema fields,
and does not require a database service credential merely to read the local
snapshot.

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

The compatibility-runtime relocation does not waive this invariant. Until an
individual source or effect is replaced by a generalized adapter, its extracted
compatibility implementation remains authoritative. OSM moves after the
simpler source adapters because it feeds shared queues and has the widest
identity surface.

## What is separated now

- Repository ownership and reusable scaffolding.
- Scheduled compatibility-runtime launch ownership; production jobs no longer
  launch from the application checkout.
- App-owned Pizza and Taco target identities and field inventories.
- Entity- and lane-isolated observational status files and admin presentation.
- Explicit fail-closed registration state for every status lane; only the
  Pizza legacy status collector is registered today.
- Entity-scoped queue claims, reviewed-new table selection, and guarded
  publication argument routing. Fresh queues use Pizza/Taco-scoped uniqueness;
  an existing legacy queue is intentionally not rewritten during ordinary
  startup.

## What remains coupled

- The administrator server still exposes an app-local FSQ adapter command and
  executes the app-local Supabase readiness report. The administrator UI also
  renders local legacy enrichment and publication commands. Those call sites
  must be replaced by a versioned command/status boundary before their
  compatibility files can be removed.
- App release verifiers still inspect copied runtime implementations, launchd
  templates, and shared policy helpers. Moving those assertions to a
  cross-repository contract is a separate cleanup slice.
- The Pizza `legacy` status lane remains registered to the app producer
  identity. Runtime launch relocation does not silently re-register that lane;
  the admin status view must stay fail-closed until a separately verified
  producer-contract change is made.
- The extracted runtime still uses the legacy SQLite/PostgreSQL state formats,
  source-review tables, and guarded publisher. Moving launch ownership is not
  the same as adopting the generalized artifact/state executor.
- The existing iMac queue still needs a stop-the-world, backed-up schema
  migration after all old workers are unloaded. Until then its legacy uniqueness
  rule cannot store the same source identity for both products.
- Publication still uses the extracted compatibility publisher and its legacy
  credential boundary; no generalized external writer role is provisioned or
  enabled.
- Live service and post-cutover evidence must be maintained and verified in the
  private host record.
- The external profiles remain non-deployable until their exact profile,
  catalog, host-policy, and target digests are bound in a deployment manifest.
