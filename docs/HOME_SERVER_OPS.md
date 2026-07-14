# Home Server Ops

APizzaMichigan home-server operations now use direct Tailscale SSH to the
Michigan iMac.

## Access

From the MacBook:

```bash
ssh example-host
```

Project root on the iMac:

```bash
/srv/apizzamichigan
```

## Standard Status

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/home-status-report.mjs'
```

Use `classifier-health-report.mjs` for the normal "is the launchd classifier
healthy and advancing?" check. Use `home-status-report.mjs` when you need the
broader queue/Postgres/Ollama/process details.

## Standard Cleanup

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
```

Apply only after reviewing the dry-run:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

## Pre-Sync QA

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classification-qa-report.mjs --hours 24 --limit 500 --sample 25'
```

Do not run Supabase write syncs until the QA report has been reviewed.

## Service Control

The first production service is the launchd-managed classifier:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh example-host 'tail -100 /tmp/apizzamichigan/classifier.log'
ssh example-host 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

See `docs/IMAC_PIPELINE_RUNBOOK.md` for install/start commands.

## Safety Rules

- Keep Supabase sync manual-only until explicitly approved.
- Do not run scraper, OSM extraction, menu parse, or QA as services in this phase.
- Before starting classifier service, confirm queue `processing=0`.
- Do not commit runtime DBs, logs, token caches, `.env*`, or progress artifacts.
