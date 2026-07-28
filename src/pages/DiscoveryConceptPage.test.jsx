import { conceptPlaces, conceptTacoPlaces, matchesConceptSearch, sortConceptPlaces } from './DiscoveryConceptPage'

describe('DiscoveryConceptPage search helpers', () => {
  test('builds the concept from reviewed Ann Arbor places', () => {
    expect(conceptPlaces.length).toBeGreaterThan(10)
    expect(conceptPlaces.every(place => place.address && Number.isFinite(Number(place.rating)))).toBe(true)
    expect(conceptPlaces.some(place => place.isPick)).toBe(true)
  })

  test('builds the taco concept from the shared taco data contract', () => {
    expect(conceptTacoPlaces).toHaveLength(3)
    expect(conceptTacoPlaces.every(place => place.id && place.lat && place.lng)).toBe(true)
    expect(conceptTacoPlaces.every(place => place.isPick)).toBe(true)
  })

  test('matches names, styles, addresses, and Anthony review notes', () => {
    const backRoom = conceptPlaces.find(place => place.name === 'Back Room Pizza')

    expect(matchesConceptSearch(backRoom, 'back room')).toBe(true)
    expect(matchesConceptSearch(backRoom, 'new york')).toBe(true)
    expect(matchesConceptSearch(backRoom, 'church ann arbor')).toBe(true)
    expect(matchesConceptSearch(backRoom, 'sober')).toBe(true)
    expect(matchesConceptSearch(backRoom, 'detroit deep dish')).toBe(false)
  })

  test('sorts the shared place list by rating, name, and price', () => {
    const sample = [
      { name: 'Zeta', rating: 8, price: '$$$' },
      { name: 'Alpha', rating: 9, price: '$' },
      { name: 'Beta', rating: 7, price: '$$' },
    ]

    expect(sortConceptPlaces(sample, 'rating').map(place => place.name)).toEqual(['Alpha', 'Zeta', 'Beta'])
    expect(sortConceptPlaces(sample, 'name').map(place => place.name)).toEqual(['Alpha', 'Beta', 'Zeta'])
    expect(sortConceptPlaces(sample, 'price').map(place => place.name)).toEqual(['Alpha', 'Beta', 'Zeta'])
  })
})
