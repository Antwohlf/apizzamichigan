# APizzaMichigan launchd Services

Scheduled Pizza/Taco source, enrichment, publication, backup, and support jobs
are owned by `packages/food-runtime` in the external
`Antwohlf/map-data-aggregation-enhancement-pipeline` repository. Their former
application-repository templates have been removed. Do not reinstall those jobs
from this checkout; use the external runtime's host deployment instructions and
private workspace.

The only launchd template retained here is the app-owned, read-only pipeline
health snapshot below. It is a compatibility status bridge for the admin portal,
not authority to start workers or enable a pipeline apply lane.

## Pipeline Health Snapshot

The optional template requests a read-only snapshot every 15 minutes. Its
presence does not mean a service is installed. It writes
`scripts/.pipeline-alert-status.json`, a machine-local snapshot consumed by the
admin portal. It does not start workers, change queue rows, or publish to
Supabase.

Do not install this template unchanged. In a private copy, replace
`__APP_CHECKOUT__` and `__NODE_EXECUTABLE__` with validated absolute paths
(shell-quote and XML-escape the command when necessary). Configure the registered
status identity and private inputs first. This is a legacy diagnostic bridge,
not the external runtime's publication-status collector.

After preparing that private copy:

```bash
mkdir -p /tmp/apizzamichigan
cp /path/to/private/com.apizzamichigan.pipeline-health.plist \
  ~/Library/LaunchAgents/com.apizzamichigan.pipeline-health.plist
plutil -lint ~/Library/LaunchAgents/com.apizzamichigan.pipeline-health.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.apizzamichigan.pipeline-health.plist
launchctl enable "gui/$(id -u)/com.apizzamichigan.pipeline-health"
```

Verify:

```bash
launchctl print "gui/$(id -u)/com.apizzamichigan.pipeline-health"
cat scripts/.pipeline-alert-status.json
```

The snapshot also includes the legacy read-only source activation inventory:

```bash
node scripts/ops/source-activation-report.mjs
node scripts/ops/source-activation-report.mjs --json
```

That inventory is diagnostic compatibility output only. It does not fetch
source data, change the review queue, publish to Supabase, or describe the
external runtime's current scheduler state.
