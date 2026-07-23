# Enrichment Pipeline Safeguards

The APizzaMichigan iMac pipeline is moving to a production-safe model:
Tailscale SSH for operator access, launchd for service supervision, and guarded
Supabase writes.

## Current Safety Rules

- Supabase sync runs through `com.apizzamichigan.supabase-sync` and must keep
  using the guarded runner.
- The classifier runs through `com.apizzamichigan.classifier`.
- Scraper, OSM extraction, menu parse, and QA are not daemonized in this phase.
- OpenClaw cron jobs must not run APizza watchdog, keepalive, or coordinator processes.
- Before starting services, queue `processing` must be `0`.
- Stale worker registry rows are cleaned with `scripts/ops/stale-worker-cleanup.mjs`; jobs are not mutated by that cleanup.

## Observability

Read-only system report:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/home-status-report.mjs'
```

Classifier service logs:

```bash
ssh example-host 'tail -100 /tmp/apizzamichigan/classifier.log'
```

Launchd service state:

```bash
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
```

## Recovery

Stop classifier service:

```bash
ssh example-host 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

If a foreground/bounded classifier run is interrupted, the classifier should
requeue the in-flight job and leave queue `processing=0`.

If a stale worker row remains without a processing job:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

If a stale processing job exists, inspect it first. Do not recover or fail jobs
blindly.

## Local Recovery Backups

The iMac has a bounded local backup job for the two stateful components that
cannot be reconstructed quickly: local Postgres and the SQLite enrichment
queue. It writes a timestamped directory under `backups/` with a custom
`pg_dump`, a consistent SQLite snapshot, and `manifest.json` checksums. The
scheduled launchd template retains seven runs and does not contact Supabase.

Read-only preview:

```bash
node scripts/ops/create-local-backup.mjs --dry-run
```

Manual run:

```bash
node scripts/ops/create-local-backup.mjs --retention 7
```

Backups are machine-local and ignored by git. Copy completed run directories
to separate storage if they are intended to protect against machine loss.
Restore Postgres into a new database first with `pg_restore`; restoring over
the live database is destructive and requires explicit approval. Restore the
queue only with all workers stopped, and handle its `-wal` and `-shm` files as
one SQLite state set.

## Sync Guardrail

The recurring sync service must use the guarded wrapper:

```bash
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.supabase-sync"'
ssh example-host 'tail -100 /tmp/apizzamichigan/supabase-sync.log'
```

The direct sync engine should still be dry-run first when invoked manually:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
```

For a reviewed set of specific canonical rows, prefer exact-ID guarded sync:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --ids 123,456'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --ids 123,456'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --ids 123,456 --apply'
```

For reviewed-new canonical rows that do not exist in Supabase yet, the guarded
runner requires exact IDs plus an explicit reviewed-new insert flag:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --ids 123,456 --insert-missing-reviewed-new'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --ids 123,456 --insert-missing-reviewed-new --apply'
```

That path still syncs only `pizza_places`. Missing rows are inserted only when
local `place_sources` proves `match_method='reviewed_new_import'`.

Do not use broad changed-since windows for one-off reviewed source promotion
batches when exact IDs are available.

The source policy is documented in `docs/DATA_SOURCES.md`. Google Maps is an
outbound navigation destination, not an ingestion source.

Lifecycle sync is disabled by default because its public-schema migration is
additive. Apply `scripts/enrichment/supabase-production-migration.sql`, then
set `ENABLE_LIFECYCLE_SYNC=1` only after the readiness report confirms the
remote columns exist. Keep that flag unset until then.

## Archived Safeguards

Older OpenClaw/Discord watchdog notes are preserved in git history and related
archive docs. They are not the current production operating model.
