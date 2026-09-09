# Data pipeline safeguards

- Run scheduled acquisition, enrichment, publication, and backups only from
  the external runtime; never restore an old website-owned scheduler.
- Keep product identities separate in queues, source review, and publication.
- Preserve personal ratings, notes, photos, visits, and editorial decisions.
  Source evidence does not authorize overwriting protected fields.
- Retain health, QA, readiness, dry-run, and post-publication checks.
- Use narrow host-only credentials, never private browser credentials.
- Back up and drain the owner before migrating queues or writers.
  Never reset checkpoints to make a failed run appear healthy.
- Keep host topology, installed services, extracts, logs, and receipts private.

Former machine-specific instructions were preserved privately. Current runtime
instructions live in the [pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
See [PIPELINE_BOUNDARY.md](PIPELINE_BOUNDARY.md) for app-owned contracts.
