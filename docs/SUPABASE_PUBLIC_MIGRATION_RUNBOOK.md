# Supabase Public Migration Runbook

This is a one-time additive change for the public pizza and taco tables. It
does not alter or delete records.

This repository owns the SQL contracts, not the scheduled publisher. Runtime
configuration, activation, and rollback belong to the
[external food runtime](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline/tree/main/packages/food-runtime).
Do not install or reload a publisher from this checkout.

## Apply

1. Open the project's Supabase SQL Editor.
2. Paste and run `scripts/enrichment/supabase-production-migration.sql`.
3. Confirm the script finishes without errors.

This first migration contains only the lifecycle columns and guarded bulk
sync function. It deliberately does not build search indexes, so the critical
publication path can be enabled without combining it with a large disk-I/O
operation on the Nano instance.

The two component files remain checked in for reference, but the combined
file is the canonical operator entry point.

The lifecycle migration adds explicit historical/replacement fields. The
separate search migration enables `pg_trgm` and adds idempotent indexes for the
fields already searched by the public sites. It is safe to run either
migration again.
The migration also installs the guarded `apply_pizza_places_sync_batch(jsonb)`
RPC. It performs approved updates in one database transaction and is callable
only by the Supabase service role. Non-null `style`, `price`, `price_range`,
and `style_confidence` values come from the local canonical `pizza_places` row
and may correct stale legacy values in the public mirror. Null local values do
not clear public values.

If the lifecycle columns are already present but the readiness report says the
RPC is missing, run the smaller repair file instead:

```text
scripts/enrichment/supabase-bulk-sync-rpc-migration.sql
```

That repair file only creates or replaces the guarded RPC. It does not alter
columns, create indexes, or write any place rows.

## Verify Before Enabling Sync

First run the SQL Editor verification file:

```text
scripts/enrichment/verify-supabase-bulk-sync-rpc.sql
```

It should return one function row with `security_definer = true`,
`service_role_can_execute = true`, both public-role execute values false, both
lifecycle columns, and a zero-row probe of `{"updated_count": 0}`. This probe
does not modify any place rows.

From a privately configured application checkout, run the read-only check. Set `APP_ROOT`
to that checkout without committing its value:

```bash
cd "$APP_ROOT"
ENABLE_LIFECYCLE_SYNC=1 node scripts/ops/supabase-sync-readiness-report.mjs --batch 20 --sample 3
```

The explicit environment prefix matters: an interactive shell might not inherit
the value used by a scheduled publisher. The command is read-only; it only
makes the check evaluate the same lifecycle contract as the publisher.

The expected lifecycle section is:

```text
- enabled: yes
- remote schema: ready
```

If the remote schema is ready, follow the external runtime's deployment
instructions to configure its publisher. This checkout does not contain that
service template. Require `enabled: yes` with no remote-schema error before
enabling lifecycle publication.

## Optional Search Index Step

After the core migration and publication readiness check pass, apply
`scripts/enrichment/supabase-search-index-migration.sql` separately. Run it
during a period when a brief increase in disk activity is acceptable, and
verify the Supabase database observability page afterward. Search remains
functional without these indexes; the indexes improve substring-search
latency as the tables grow.

## Post-check

Run the consolidated read-only audit:

```bash
node scripts/ops/project-readiness-report.mjs --json
```

The `Public schema and search performance` gate should no longer list the two
SQL files as remaining actions. Do not run a broad write sync as part of this
migration; the recurring guarded sync will pick up eligible lifecycle fields
after the readiness gate passes.

## Enable the low-I/O path

After the SQL migration succeeds, run the status report before changing the
service:

```bash
node scripts/ops/supabase-sync-status-report.mjs --json
```

The report must show `bulkRpc.state: "not_configured"` or `"ready"` with
`bulkRpc.available: true`. If it shows `migration_missing`, do not enable the
flag; the production migration has not reached Supabase yet. If it shows
`not_configured`, configure bulk publication through the external runtime's
approved deployment workflow. Rerun the report and require
`bulkRpc.state: "ready"`. Do not substitute an app-local write command for a
missing publisher configuration.

## Public-client grants

The separate `supabase/migrations/20260910165538_harden_public_client_grants.sql`
migration hardens the existing public-client permissions. It is not a complete
database bootstrap. Preserve the required review-photo schema and existing
editorial/publication contracts when provisioning another installation.
See [PUBLIC_RELEASE.md](PUBLIC_RELEASE.md) for the read-only public-client
verification command and its limits.

## Rollback

Do not drop the new columns or indexes as part of routine operations. If the
post-check fails, leave lifecycle sync disabled and report the exact SQL error
before making another schema change.
