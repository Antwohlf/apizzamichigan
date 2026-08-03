import { markerAssetFor, markerAssets, markerAssetsFor } from './markerAssets'

describe('marker assets', () => {
  test('keeps a distinct asset for every supported site and review state', () => {
    expect(markerAssets.pizza.visited).toContain('marker-pizza-colored')
    expect(markerAssets.pizza.unvisited).toContain('marker-pizza-grey')
    expect(markerAssets.pizza.golden).toContain('marker-pizza-gold')
    expect(markerAssets.taco.visited).toContain('marker-taco-colored')
    expect(markerAssets.taco.unvisited).toContain('marker-taco-grey')
    expect(markerAssets.taco.golden).toContain('marker-taco-gold')
  })

  test('uses unvisited assets for unknown statuses and pizza assets for an unknown site', () => {
    expect(markerAssetFor('taco', 'missing')).toBe(markerAssets.taco.unvisited)
    expect(markerAssetsFor('missing')).toBe(markerAssets.pizza)
  })
})
