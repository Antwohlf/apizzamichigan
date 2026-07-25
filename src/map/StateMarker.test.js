import { statePlaceCoordinates } from './StateMarker'

describe('state drill-down coordinates', () => {
  test('keeps only mappable loaded places for the region refit', () => {
    expect(statePlaceCoordinates([
      { lat: 42.28, lng: -83.74 },
      { lat: null, lng: -83.75 },
      { lat: 42.31, lng: -83.72 },
      { lat: 42.3, lng: Number.NaN },
    ])).toEqual([
      [42.28, -83.74],
      [42.31, -83.72],
    ])
  })
})
