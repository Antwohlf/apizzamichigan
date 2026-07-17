# APizzaMichigan launchd Services

These templates are for the Michigan iMac runner. Install them manually after
reviewing the current queue and local Postgres state.

## Classifier Service

The first production service is classifier-only. It does not run OSM extraction,
website scraping, menu parsing, or Supabase sync.

Install:

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.classifier.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.classifier.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.classifier"
launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.classifier"
```

Operate:

```bash
launchctl print "gui/$(id -u)/com.apizzamichigan.classifier"
launchctl bootout "gui/$(id -u)/com.apizzamichigan.classifier"
tail -f /tmp/apizzamichigan/classifier.log
```

Before starting, verify:

```bash
node scripts/ops/home-status-report.mjs
node scripts/ops/stale-worker-cleanup.mjs
```

## Supabase Sync Service

The Supabase sync service runs the guarded local Postgres -> Supabase path every
30 minutes. Each interval applies at most one 100-row batch after health, QA,
readiness, dry-run, and checkpoint gates pass.

Install:

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.supabase-sync.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.supabase-sync.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.supabase-sync.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.supabase-sync.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.supabase-sync"
launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.supabase-sync"
```

Operate:

```bash
launchctl print "gui/$(id -u)/com.apizzamichigan.supabase-sync"
launchctl bootout "gui/$(id -u)/com.apizzamichigan.supabase-sync"
tail -f /tmp/apizzamichigan/supabase-sync.log
```

## Source Pipeline Service

The source pipeline runs one bounded, round-robin source work unit each hour.
It keeps source fetches, review queue updates, strict reviewed-new imports, and
website enrichment under one lock. It is dry-run by default when invoked
manually; the launchd template is the explicit apply path.

Install:

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.source-pipeline.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.source-pipeline.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.source-pipeline.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.source-pipeline.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.source-pipeline"
launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.source-pipeline"
```

Operate:

```bash
launchctl print "gui/$(id -u)/com.apizzamichigan.source-pipeline"
tail -f /tmp/apizzamichigan/source-pipeline.log
```
