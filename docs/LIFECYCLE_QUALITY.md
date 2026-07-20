# Lifecycle Quality Review

Run the read-only lifecycle report against local Postgres:

```bash
npm run lifecycle-report -- --entity pizza --limit 100
```

The `--limit` value only limits the example rows returned in each section.
The JSON report's `totals` object contains the full counts, so a value of 100
in a sample is not a claim that only 100 rows exist.

It separates four different kinds of work:

- **Replacements**: a source record has the same OSM identity as a canonical
  place but a different business name. Reviewed places remain human-gated.
- **Stale evidence**: the latest source record for a place/source pair is older
  than that source's freshness window, attached to a place without an explicit
  closed, replaced, or demolished lifecycle status. Older historical rows are
  not counted again.
  This is a source-refresh signal, not proof that the business is closed.
- **Same-location conflicts**: nearby canonical records with different names.
  These may be duplicates, translations, or a business replacement; the
  report does not merge them.
- **Chain coverage**: the number of canonical locations associated with a
  shared brand or operator identity. This is coverage information, not a
  duplicate warning.

The report is intentionally read-only. Decisions that change canonical names,
business status, history, or place identity remain explicit admin actions.

## Admin Worklist

The authenticated admin portal exposes the same evidence in small, human-sized
pages through:

```text
GET /api/admin/lifecycle-candidates?entity=pizza&kind=replacements&limit=50
GET /api/admin/lifecycle-candidates?entity=pizza&kind=stale&limit=50
GET /api/admin/lifecycle-candidates?entity=pizza&kind=conflicts&limit=50
```

The endpoint is read-only and bounded to 100 rows per request. Replacement
rows link directly into the normal source-review decision flow. Stale rows and
same-location conflicts are evidence for follow-up, not automatic closure or
merging decisions.
