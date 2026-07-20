import {
  DEFAULT_SOURCE_REVIEW_QUEUE,
  canUpdateExactOsmPlace,
  canRecordBusinessReplacement,
  humanReadiness,
  isExactOsmIdentityMatch,
  sourceAddress,
  sourceLabel,
  sourceReviewQueue,
  valuesDiffer,
} from './sourceReviewQueues'

describe('sourceReviewQueues', () => {
  test('uses the match-existing queue as the safe default', () => {
    expect(sourceReviewQueue('unknown')).toBe(DEFAULT_SOURCE_REVIEW_QUEUE)
    expect(sourceReviewQueue('matches')).toMatchObject({
      kind: 'ambiguous',
      readiness: 'link_review',
    })
  })

  test('translates backend terms into human-facing labels', () => {
    expect(sourceLabel('all_the_places')).toBe('Official chain websites')
    expect(humanReadiness('nearby_canonical_review')).toBe('Possible duplicate')
  })

  test('normalizes source addresses and comparison values', () => {
    expect(sourceAddress({
      source_data: {
        address_line: '123 Main St',
        locality: 'Ann Arbor',
        region: 'MI',
      },
    })).toBe('123 Main St, Ann Arbor, MI')
    expect(valuesDiffer('123 Main Street', '123 Main Street')).toBe(false)
    expect(valuesDiffer('123 Main Street', '125 Main Street')).toBe(true)
  })

  test('offers in-place updates only for unreviewed exact OSM identities', () => {
    const row = {
      source: 'osm',
      source_id: 'osm:way/631308927',
      source_name: 'Replacement Pizza',
      nearest_current_google_place_id: 'osm:way/631308927',
      nearest_place_name: 'Canonical Pizza',
      nearest_status: 'unvisited',
      nearest_rating: null,
      nearest_notes: '',
    }

    expect(isExactOsmIdentityMatch(row)).toBe(true)
    expect(canUpdateExactOsmPlace(row)).toBe(true)
    expect(canUpdateExactOsmPlace({ ...row, nearest_status: 'visited' })).toBe(false)
    expect(canUpdateExactOsmPlace({ ...row, nearest_notes: 'Great old spot' })).toBe(false)
    expect(canUpdateExactOsmPlace({ ...row, nearest_lifecycle_status: 'closed' })).toBe(false)
    expect(canUpdateExactOsmPlace({ ...row, source_id: 'osm:way/631308927', source_name: 'Canonical Pizza', nearest_place_name: 'Canonical Pizza' })).toBe(false)
    expect(canRecordBusinessReplacement({ ...row, nearest_status: 'visited' })).toBe(true)
    expect(canRecordBusinessReplacement(row)).toBe(false)
  })
})
