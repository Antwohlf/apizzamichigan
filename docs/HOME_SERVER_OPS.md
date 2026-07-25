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

If `node` is unavailable in a non-interactive SSH command, wrap the command in
the iMac login shell:

```bash
ssh example-host 'zsh -lc "cd /srv/apizzamichigan && node scripts/ops/home-status-report.mjs"'
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
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --batch 100 --sample 10'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --batch 50 --sample 20'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --checkpoint scripts/.supabase-sync-checkpoint.json --batch 50 --sample 20'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-status-report.mjs --hours 6 --batch 50'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --hours 6 --batch 50'
```

The recurring production sync is launchd-managed and runs the same guarded
path through `scripts/ops/auto-guarded-supabase-sync.mjs`:

```bash
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.supabase-sync"'
ssh example-host 'tail -100 /tmp/apizzamichigan/supabase-sync.log'
```

The wrapper also writes the latest scheduler outcome to the ignored local file
`scripts/.supabase-sync-status.json`. The status report includes this as the
`last scheduled run` field, so operators can distinguish a successful run from
a deliberate skip (for example, the bulk RPC is unavailable) without parsing
the full log:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-status-report.mjs --hours 6 --batch 50'
ssh example-host 'cd /srv/apizzamichigan && node -e "console.log(require(\"fs\").readFileSync(\"scripts/.supabase-sync-status.json\", \"utf8\"))"'
```

It applies at most one 100-row ordinary batch every 30 minutes and exits without
writing if health, QA, readiness, or dry-run gates fail. Broad reviewed-new
reconciliation is maintenance-only; enable it explicitly with
`APIZZA_SYNC_RUN_RECONCILIATION=true` when needed.

## Service Control

The first production service is the launchd-managed classifier:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh example-host 'tail -100 /tmp/apizzamichigan/classifier.log'
ssh example-host 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

See `docs/IMAC_PIPELINE_RUNBOOK.md` for install/start commands.

## Legacy OpenClaw Cron Jobs

OpenClaw may remain active for unrelated local-agent work, but APizzaMichigan
should not be driven by OpenClaw cron jobs. The old APizza watchdog/coordinator
cron jobs must stay disabled:

```bash
ssh example-host '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron list'
```

Retired APizza cron IDs:

- `092dc3b7-20ad-42a4-9dff-d5c417f4b90e`
- `c92e0d70-6159-402b-8980-72784da8e936`

If either is enabled:

```bash
ssh example-host '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable 092dc3b7-20ad-42a4-9dff-d5c417f4b90e'
ssh example-host '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable c92e0d70-6159-402b-8980-72784da8e936'
```

## Safety Rules

- Keep Supabase sync manual-only until explicitly approved.
- Do not run scraper, OSM extraction, menu parse, or QA as services in this phase.
- Before starting classifier service, confirm queue `processing=0`.
- Do not commit runtime DBs, logs, token caches, `.env*`, or progress artifacts.
