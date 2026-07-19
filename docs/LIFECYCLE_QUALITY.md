# Lifecycle Quality Review

Run the read-only lifecycle report against local Postgres:

```bash
npm run lifecycle-report -- --entity pizza --limit 100
```

It separates four different kinds of work:

- **Replacements**: a source record has the same OSM identity as a canonical
  place but a different business name. Reviewed places remain human-gated.
- **Closed or stale listings**: old source evidence attached to places that do
  not already have a closed status.
- **Same-location conflicts**: nearby canonical records with different names.
  These may be duplicates, translations, or a business replacement; the
  report does not merge them.
- **Chain coverage**: the number of canonical locations associated with a
  shared brand or operator identity. This is coverage information, not a
  duplicate warning.

The report is intentionally read-only. Decisions that change canonical names,
business status, history, or place identity remain explicit admin actions.
