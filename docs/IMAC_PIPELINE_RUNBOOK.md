# iMac Pipeline Runbook

This is the APizzaMichigan home-runner playbook for the Michigan iMac.

## Current Operating Model

- Remote access: Tailscale SSH from the MacBook via `ssh apizza-imac`.
- Process manager: macOS `launchd`.
- First production service: classifier only.
- Manual-only until approved: OSM extraction, website scraping, menu parse, QA, and Supabase sync.
- Working DB: local Postgres database `pizza_enrichment`.
- Queue: SQLite `scripts/.job-queue.db`.
- Local model: Ollama `llama3.2:latest`.

OpenClaw may remain installed for unrelated local-agent work, but APizzaMichigan
pipeline operation should not depend on OpenClaw, Discord, or GitHub Issues.

## Baseline Checks

Run from the MacBook:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/home-status-report.mjs'
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
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/stale-worker-cleanup.mjs --apply'
```

The cleanup script does not mutate jobs. It refuses to delete stale worker rows
that still own a live `processing` job.

## Classifier Service

Install the launchd template on the iMac:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && \
  mkdir -p /tmp/apizzamichigan && \
  cp infra/local/launchd/com.apizzamichigan.classifier.plist.template ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist && \
  plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist && \
  launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist && \
  launchctl enable "gui/$(id -u)/com.apizzamichigan.classifier" && \
  launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.classifier"'
```

Check status:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
ssh apizza-imac 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh apizza-imac 'tail -100 /tmp/apizzamichigan/classifier.log'
```

Stop service:

```bash
ssh apizza-imac 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

## Manual Sync Policy

Supabase sync is manual-only in this phase.

Dry-run first:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
```

Do not run a write sync until classification quality has been reviewed.

## Legacy Material

The old `orchestrator.mjs + watchdog.mjs + workers/* + enrichment_queue`
pipeline generation is archived under `scripts/enrichment/archive/`. It is
retained for reference only; do not use it for current operations.
