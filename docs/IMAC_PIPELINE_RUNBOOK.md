# iMac Pipeline Runbook

This is the APizzaMichigan home-runner playbook for the Michigan iMac.

## Current Operating Model

- Remote access: Tailscale SSH from the MacBook via `ssh apizza-imac`.
- Process manager: macOS `launchd`.
- Production services: classifier plus guarded Supabase sync.
- Manual-only until approved: OSM extraction, website scraping, menu parse, and
  new source imports.
- Working DB: local Postgres database `pizza_enrichment`.
- Queue: SQLite `scripts/.job-queue.db`.
- Local model: Ollama `llama3.2:latest`.

OpenClaw may remain installed for unrelated local-agent work, but APizzaMichigan
pipeline operation should not depend on OpenClaw, Discord, or GitHub Issues.

APizzaMichigan OpenClaw cron jobs should remain disabled. The launchd classifier
is the only approved always-on enrichment process in this phase. Guarded
Supabase sync runs as a bounded launchd interval job and should not overlap.

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

## Retire Legacy OpenClaw Cron Jobs

OpenClaw can stay running for unrelated local-agent work, but old APizza cron
jobs must not restart the archived watchdog or coordinator.

List OpenClaw cron jobs:

```bash
ssh apizza-imac '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron list'
```

The retired APizza jobs are:

- `092dc3b7-20ad-42a4-9dff-d5c417f4b90e` - `apizzamichigan watchdog keepalive`
- `c92e0d70-6159-402b-8980-72784da8e936` - `apizzamichigan enrichment keepalive (restart coordinator if down)`

If either appears enabled, disable it:

```bash
ssh apizza-imac '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable 092dc3b7-20ad-42a4-9dff-d5c417f4b90e'
ssh apizza-imac '/usr/local/bin/node ~/.npm-global/lib/node_modules/openclaw/openclaw.mjs cron disable c92e0d70-6159-402b-8980-72784da8e936'
```

Then verify APizza has only the launchd classifier process:

```bash
ssh apizza-imac 'ps -axo pid,ppid,command | egrep "watchdog-keepalive|keepalive.mjs|coordinator.mjs|llm-classifier.mjs" | grep -v egrep || true'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/classifier-health-report.mjs'
```

## Guarded Sync Policy

Supabase sync is automated through `com.apizzamichigan.supabase-sync`, but only
through the guarded wrapper. The wrapper runs health, QA, readiness, dry-run,
bounded write, and post-check gates before applying at most one configured batch.

The sync target is intentionally narrow: only canonical `pizza_places` rows are
eligible. `place_sources` and `source_review_queue` are local-only provenance
and review tables. The sync policy in `scripts/lib/supabase-sync-policy.mjs`
defines that boundary, and both readiness/status reports print it before any
operator uses the results.

Run QA before any sync:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/classification-qa-report.mjs --hours 24 --limit 500 --sample 25'
```

Preview the selected sync batch and protected-field behavior:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --batch 100 --sample 10'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --batch 50 --sample 20'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --checkpoint scripts/.supabase-sync-checkpoint.json --batch 50 --sample 20'
```

Dry-run first:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --changed-since-hours 6 --only-classified --batch 50 --max-batches 1'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/sync-local-to-supabase.mjs --dry-run --changed-since-hours 6 --only-classified --checkpoint scripts/.supabase-sync-checkpoint.json --batch 50 --max-batches 1'
```

Preferred guarded runner:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/supabase-sync-status-report.mjs --hours 6 --batch 50'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --hours 6 --batch 50'
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/guarded-supabase-sync.mjs --hours 6 --batch 50 --apply'
```

The production sync service uses the same guarded runner through a launchd-safe
wrapper:

```bash
ssh apizza-imac 'cd /Users/ant/clawd/projects/apizzamichigan && node scripts/ops/auto-guarded-supabase-sync.mjs'
ssh apizza-imac 'launchctl print "gui/$(id -u)/com.apizzamichigan.supabase-sync"'
ssh apizza-imac 'tail -100 /tmp/apizzamichigan/supabase-sync.log'
```

The service applies at most one 100-row batch every 30 minutes. It should remain
disabled if classification QA is not healthy.

The wrapper owns `/tmp/apizzamichigan/supabase-sync.lock` to avoid overlapping
runs. If a prior process exits badly, locks older than 25 minutes are treated as
stale and removed on the next scheduled run.

## Legacy Material

The old `orchestrator.mjs + watchdog.mjs + workers/* + enrichment_queue`
pipeline generation is archived under `scripts/enrichment/archive/`. It is
retained for reference only; do not use it for current operations.
