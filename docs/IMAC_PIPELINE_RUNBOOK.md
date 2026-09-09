# Host runbook location

Production operations have moved out of this website repository. The iMac runs
product-specific jobs from the [external pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline),
using private state and credentials and shared admission for heavy work.

Use external runtime documentation and the private deployment inventory.
Do not reinstall historical services, restart retired watchdogs, restore old
checkpoints, or infer host health from this file.

The old concrete runbook was preserved privately and remains recoverable in
Git history pending the separate public-release history audit.
See [the application boundary](PIPELINE_BOUNDARY.md) and
[release gates](PUBLIC_RELEASE.md).
