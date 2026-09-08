# iMac Pipeline Runbook

> **Compatibility reference:** scheduled Pizza/Taco jobs now launch from
> `packages/food-runtime` in the external pipeline repository. Do not install
> or repoint production services from this application checkout. The commands
> below are retained temporarily for host reconciliation and must be translated
> to the private runtime workspace before use.

This was the APizzaMichigan home-runner playbook for the Michigan iMac.

## Current Operating Model

- Remote access: Tailscale SSH from the MacBook via `ssh example-host`.
- Process manager: macOS `launchd`.
- Production services: source pipeline, classifier, plus guarded Supabase sync.
- Menu parsing remains manual/paused; source imports and bounded website
  scraping run through the source pipeline.
- Working DB: local Postgres database `pizza_enrichment`.
- Queue: SQLite `scripts/.job-queue.db`.
- Local model: Ollama `llama3.2:latest`.

OpenClaw may remain installed for unrelated local-agent work, but APizzaMichigan
pipeline operation should not depend on OpenClaw, Discord, or GitHub Issues.

APizzaMichigan OpenClaw cron jobs should remain disabled. The launchd source
pipeline and classifier are the approved enrichment processes. Guarded
Supabase sync runs as a bounded launchd interval job and should not overlap.

## Baseline Checks

### Attribute Readiness Reports

The consolidated readiness report includes an `execution_context` block with
the hostname, platform, working directory, and Node version. This matters when
the same command is run from the MacBook and the iMac: local service failures on
the MacBook do not describe the production runner.

It also includes a `repository` block with the checked-out branch, `HEAD`,
`origin/main`, ahead/behind sync state, and clean/dirty state. Treat a stale or
dirty repository as a deployment problem even when the local workers themselves
are healthy.

For a stable human-readable label on the iMac, set this non-secret environment
variable in the shell or launchd environment:

```bash
export APIZZA_RUNTIME_HOST=example-host
```

The label appears as `Host: example-host (darwin)` in text output and as
`execution_context.host_label` in JSON. The report remains read-only.

The iMac's non-interactive SSH environment does not include `/usr/local/bin` in
`PATH`. Use the installed Node runtime explicitly in remote commands; this is
also the path used by the launchd templates.

Run from the MacBook:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/home-status-report.mjs'
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
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/stale-worker-cleanup.mjs'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/stale-worker-cleanup.mjs --apply'
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
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/classifier-health-report.mjs'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"'
ssh example-host 'tail -100 /tmp/apizzamichigan/classifier.log'
```

For a scoped classification coverage check, inspect only the public operating
states and ask for rows where the classifier produced no usable output:

```bash
ssh example-host 'cd /srv/apizzamichigan && \
  /usr/local/bin/node scripts/ops/classification-qa-report.mjs \
    --states MI,NY --missing --limit 100 --sample 25 --json'
```

This is read-only. It reports the scoped total, classified/priced coverage,
the remaining rows with no style, price, or confidence, and a bounded sample
for follow-up. It does not infer a style, requeue a job, or write Postgres or
Supabase.

Stop service:

```bash
ssh example-host 'launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"'
```

## Source Pipeline Service

## Website Scraper Service

Website scraping runs as its own persistent launchd worker so it stays ahead
of classification instead of waiting for the hourly source pipeline. It hands
successful website evidence to the classifier and menu-parse queue.

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.scraper.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.scraper.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.scraper.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.scraper.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.scraper"
launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.scraper"
```

Verify its queue activity with `home-status-report.mjs`; a healthy scraper
should show recent scrape completions and no stale `launchd-scraper` worker.

### Laptop Ollama tunnel

The classifiers use the iMac loopback endpoint `http://127.0.0.1:11435`.
That port is supplied by the laptop's persistent reverse SSH tunnel to its
local Ollama service. The checked-in launchd template must be installed on the
laptop, not the iMac, because the laptop owns the Ollama process and the
reverse SSH connection:
`infra/local/launchd/com.apizzamichigan.laptop-ollama-tunnel.plist.template`.
Install it on the laptop with:

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.laptop-ollama-tunnel.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.laptop-ollama-tunnel.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.laptop-ollama-tunnel.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.laptop-ollama-tunnel.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.laptop-ollama-tunnel"
launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.laptop-ollama-tunnel"
```

The classifier health report checks the same tunnel endpoint and reports the
launchd owner when run on the laptop. On the iMac, the endpoint check is the
authoritative connectivity check and a missing local tunnel service is shown
as a warning, because the reverse tunnel is intentionally owned by the laptop.
The report must show `baseUrl=http://127.0.0.1:11435`.

The read-only alert report also warns when the source-review backlog exceeds
`PIPELINE_REVIEW_BACKLOG_WARNING_LIMIT` (default `5000`). This is a workload
warning, not a pipeline failure; it is intended to prompt bounded review
batches before the queue becomes operationally unmanageable.

Applied source-scheduler health state is stored in
`scripts/.source-pipeline-last-report.json`. Manual `--dry-run` diagnostics are
stored separately in `scripts/.source-pipeline-last-dry-run.json`, so a dry run
cannot overwrite the evidence used by unattended health checks.

The source pipeline is the US-first production entry point for OSM, FSQ OS
Places, All the Places, Overture, Wikidata, and official-website enrichment.
It uses the existing provenance/review tables and keeps machine-local cursors
and downloaded inputs out of Git. Manual invocations are dry-run by default:

Apply-mode runs also promote at most the configured contact-field limit from
eligible source evidence into blank local canonical `website_url` and `phone`
fields. The promotion rechecks freshness, confidence, source priority, and
match method, and does not publish to Supabase. The limit is
`config/source-pipeline.json` -> `limits.contact_promotions_per_run`.

Each apply tick also feeds a small, deduplicated classifier batch for the
selected operational regions. It skips any place that already has a classify
job, including completed jobs, so the feeder advances through the
missing-style/price backlog without duplicating work or creating a second
classifier process. The default regions come from
`config/source-pipeline.json`; an explicit `--regions` selection is honored by
both discovery and classifier feeding.

Each regional OSM export has a resumable manifest. The exporter refuses to
reuse a manifest when the requested bounding box or tile step differs from the
manifest metadata. This prevents an accidental retry for one region from
mixing tiles into another region's checkpoint. When a manifest is suspect,
preserve it for audit and start a clean export with a new output and manifest
path; do not overwrite the existing artifact.

After an applied OSM export, the runner also refreshes up to the configured
`provenance_refresh_limit_per_run` exact source IDs that already exist in local
`place_sources`. This keeps OSM evidence freshness meaningful even when a row
is already linked and therefore no longer appears in the review queue. The
refresh updates only source evidence and retrieval time; it never creates a
canonical place, changes identity or lifecycle fields, promotes values, or
syncs Supabase. It is scoped to the configured operational states so broad
regional bounding boxes do not spend the refresh budget outside the public
product geography. Rows beyond the per-run limit are handled by later
scheduled runs. The applied scheduler report records the refresh result under
the OSM work unit as `osm_provenance_refresh`, including `existingLinks`,
`refreshed`, and `skippedByLimit`, so operators can distinguish remaining
stale evidence from evidence outside the current bounded input slice.

The deterministic menu parser is a separate slowlane. It may be installed from
`infra/local/launchd/com.apizzamichigan.menu-parser.plist.template` after the
classifier and scraper health checks pass. It is capped at 100 jobs per
2-minute interval, does not use Ollama, and does not sync to Supabase. Each
run remains capped at 100 jobs so the deterministic slowlane cannot monopolize
the local database.

To prioritize places that already have a discovered menu URL but have never
been parsed, preview and then apply a bounded backfill:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/populate-menu-parse-from-db.mjs --state MI --limit 100'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/populate-menu-parse-from-db.mjs --state MI --limit 100 --apply'
```

The helper only queues rows with `menu_url` and a null
`menu_last_parsed_at`; it does not modify canonical fields or Supabase.

The source scheduler also performs a separate, very small partial-classification
retry pass. It may requeue at most two completed jobs per operational region per
run when a prior classifier result filled only one of `style` or `price_range`.
Each job can receive this retry once; fully classified, failed, and active jobs
are left alone. This prevents a completed-but-partial result from disappearing
from the feeder while keeping Ollama load bounded.

The classifier health report labels this backlog separately from the SQLite queue:

- `clear`: no configured classification work remains.
- `queued`: jobs are pending or actively processing.
- `partial_retry_pending`: completed jobs still qualify for the one-time bounded retry.
- `manual_review`: partial results exhausted automatic retry and need editorial review.
- `unfed`: a qualifying place has no classify job and needs the feeder.

An empty queue is therefore not sufficient evidence that classification is fully
caught up; inspect `classificationBacklog.state` and
`classificationBacklog.recommendedAction` in the JSON health report.

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/run-source-pipeline.mjs --dry-run --max-work-units 2 --json'
```

For a bounded operator recovery, add `--force` to bypass source cadence while
retaining the normal work-unit and new-place limits. Use `--regions MI,NY` when
the work should stay within the product's priority geography; without that
option the runner uses all configured regions. Launchd does not use either
operator-only flag, so scheduled runs remain cadence-controlled and global.

The launchd template is the explicit apply path. It caps heavy work at six
units per 15-minute run, strict new-place creation at 50 per run and 250 per day, and
website scraping at 75 bounded jobs per run. OSM itself runs every 15 minutes
cadence and processes its configured regional budget per scheduler run. The runner never starts
concurrent top-level OSM workers; its hard runtime cap, request timeouts,
endpoint failover, and resumable manifests keep the regional batch bounded
when an Overpass provider is slow.

The template also sets bounded OSM timeouts: 90 seconds for the Overpass query,
120 seconds for an HTTP request, and 180 seconds for a tile subprocess. A slow
provider therefore fails over or checkpoints instead of holding the
source-pipeline job indefinitely. The launchd job runs every 15 minutes. Each
region uses its configured resumable-tile budget per run. Successful tiles remain usable when a run
ends partially. A timed-out tile may be adaptively split through two bounded
level before its remaining subtiles are checkpointed for the next scheduled
attempt. This deliberately keeps a difficult tile from consuming the entire
parent run through repeated recursive splits.
The parent OSM stage is allowed 20 minutes to process its bounded tile batch;
the `OSM_PIPELINE_TIMEOUT_MS` override is available for a deliberately larger
operator-run batch.

```bash
ssh example-host 'cd /srv/apizzamichigan && mkdir -p /tmp/apizzamichigan && cp infra/local/launchd/com.apizzamichigan.source-pipeline.plist.template ~/Library/LaunchAgents/com.apizzamichigan.source-pipeline.plist && plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.source-pipeline.plist && launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.source-pipeline.plist && launchctl enable "gui/$(id -u)/com.apizzamichigan.source-pipeline" && launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.source-pipeline"'
```

Check it with:

```bash
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.source-pipeline"'
ssh example-host 'tail -100 /tmp/apizzamichigan/source-pipeline.log'
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
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/classifier-health-report.mjs'
```

For a single machine-readable alert gate covering classifier health, queue
balance, stale jobs, and scrape-failure categories:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/pipeline-alert-report.mjs --json'
```

The command is read-only. It exits nonzero only for actionable failures;
warnings such as a scraper backlog imbalance remain exit-zero so routine
throughput variation does not page anyone. Configure
`PIPELINE_UNKNOWN_SCRAPE_FAILURE_LIMIT` and `PIPELINE_SCRAPE_AHEAD_MINIMUM`
in the machine-local environment when deploying the check. The alert gate also
reads `scripts/.source-pipeline-state.json`: a source run older than
`PIPELINE_SOURCE_STALE_MINUTES` (default 180) is actionable, while individual
source failures are reported as warnings so the scheduler can continue other
sources.

The alert gate also checks every `processing` queue job, not only classifier
jobs. `PIPELINE_STALE_PROCESSING_MINUTES` defaults to 120; an aged scrape or
menu job is reported as actionable with its job ID and worker assignment so an
operator can verify the heartbeat before requeueing it.

The same read-only alert report now includes Supabase publication readiness.
When the lifecycle schema exists but the guarded bulk RPC is missing, it emits
a warning and the exact migration action instead of presenting the local
pipeline as fully publishable.

The OSM refresh uses region-specific tile budgets because the regions do not
have comparable Overpass response times. The current bounded profile is eight
tiles per Michigan run, four per New York run, and two per Texas or California
run. Texas and California stay conservative because adaptive tile splits can
approach the per-run runtime limit; the scheduler resumes remaining tiles on
later runs instead of retrying an entire region.

Retryable scrape recovery can be narrowed to a source prefix, which is
important because legacy OSM jobs currently dominate the historical failure
population:

```bash
ssh example-host 'cd /srv/apizzamichigan && \
  /usr/local/bin/node scripts/ops/requeue-scrape-failures.mjs \
    --category transient --source fsq_os_places --limit 100 --json'
```

Add `--apply` only after reviewing the dry-run selection. OSM, blocked, dead
link, and unknown failures should not be bulk-retried by default.

Before installing or updating launchd services, run the checked-in configuration
contract check. It validates templates and entrypoints without reading local
credentials or contacting runtime services:

```bash
node scripts/ops/verify-runtime-configuration.mjs
```

The reverse Ollama tunnel is owned by the laptop launchd job, not by the iMac.
The iMac health report therefore treats a live listener on `127.0.0.1:11435`
and a successful Ollama `/api/tags` response as the authoritative tunnel check.
The iMac cannot inspect the laptop's launchd domain over the reverse tunnel, so
that remote service's absence from `launchctl print` is not itself a warning.
The JSON health report identifies the expected service as
`com.apizzamichigan.laptop-ollama-tunnel` and records that its `KeepAlive`
launchd policy is the recovery mechanism. A live listener proves connectivity,
but does not prove the laptop launchd job is currently installed.

### Classifier retry feeder

Partial classifier outputs are retried by a separate bounded feeder so source
downloads cannot starve recovery. It runs every five minutes, keeps at most two
classify jobs pending or processing, and gives up after one partial retry; the
remaining exhausted rows stay in the human review backlog:

```bash
ssh example-host 'cd /srv/apizzamichigan && cp infra/local/launchd/com.apizzamichigan.classifier-retry-feeder.plist.template ~/Library/LaunchAgents/com.apizzamichigan.classifier-retry-feeder.plist && plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.classifier-retry-feeder.plist && launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.classifier-retry-feeder.plist && launchctl enable "gui/$(id -u)/com.apizzamichigan.classifier-retry-feeder" && launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.classifier-retry-feeder"'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/feed-classifier-retries.mjs --dry-run'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier-retry-feeder"'
```

### Classifier queue reconciler

The classifiers recover detached jobs during their normal loop. A separate
launchd reconciler covers the case where a classifier is blocked inside an
Ollama request and cannot run its own cleanup. It checks the actual process
table and requeues only classify jobs older than 30 minutes whose owning
classifier process is gone:

```bash
ssh example-host 'cd /srv/apizzamichigan && cp infra/local/launchd/com.apizzamichigan.classifier-reconciler.plist.template ~/Library/LaunchAgents/com.apizzamichigan.classifier-reconciler.plist && plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.classifier-reconciler.plist && launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.classifier-reconciler.plist && launchctl enable "gui/$(id -u)/com.apizzamichigan.classifier-reconciler" && launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.classifier-reconciler"'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/reconcile-classifier-queue.mjs'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.classifier-reconciler"'
```

## Guarded Sync Policy

Supabase sync is automated through `com.apizzamichigan.supabase-sync`, but only
through the guarded wrapper. The wrapper runs health, QA, readiness, dry-run,
bounded write, and post-check gates before applying at most one configured batch.
The sync client and database-side bulk RPC both cap a transaction at 500 rows;
scheduled runs normally use a smaller configured batch so a manual override
cannot turn the low-I/O path into an unbounded disk burst.
It checks bulk-RPC availability before running local confidence repair; when the
production migration is missing, the scheduled run skips cleanly and leaves the
capability status visible without doing unnecessary local writes.

The sync target is intentionally narrow: only canonical `pizza_places` rows are
eligible. The scheduled job may insert a missing canonical row only when
`place_sources` or `source_review_queue` proves `reviewed_new_import` or
`imported_new`; unproven missing rows are skipped to avoid accidental duplicates.
`place_sources` and `source_review_queue` are local-only provenance
and review tables. The sync policy in `scripts/lib/supabase-sync-policy.mjs`
defines that boundary, and both readiness/status reports print it before any
operator uses the results.

An expected `WARN` with `missingSupabaseRows > 0` is not a failed sync service:
it means the selected batch contains local canonical rows that are absent from
Supabase and therefore cannot use the ordinary update-only path. The scheduled
wrapper inserts approved reviewed-new rows when they are encountered by the
normal checkpointed sync. Broad reviewed-new reconciliation is intentionally
not part of the 30-minute hot path because it scans a larger local and remote
set. Run it explicitly during maintenance when needed:

```bash
ssh example-host 'cd /srv/apizzamichigan && APIZZA_SYNC_RUN_RECONCILIATION=true /usr/local/bin/node scripts/ops/auto-guarded-supabase-sync.mjs'
```

Rows without `reviewed_new_import` proof remain intentionally blocked until reviewed.

Supabase network failures use bounded retry/backoff. Inserts confirm the row by
ID before retrying after an uncertain response, preventing duplicate rows.

Verify the sync boundary before changing sync scripts or running a manual sync:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-supabase-sync-policy.mjs'
```

Verify the source promotion boundary before changing source adapters or
promotion scripts:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-source-promotion-policy.mjs'
```

Verify that the written source/provenance contract still matches the promotion
and Supabase sync policy modules:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-source-contract-docs.mjs'
```

Summarize the whole source-pipeline backlog before choosing the next source
task:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/source-pipeline-readiness-report.mjs'
```

Verify source matching still uses the canonical-row prefetch and in-memory grid
path before running large source batches:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-source-matching-prefetch.mjs'
```

Verify the curated ATP spider manifest before rerunning ATP chain/regional
batches:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-atp-spider-manifest.mjs'
```

Verify the generic source-input adapter contract before adding FSQ, Overture,
Wikidata, government, DENUE, or official-website samples:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-source-input-adapters.mjs'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-fsq-sample-workflow.mjs'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-fsq-review-summary.mjs'
```

Verify the source review workflow boundary before changing admin review actions
or reviewed-new import code:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-source-review-workflow.mjs'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/verify-reviewed-new-backlog-report.mjs'
```

Run QA before any sync:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/classification-qa-report.mjs --hours 24 --limit 500 --sample 25'
```

Preview the selected sync batch and protected-field behavior:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/supabase-sync-readiness-report.mjs --batch 100 --sample 10'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --batch 50 --sample 20'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/supabase-sync-readiness-report.mjs --changed-since-hours 6 --only-classified --checkpoint scripts/.supabase-sync-checkpoint.json --batch 50 --sample 20'
```

Dry-run first:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/sync-local-to-supabase.mjs --dry-run --changed-since-hours 6 --only-classified --batch 50 --max-batches 1'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/sync-local-to-supabase.mjs --dry-run --changed-since-hours 6 --only-classified --checkpoint scripts/.supabase-sync-checkpoint.json --batch 50 --max-batches 1'
```

Preferred guarded runner:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/supabase-sync-status-report.mjs --hours 6 --batch 50'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/guarded-supabase-sync.mjs --hours 6 --batch 50'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/guarded-supabase-sync.mjs --hours 6 --batch 50 --apply'
```

For reviewed-new canonical rows that are missing from Supabase, use exact IDs
and the explicit reviewed-new insert flag. The lower-level sync still requires
local `place_sources.match_method='reviewed_new_import'` before inserting:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/guarded-supabase-sync.mjs --ids 182432,182527 --insert-missing-reviewed-new'
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/guarded-supabase-sync.mjs --ids 182432,182527 --insert-missing-reviewed-new --apply'
```

The production sync service uses the same guarded runner through a launchd-safe
wrapper:

```bash
ssh example-host 'cd /srv/apizzamichigan && /usr/local/bin/node scripts/ops/auto-guarded-supabase-sync.mjs'
ssh example-host 'launchctl print "gui/$(id -u)/com.apizzamichigan.supabase-sync"'
ssh example-host 'tail -100 /tmp/apizzamichigan/supabase-sync.log'
```

The service applies at most one 100-row ordinary batch every 30 minutes. Broad
reviewed-new reconciliation is maintenance-only and must be explicitly enabled
with `APIZZA_SYNC_RUN_RECONCILIATION=true`; it should remain disabled if
classification QA is not healthy.

The wrapper owns `/tmp/apizzamichigan/supabase-sync.lock` to avoid overlapping
runs. If a prior process exits badly, locks older than 25 minutes are treated as
stale and removed on the next scheduled run.

## Legacy Material

The old `orchestrator.mjs + watchdog.mjs + workers/* + enrichment_queue`
pipeline generation is archived under `scripts/enrichment/archive/`. It is
retained for reference only; do not use it for current operations.
