import {
  reviewedNewEnrichmentCommands,
  reviewedNewSyncCommands,
  reviewQueueExportCommand,
} from './AdminSourceProvenancePanel'

describe('reviewedNewSyncCommands', () => {
  test('builds guarded exact-id Supabase sync commands for imported reviewed-new rows', () => {
    expect(reviewedNewSyncCommands([
      { place_id: 181051 },
      { place_id: '181052' },
      { place_id: 181051 },
      { place_id: null },
    ])).toEqual({
      ids: [181051, 181052],
      dryRun: 'node scripts/sync-local-to-supabase.mjs --ids 181051,181052 --insert-missing-reviewed-new --batch 2 --max-batches 1 --dry-run',
      apply: 'node scripts/sync-local-to-supabase.mjs --ids 181051,181052 --insert-missing-reviewed-new --batch 2 --max-batches 1',
    })
  })

  test('returns null when no imported canonical ids are present', () => {
    expect(reviewedNewSyncCommands([{ review_id: 1 }, { place_id: 'not-a-number' }])).toBeNull()
  })
})

describe('reviewedNewEnrichmentCommands', () => {
  test('builds exact per-id scrape and classify queue commands for imported rows', () => {
    expect(reviewedNewEnrichmentCommands([
      { place_id: 182004, google_place_id: 'all_the_places:j9TcUvNvyMX49HDgmdYs3rj-2K8=' },
    ])).toEqual({
      ids: [182004],
      scrape: [
        'node scripts/enrichment/populate-scrape-from-db.mjs --type pizza --id-prefix all_the_places: --min-place-id 182004 --max-place-id 182004 --priority-boost 100000 --limit 1',
      ],
      classify: [
        "node scripts/enrichment/populate-classify-from-db.mjs --state '*' --id-prefix all_the_places: --min-place-id 182004 --max-place-id 182004 --priority-boost 100000 --limit 1",
      ],
    })
  })

  test('returns null when no imported canonical ids are present for enrichment', () => {
    expect(reviewedNewEnrichmentCommands([{ review_id: 1 }, { place_id: 'not-a-number' }])).toBeNull()
  })
})

describe('reviewQueueExportCommand', () => {
  test('builds a pending review-bucket export command for the current bottleneck', () => {
    expect(reviewQueueExportCommand({
      source: 'all_the_places',
      reportFile: 'dominos_pizza_us-review.json',
      kind: 'ambiguous',
      status: 'pending',
      readiness: 'link_review',
    }, { entity: 'pizza' })).toBe(
      'node scripts/ops/export-reviewed-source-candidates.mjs --entity pizza --status pending --kind ambiguous --output reports/source-review-dominos_pizza_us-ambiguous-pending.csv --source all_the_places --report-file dominos_pizza_us-review.json'
    )
  })

  test('quotes unsafe filter values in generated commands', () => {
    expect(reviewQueueExportCommand({
      source: "operator's source",
      reportFile: "odd report-review.json",
      kind: 'likely_new',
      status: 'accepted',
    }, { entity: 'pizza' })).toContain("--source 'operator'\\''s source'")
  })
})
