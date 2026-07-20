# Supabase Public Migration Runbook

This is a one-time additive change for the public pizza and taco tables. It
does not alter or delete records.

## Apply

1. Open the project's Supabase SQL Editor.
2. Paste and run `scripts/enrichment/supabase-production-migration.sql`.
3. Confirm the script finishes without errors.

The two component files remain checked in for reference, but the combined
file is the canonical operator entry point.

The lifecycle migration adds explicit historical/replacement fields. The
search migration enables `pg_trgm` and adds idempotent indexes for the fields
already searched by the public sites. It is safe to run either migration again.

## Verify Before Enabling Sync

On the iMac, run the read-only check:

```bash
cd /Users/ant/clawd/projects/apizzamichigan
/usr/local/bin/node scripts/ops/supabase-sync-readiness-report.mjs --batch 20 --sample 3
```

The expected lifecycle section is:

```text
- enabled: no
- remote schema: ready
```

Only after `remote schema: ready` is confirmed, add
`ENABLE_LIFECYCLE_SYNC=1` to the environment used by
`com.apizzamichigan.supabase-sync`, reload that launchd job, and rerun the
same readiness report. The lifecycle section should then show
`enabled: yes` with no remote-schema error.

## Post-check

Run the consolidated read-only audit:

```bash
/usr/local/bin/node scripts/ops/project-readiness-report.mjs --json
```

The `Public schema and search performance` gate should no longer list the two
SQL files as remaining actions. Do not run a broad write sync as part of this
migration; the recurring guarded sync will pick up eligible lifecycle fields
after the readiness gate passes.

## Rollback

Do not drop the new columns or indexes as part of routine operations. If the
post-check fails, leave lifecycle sync disabled and report the exact SQL error
before making another schema change.
