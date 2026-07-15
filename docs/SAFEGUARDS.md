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
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/home-status-report.mjs'
```

Classifier service logs:

```bash
ssh apizza-imac 'tail -100 /tmp/apizzamichigan/classifier.log'
```

Launchd service state:

```bash
ssh apizza-imac 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
```

## Recovery

Stop classifier service:

```bash
ssh apizza-imac 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

If a foreground/bounded classifier run is interrupted, the classifier should
requeue the in-flight job and leave queue `processing=0`.

If a stale worker row remains without a processing job:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

If a stale processing job exists, inspect it first. Do not recover or fail jobs
blindly.

## Sync Guardrail

The recurring sync service must use the guarded wrapper:

```bash
ssh apizza-imac 'launchctl print "gui/$(id -u)/com.apizzamichigan.supabase-sync"'
ssh apizza-imac 'tail -100 /tmp/apizzamichigan/supabase-sync.log'
```

The direct sync engine should still be dry-run first when invoked manually:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
```

The source policy is documented in `docs/DATA_SOURCES.md`. Google Maps is an
outbound navigation destination, not an ingestion source.

## Archived Safeguards

Older OpenClaw/Discord watchdog notes are preserved in git history and related
archive docs. They are not the current production operating model.
