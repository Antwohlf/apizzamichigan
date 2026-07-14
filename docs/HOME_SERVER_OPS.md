# Home Server Ops

APizzaMichigan home-server operations now use direct Tailscale SSH to the
Michigan iMac.

## Access

From the MacBook:

```bash
ssh apizza-imac
```

Project root on the iMac:

```bash
/Users/ant/clawd/projects/apizzamichigan
```

## Standard Status

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/home-status-report.mjs'
```

Use `classifier-health-report.mjs` for the normal "is the launchd classifier
healthy and advancing?" check. Use `home-status-report.mjs` when you need the
broader queue/Postgres/Ollama/process details.

## Standard Cleanup

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
```

Apply only after reviewing the dry-run:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

## Pre-Sync QA

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/classification-qa-report.mjs --hours 24 --limit 500 --sample 25'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --batch 100 --sample 10'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --batch 50 --sample 20'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --checkpoint scripts/.supabase-sync-checkpoint.json --batch 50 --sample 20'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-status-report.mjs --hours 6 --batch 50'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --hours 6 --batch 50'
```

Do not run Supabase write syncs until the QA report has been reviewed.

## Service Control

The first production service is the launchd-managed classifier:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh apizza-imac 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh apizza-imac 'tail -100 /tmp/apizzamichigan/classifier.log'
ssh apizza-imac 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

See `docs/IMAC_PIPELINE_RUNBOOK.md` for install/start commands.

## Legacy OpenClaw Cron Jobs

OpenClaw may remain active for unrelated local-agent work, but APizzaMichigan
should not be driven by OpenClaw cron jobs. The old APizza watchdog/coordinator
cron jobs must stay disabled:

```bash
ssh apizza-imac '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron list'
```

Retired APizza cron IDs:

- `092dc3b7-20ad-42a4-9dff-d5c417f4b90e`
- `c92e0d70-6159-402b-8980-72784da8e936`

If either is enabled:

```bash
ssh apizza-imac '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable 092dc3b7-20ad-42a4-9dff-d5c417f4b90e'
ssh apizza-imac '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable c92e0d70-6159-402b-8980-72784da8e936'
```

## Safety Rules

- Keep Supabase sync manual-only until explicitly approved.
- Do not run scraper, OSM extraction, menu parse, or QA as services in this phase.
- Before starting classifier service, confirm queue `processing=0`.
- Do not commit runtime DBs, logs, token caches, `.env*`, or progress artifacts.
