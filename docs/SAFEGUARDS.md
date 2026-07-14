# Enrichment Pipeline Safeguards

The APizzaMichigan iMac pipeline is moving to a production-safe model:
Tailscale SSH for operator access, launchd for service supervision, and manual
approval for Supabase writes.

## Current Safety Rules

- Supabase sync is manual-only until classification quality is reviewed.
- The first launchd service runs classifier only.
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

## Sync Guardrail

Dry-run only unless explicitly approved:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
```

Write sync must be a separate, explicit operation after reviewing sample local
rows and protected-field behavior.

## Archived Safeguards

Older OpenClaw/Discord watchdog notes are preserved in git history and related
archive docs. They are not the current production operating model.
