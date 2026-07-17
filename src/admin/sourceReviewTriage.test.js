import {
  brandMatchState,
  buildReviewWorklist,
  canonicalContextLines,
  decisionCanonicalContextLines,
  reviewDecisionChecklist,
  reviewActionCopy,
  reviewBucketPlan,
  reviewBucketPriority,
  reviewLifecycleCopy,
  reviewQueuePressureSummary,
  reviewRecommendation,
} from './sourceReviewTriage'

describe('source review triage helpers', () => {
  test('treats close Domino typo rows as brand links', () => {
    const row = {
      review_kind: 'ambiguous',
      report_file: 'dominos_pizza_us-review.json',
      nearest_place_name: "Domoino's",
      nearest_distance_m: '2.1',
      nearest_name_score: '0',
    }

    expect(brandMatchState(row)).toEqual({
      label: "Domino's",
      matchesNearest: true,
    })
    expect(reviewRecommendation(row).label).toBe('Brand link')
  })

  test('flags close cross-brand ambiguous rows as brand conflicts', () => {
    const row = {
      review_kind: 'ambiguous',
      report_file: 'dominos_pizza_us-review.json',
      nearest_place_name: 'Pizza Hut',
      nearest_distance_m: '0.5',
      nearest_name_score: '0',
    }

    const recommendation = reviewRecommendation(row)

    expect(brandMatchState(row)).toEqual({
      label: "Domino's",
      matchesNearest: false,
    })
    expect(recommendation.label).toBe('Brand conflict')
    expect(recommendation.detail).toContain('Do not bulk-link')
  })

  test('routes likely-new nearby-canonical rows into duplicate comparison', () => {
    const action = reviewActionCopy({
      review_kind: 'likely_new',
      status: 'pending',
      readiness: 'nearby_canonical_review',
    })

    expect(action.title).toBe('Compare likely-new duplicates')
    expect(action.filter).toEqual({
      kind: 'likely_new',
      status: 'pending',
      readiness: 'nearby_canonical_review',
    })
  })

  test('gives ambiguous rows a same-place checklist before linking', () => {
    expect(reviewDecisionChecklist({
      review_kind: 'ambiguous',
      status: 'pending',
      source_name: 'Pizza Hut',
      source_id: 'source-1',
      nearest_place_id: 123,
      source_data: { lat: 42.1, lng: -83.1 },
    })).toEqual([
      'Confirm the source identity matches the canonical row.',
      'Compare source coordinates and nearest canonical coordinates.',
      'Link only when this is the same place; otherwise reject, ignore, or review as likely-new.',
    ])
  })

  test('makes likely-new candidate-ready rows preflight-first', () => {
    expect(reviewDecisionChecklist({
      review_kind: 'likely_new',
      status: 'pending',
      review_readiness: 'candidate_ready',
      source_name: 'New Pizza Hut',
      source_id: 'source-2',
      source_data: { latitude: 42.1, longitude: -83.1 },
    })).toEqual([
      'Confirm source coordinates look plausible.',
      'Accept only stages the row for import preflight; it does not create a place.',
      'Run import preflight before local canonical insertion.',
    ])
  })

  test('warns likely-new nearby canonical rows to resolve duplicates first', () => {
    expect(reviewDecisionChecklist({
      review_kind: 'likely_new',
      status: 'pending',
      review_readiness: 'nearby_canonical_review',
    })).toEqual([
      'Compare the nearby canonical row before accepting this as new.',
      'Link if it is the same place; reject or ignore if the source is stale or unusable.',
      'Use Accept only after duplicate risk is resolved.',
    ])
  })

  test('prioritizes ambiguous source buckets before likely-new review', () => {
    const bucket = {
      source: 'all_the_places',
      reportFile: 'dominos_pizza_us-review.json',
      ambiguous: 33,
      likelyNew: 2416,
    }

    expect(reviewBucketPlan(bucket)).toMatchObject({
      title: 'Resolve ambiguous links',
      rows: 33,
      filter: {
        kind: 'ambiguous',
        status: 'pending',
        readiness: 'link_review',
      },
    })
    expect(reviewBucketPriority(bucket)).toBe(1000033)
    expect(reviewBucketPriority({ ambiguous: 0, likelyNew: 3535 })).toBe(3535)
  })

  test('builds a tested review worklist from pending report counts', () => {
    const reportCounts = [
      {
        source: 'all_the_places',
        report_file: 'pizza_hut_us-review.json',
        review_kind: 'likely_new',
        status: 'pending',
        rows: 3535,
      },
      {
        source: 'all_the_places',
        report_file: 'dominos_pizza_us-review.json',
        review_kind: 'ambiguous',
        status: 'pending',
        rows: 33,
      },
      {
        source: 'all_the_places',
        report_file: 'dominos_pizza_us-review.json',
        review_kind: 'likely_new',
        status: 'pending',
        rows: 2296,
      },
      {
        source: 'all_the_places',
        report_file: 'old-review.json',
        review_kind: 'ambiguous',
        status: 'linked',
        rows: 500,
      },
    ]

    const worklist = buildReviewWorklist(reportCounts)

    expect(worklist[0]).toMatchObject({
      source: 'all_the_places',
      reportFile: 'dominos_pizza_us-review.json',
      ambiguous: 33,
      likelyNew: 2296,
      plan: {
        title: 'Resolve ambiguous links',
        rows: 33,
      },
    })
    expect(worklist[1]).toMatchObject({
      reportFile: 'pizza_hut_us-review.json',
      ambiguous: 0,
      likelyNew: 3535,
      plan: {
        title: 'Review likely-new candidates',
        rows: 3535,
      },
    })
  })

  test('summarizes the current review bottleneck for the admin panel', () => {
    const summary = reviewQueuePressureSummary([
      {
        source: 'all_the_places',
        report_file: 'pizza_hut_us-review.json',
        review_kind: 'likely_new',
        status: 'pending',
        rows: 3535,
      },
      {
        source: 'all_the_places',
        report_file: 'dominos_pizza_us-review.json',
        review_kind: 'ambiguous',
        status: 'pending',
        rows: 33,
      },
    ])

    expect(summary).toMatchObject({
      title: 'Resolve ambiguous links',
      rows: 33,
      filter: {
        reportFile: 'dominos_pizza_us-review.json',
        kind: 'ambiguous',
        status: 'pending',
        readiness: 'link_review',
      },
    })
    expect(summary.detail).toContain('dominos_pizza_us-review.json')
  })

  test('summarizes current canonical context for faster review decisions', () => {
    expect(canonicalContextLines({
      nearest_place_id: 123,
      nearest_place_name: 'Pizza Hut',
      nearest_state: 'MI',
      nearest_address: '123 Main St',
      nearest_lat: '42.3314',
      nearest_lng: '-83.0458',
      nearest_status: 'unvisited',
      nearest_phone: '313-555-0100',
      nearest_website_url: 'https://example.com',
    })).toEqual([
      'Pizza Hut · MI',
      '123 Main St',
      '42.331400, -83.045800',
      'status unvisited · phone present · website present',
    ])
  })

  test('handles review rows without nearby canonical context', () => {
    expect(canonicalContextLines({})).toEqual(['No nearby canonical row'])
  })

  test('makes accepted likely-new rows explicit review metadata, not imported places', () => {
    const copy = reviewLifecycleCopy({
      review_kind: 'likely_new',
      status: 'accepted',
    })

    expect(copy.label).toBe('Accepted for preflight')
    expect(copy.detail).toContain('No canonical place exists until preflight imports it')
  })

  test('summarizes the actual linked or imported canonical destination', () => {
    expect(decisionCanonicalContextLines({
      canonical_place_id: 987,
      decision_canonical_name: 'Imported Pizza',
      decision_canonical_state: 'MI',
      decision_canonical_address: '456 State St',
      decision_canonical_lat: 42.28,
      decision_canonical_lng: -83.74,
      decision_canonical_status: 'unvisited',
    })).toEqual([
      'Imported Pizza · MI',
      '456 State St',
      '42.280000, -83.740000',
      'status unvisited',
    ])

    expect(reviewLifecycleCopy({
      review_kind: 'likely_new',
      status: 'linked',
      canonical_place_id: 987,
    })).toMatchObject({
      label: 'Linked to canonical 987',
      tone: '#22c55e',
    })
  })
})
