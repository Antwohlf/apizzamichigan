# Business Replacement Workflow

A restaurant can change its name or operator while staying in the same
location. The system treats that differently from a normal source match.

## Current Rules

### Unreviewed place

When the source is the exact same OpenStreetMap record, the business name has
changed, and the map record has no visit, rating, or note, **Update existing
place** is safe. It keeps the map record ID, refreshes the identity and source
details, clears stale enrichment, and records before/after evidence.

### Personal or reviewed place

When the old place has a visit, rating, note, or other personal history, the
system must not overwrite it. That case needs a separate historical workflow:

1. Keep the old place and its history intact.
2. Create a new canonical place for the new business.
3. Record that the new business replaced the old one.
4. Hide the old business from normal public discovery without deleting it.
5. Attach future source updates to the new business.

That workflow is intentionally not auto-applied yet because the public schema
and map need a lifecycle/replacement relationship at the same time. Splitting
only the local row would create two different truths between the admin system
and the public map.

## Audit Command

The read-only audit reports exact OSM identity changes and separates safe
unreviewed updates from records requiring historical handling:

```bash
LOCAL_DB_HOST=127.0.0.1 LOCAL_DB_PORT=15432 \
LOCAL_DB_NAME=pizza_enrichment LOCAL_DB_USER=ant \
node scripts/ops/replacement-candidate-report.mjs --entity pizza
```

No command in this document changes a place, queue row, or public data.
