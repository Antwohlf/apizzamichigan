import { filterPublicAggregates } from './publicScope'

const aggregates = [
  { stateCode: 'MI', count: 10 },
  { stateCode: 'NY', count: 20 },
  { stateCode: 'CA', count: 30 },
]

describe('public map scope', () => {
  test('keeps only configured primary markets by default', () => {
    expect(filterPublicAggregates(aggregates, { primaryStates: ['MI', 'NY'] }))
      .toEqual(aggregates.slice(0, 2))
  })

  test('reveals all markets when expanded', () => {
    expect(filterPublicAggregates(aggregates, { showAll: true, primaryStates: ['MI', 'NY'] }))
      .toEqual(aggregates)
  })

  test('does not hide data when no scope is configured', () => {
    expect(filterPublicAggregates(aggregates)).toEqual(aggregates)
  })
})
