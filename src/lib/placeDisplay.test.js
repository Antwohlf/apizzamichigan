import { placeLocation, placePrice, placeRating } from './placeDisplay'

describe('place display helpers', () => {
  test('accepts each supported price field', () => {
    expect(placePrice({ price_range: '$$$' })).toBe('$$$')
    expect(placePrice({ priceRange: '$$' })).toBe('$$')
    expect(placePrice({ price: '$' })).toBe('$')
  })

  test('only displays positive numeric ratings', () => {
    expect(placeRating({ rating: '8.5' })).toBe(8.5)
    expect(placeRating({ rating: 0 })).toBeNull()
    expect(placeRating({ rating: ' ' })).toBeNull()
  })

  test('builds a non-repeating location label', () => {
    expect(placeLocation({ address: 'Detroit', city: 'Detroit', state: 'MI' })).toBe('Detroit · MI')
  })
})
