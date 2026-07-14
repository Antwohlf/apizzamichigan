# iMac Pipeline Runbook

This is the APizzaMichigan home-runner playbook for the Michigan iMac.

## Current Operating Model

- Remote access: Tailscale SSH from the MacBook via `ssh example-host`.
- Process manager: macOS `launchd`.
- First production service: classifier only.
- Manual-only until approved: OSM extraction, website scraping, menu parse, QA, and Supabase sync.
- Working DB: local Postgres database `pizza_enrichment`.
- Queue: SQLite `scripts/.job-queue.db`.
- Local model: Ollama `llama3.2:latest`.

OpenClaw may remain installed for unrelated local-agent work, but APizzaMichigan
pipeline operation should not depend on OpenClaw, Discord, or GitHub Issues.

APizzaMichigan OpenClaw cron jobs should remain disabled. The launchd classifier
is the only approved always-on APizza process in this phase.

## Baseline Checks

Run from the MacBook:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/home-status-report.mjs'
```

Healthy baseline before starting services:

- repo is `main...origin/main` with no local modifications
- Postgres is reachable
- Ollama is reachable
- queue `processing=0`
- no live enrichment processes except Ollama
- stale worker rows are either absent or known cleanup candidates

Clean stale worker metadata:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

The cleanup script does not mutate jobs. It refuses to delete stale worker rows
that still own a live `processing` job.

## Classifier Service

Install the launchd template on the iMac:

```bash
ssh example-host 'cd /srv/apizzamichigan && \
  mkdir -p /tmp/apizzamichigan && \
  cp infra/local/launchd/com.apizzamichigan.classifier.plist.template ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist && \
  plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist && \
  launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist && \
  launchctl enable "gui/$(id -u)/com.apizzamichigan.classifier" && \
  launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.classifier"'
```

Check status:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh example-host 'tail -100 /tmp/apizzamichigan/classifier.log'
```

Stop service:

```bash
ssh example-host 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

## Retire Legacy OpenClaw Cron Jobs

OpenClaw can stay running for unrelated local-agent work, but old APizza cron
jobs must not restart the archived watchdog or coordinator.

List OpenClaw cron jobs:

```bash
ssh example-host '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron list'
```

The retired APizza jobs are:

- `092dc3b7-20ad-42a4-9dff-d5c417f4b90e` - `apizzamichigan watchdog keepalive`
- `c92e0d70-6159-402b-8980-72784da8e936` - `apizzamichigan enrichment keepalive (restart coordinator if down)`

If either appears enabled, disable it:

```bash
ssh example-host '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable 092dc3b7-20ad-42a4-9dff-d5c417f4b90e'
ssh example-host '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable c92e0d70-6159-402b-8980-72784da8e936'
```

Then verify APizza has only the launchd classifier process:

```bash
ssh example-host 'ps -axo pid,ppid,command | egrep "watchdog-keepalive|keepalive.mjs|coordinator.mjs|llm-classifier.mjs" | grep -v egrep || true'
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
```

## Manual Sync Policy

Supabase sync is manual-only in this phase.

Run QA before any sync:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/classification-qa-report.mjs --hours 24 --limit 500 --sample 25'
```

Preview the selected sync batch and protected-field behavior:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --batch 100 --sample 10'
```

Dry-run first:

```bash
ssh example-host 'cd /srv/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
```

Do not run a write sync until classification quality has been reviewed.

## Legacy Material

The old `orchestrator.mjs + watchdog.mjs + workers/* + enrichment_queue`
pipeline generation is archived under `scripts/enrichment/archive/`. It is
retained for reference only; do not use it for current operations.
