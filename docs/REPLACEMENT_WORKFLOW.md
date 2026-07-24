# Business Replacement Workflow

A restaurant can change its name or operator while staying in the same
location. The system treats that differently from a normal source match.

## Current Rules

### Unreviewed place

When the source is the exact same OpenStreetMap record, the business name has
changed, and the map record has no visit, rating, or note, the row is eligible
for the guarded **Update existing place** action. It is not an automatic
promotion: an exact OSM identity proves continuity of the mapped location,
not that the business itself has not been replaced. The operator must still
decide whether this is a spelling/name correction or a successor business.
The action keeps the map record ID, refreshes the identity and source details,
clears stale enrichment, and records before/after evidence.

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

The schema now provides that relationship without adding another table:

- `lifecycle_status` is explicitly `closed`, `replaced`, or `demolished`.
- `lifecycle_replaced_by_id` points to the newer canonical place when one exists.
- `NULL` means the place has not been explicitly classified as historical; it is
  not treated as evidence that the business is active.

These fields are manual lifecycle fields. Source adapters and enrichment do not
promote them automatically. When lifecycle sync is enabled, it will send only
non-null explicit values so an unclassified local row cannot erase a reviewed
public lifecycle.

Before enabling lifecycle sync, apply the local statements in
`scripts/enrichment/schema-migration.sql` to local Postgres and the public
statements in `scripts/enrichment/supabase-production-migration.sql` to
Supabase. Then set `ENABLE_LIFECYCLE_SYNC=1` on the guarded sync service and
run its readiness report before allowing the recurring job to continue.
Without that environment flag, lifecycle values remain local-only by design.

## Audit Command

The read-only audit reports exact OSM identity changes and separates safe
unreviewed updates from records requiring historical handling:

```bash
LOCAL_DB_HOST=127.0.0.1 LOCAL_DB_PORT=15432 \
LOCAL_DB_NAME=pizza_enrichment LOCAL_DB_USER=ant \
node scripts/ops/replacement-candidate-report.mjs --entity pizza
```

The audit command above never changes a place, queue row, or public data. Its
`unreviewed_identity_change_requires_review` label means the old row has no
personal history, not that the name change is safe to apply automatically.

## Explicit Lifecycle Action

### Same-location replacement from source review

When an exact OSM match has a different business name and the old place has
personal history, use **Business replaced** in the admin data review. The
guarded action:

1. Marks the old canonical place `closed` without changing its visits, rating,
   or notes.
2. Moves the source row into the likely-new approval queue.
3. Allows the reviewed-new import preflight to recognize the closed source
   identity as a replacement rather than a duplicate.
4. Imports the successor with the original source identity, marks the old row
   `replaced`, and records `lifecycle_replaced_by_id`.

The old row receives a `historical:` external identity so the unique source ID
can belong to the successor. The source provenance row follows the successor,
while the decision history preserves the before/after record.

This is deliberately separate from **Same place** and **Update existing
place**: the first links evidence without changing the canonical name, and the
second is only for an unreviewed place with no personal history.

Once the additive schema has been applied locally, an operator can record a
verified lifecycle decision without changing the place's visit history:

```bash
node scripts/ops/set-place-lifecycle.mjs \\
  --entity pizza --id 123 --status closed \\
  --reason "Official site confirms permanent closure"
```

That command is a dry run by default. Add `--apply` only after reviewing the
before/after output. For a replacement, use `--status replaced
--replaced-by-id <new-place-id>`. The admin API exposes the same guarded
operation at `PATCH /api/admin/places/:id/lifecycle`.
