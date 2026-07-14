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
