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
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/home-status-report.mjs'
```

## Standard Cleanup

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
```

Apply only after reviewing the dry-run:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

## Service Control

The first production service is the launchd-managed classifier:

```bash
ssh apizza-imac 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh apizza-imac 'tail -100 /tmp/apizzamichigan/classifier.log'
ssh apizza-imac 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

See `docs/IMAC_PIPELINE_RUNBOOK.md` for install/start commands.

## Safety Rules

- Keep Supabase sync manual-only until explicitly approved.
- Do not run scraper, OSM extraction, menu parse, or QA as services in this phase.
- Before starting classifier service, confirm queue `processing=0`.
- Do not commit runtime DBs, logs, token caches, `.env*`, or progress artifacts.
