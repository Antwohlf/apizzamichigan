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

The checked-in template enables guarded bulk RPC writes for lower Supabase
disk I/O and includes lifecycle fields. Load it only after the sync readiness
report confirms the remote RPC and lifecycle columns are ready.

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

## Menu Parser Slowlane

The deterministic menu parser is deliberately scheduled separately from the
classifiers and scraper. It runs at most 100 jobs every 2 minutes, uses no
Ollama, and writes only local Postgres menu fields plus queue state.

Install after confirming the classifier and scraper are healthy:

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.menu-parser.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.menu-parser.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.menu-parser.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.menu-parser.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.menu-parser"
launchctl kickstart -k "gui/$(id -u)/com.apizzamichigan.menu-parser"
```

Operate:

```bash
launchctl print "gui/$(id -u)/com.apizzamichigan.menu-parser"
tail -f /tmp/apizzamichigan/menu-parser.log
```

## Local Backup Service

The backup job creates a machine-local recovery bundle containing a custom
`pg_dump` of `pizza_enrichment`, a consistent snapshot of the SQLite queue,
and a checksum manifest. It retains seven completed runs and never contacts
Supabase. Backups are ignored by git and should be copied to separate storage
for protection from disk failure.

Preview the paths without writing anything:

```bash
node scripts/ops/create-local-backup.mjs --dry-run
```

Install the daily 03:30 service:

```bash
mkdir -p /tmp/apizzamichigan
cp infra/local/launchd/com.apizzamichigan.backup.plist.template \
  ~/Library/LaunchAgents/com.apizzamichigan.backup.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.backup.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.backup.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.backup"
```

Run one manually when the local database and all workers are healthy:

```bash
node scripts/ops/create-local-backup.mjs --retention 7
```

Each run contains `manifest.json` with file sizes and SHA-256 checksums. To
restore Postgres, prefer restoring into a separate database first with
`pg_restore --no-owner --no-acl --dbname <new_database> <dump>`. Replacing the
queue snapshot is destructive: stop every worker, remove any queue WAL/SHM
files, replace the database file, and only then restart services.
