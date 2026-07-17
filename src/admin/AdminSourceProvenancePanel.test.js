import {
  reviewedNewEnrichmentCommands,
  reviewedNewSyncCommands,
  reviewQueueExportCommand,
  selectedReviewEligibilitySummary,
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

  test('does not build pizza-only Supabase commands for taco reviewed-new rows', () => {
    expect(reviewedNewSyncCommands([
      { place_id: 101 },
    ], { entity: 'taco' })).toEqual({
      unsupported: true,
      reason: 'Reviewed-new Supabase publish handoff is currently implemented for pizza_places only.',
    })
  })
})

describe('reviewedNewEnrichmentCommands', () => {
  test('builds exact per-id scrape and classify queue commands for imported rows', () => {
    expect(reviewedNewEnrichmentCommands([
      { place_id: 182004, google_place_id: 'all_the_places:j9TcUvNvyMX49HDgmdYs3rj-2K8=' },
      { place_id: '182005', google_place_id: 'all_the_places:abc' },
      { place_id: 182004, google_place_id: 'all_the_places:duplicate' },
    ])).toEqual({
      ids: [182004, 182005],
      scrape: [
        'node scripts/enrichment/populate-scrape-from-db.mjs --type pizza --ids 182004,182005 --id-prefix all_the_places: --priority-boost 100000 --limit 2',
      ],
      classify: [
        "node scripts/enrichment/populate-classify-from-db.mjs --type pizza --state '*' --ids 182004,182005 --id-prefix all_the_places: --priority-boost 100000 --limit 2",
      ],
      deterministic: {
        dryRun: 'node scripts/ops/apply-deterministic-classification.mjs --ids 182004,182005 --id-prefix all_the_places:',
        apply: 'node scripts/ops/apply-deterministic-classification.mjs --ids 182004,182005 --id-prefix all_the_places: --apply',
      },
    })
  })

  test('returns null when no imported canonical ids are present for enrichment', () => {
    expect(reviewedNewEnrichmentCommands([{ review_id: 1 }, { place_id: 'not-a-number' }])).toBeNull()
  })

  test('builds only supported taco enrichment handoffs for taco reviewed-new rows', () => {
    expect(reviewedNewEnrichmentCommands([
      { place_id: 91 },
      { place_id: 92 },
    ], { entity: 'taco' })).toEqual({
      ids: [91, 92],
      scrape: [
        'node scripts/enrichment/populate-scrape-from-db.mjs --type taco --ids 91,92 --id-prefix all_the_places: --priority-boost 100000 --limit 2',
      ],
      unsupported: {
        classify: 'populate-classify-from-db.mjs currently rejects non-pizza datasets.',
        deterministic: 'apply-deterministic-classification.mjs is currently pizza_places only.',
      },
    })
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
      'node scripts/ops/export-reviewed-source-candidates.mjs --entity pizza --status pending --kind ambiguous --output reports/source-review-dominos_pizza_us-ambiguous-link_review-pending.csv --source all_the_places --report-file dominos_pizza_us-review.json --readiness link_review'
    )
  })

  test('keeps candidate-ready likely-new exports scoped to the current readiness bucket', () => {
    expect(reviewQueueExportCommand({
      source: 'all_the_places',
      reportFile: 'pizza_hut_us-review.json',
      kind: 'likely_new',
      status: 'pending',
      readiness: 'candidate_ready',
    }, { entity: 'pizza' })).toBe(
      'node scripts/ops/export-reviewed-source-candidates.mjs --entity pizza --status pending --kind likely_new --output reports/source-review-pizza_hut_us-likely_new-candidate_ready-pending.csv --source all_the_places --report-file pizza_hut_us-review.json --readiness candidate_ready'
    )
  })

  test('builds an all-kind export command for the default filtered queue', () => {
    expect(reviewQueueExportCommand({
      status: 'pending',
    }, { entity: 'pizza' })).toBe(
      'node scripts/ops/export-reviewed-source-candidates.mjs --entity pizza --status pending --kind all --output reports/source-review-queue-pending.csv'
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

  test('includes current queue search text in generated export commands', () => {
    expect(reviewQueueExportCommand({
      status: 'pending',
      kind: 'ambiguous',
      search: "Buddy's Detroit",
    }, { entity: 'pizza' })).toContain("--search 'Buddy'\\''s Detroit'")
  })

  test('builds exact selected-row review queue exports by id', () => {
    expect(reviewQueueExportCommand({
      status: 'pending',
      kind: 'likely_new',
      ids: ['101', 102, 'bad', 101],
    }, { entity: 'pizza' })).toBe(
      'node scripts/ops/export-reviewed-source-candidates.mjs --entity pizza --status pending --kind likely_new --output reports/source-review-selected-2-likely_new-pending.csv --ids 101,102'
    )
  })
})

describe('selectedReviewEligibilitySummary', () => {
  test('summarizes mixed pending review selections before bulk action', () => {
    expect(selectedReviewEligibilitySummary([
      { id: 1, status: 'pending', review_kind: 'likely_new' },
      { id: 2, status: 'pending', review_kind: 'ambiguous', nearest_place_id: 10 },
      { id: 3, status: 'pending', review_kind: 'ambiguous' },
      { id: 4, status: 'accepted', review_kind: 'likely_new' },
      { id: 5, status: 'linked', review_kind: 'likely_new' },
    ], [1, 2, 3, 4, 5])).toEqual({
      selected: 5,
      pendingLikelyNew: 1,
      pendingAmbiguous: 2,
      linkableAmbiguous: 1,
      acceptedLikelyNew: 1,
      rejectablePending: 3,
      alreadyLinked: 1,
      ineligible: 2,
      text: '1 can be accepted as likely-new · 1 can be linked to nearest canonical · 1 can be imported locally · 3 can be rejected or ignored · 1 already linked · 2 not eligible for the primary action',
    })
  })

  test('explains when selected ids are not visible on the current page', () => {
    expect(selectedReviewEligibilitySummary([
      { id: 1, status: 'pending', review_kind: 'likely_new' },
    ], [99])).toMatchObject({
      selected: 0,
      text: 'No eligible selected rows in the current page',
    })
  })
})
