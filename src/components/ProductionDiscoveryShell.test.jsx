import { sortProductionPlaces } from './ProductionDiscoveryShell'

describe('sortProductionPlaces', () => {
  const places = [
    { id: 'a', name: 'Zeta', rating: 8, price_range: '$$' },
    { id: 'b', name: 'Alpha', rating: 9.5, price_range: '$' },
    { id: 'c', name: 'Beta', rating: null, price_range: '$$$' },
  ]

  test('sorts highest rated first while keeping unrated places last', () => {
    expect(sortProductionPlaces(places, 'rating').map(place => place.id)).toEqual(['b', 'a', 'c'])
  })

  test('sorts by name and price without mutating the source array', () => {
    expect(sortProductionPlaces(places, 'name').map(place => place.name)).toEqual(['Alpha', 'Beta', 'Zeta'])
    expect(sortProductionPlaces(places, 'price').map(place => place.id)).toEqual(['b', 'a', 'c'])
    expect(places.map(place => place.id)).toEqual(['a', 'b', 'c'])
  })
})
