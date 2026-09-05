import { pizzaTheme } from './pizzaTheme'
import { tacoTheme } from './tacoTheme'
import { US_STATE_CODES } from '../data/usStateCodes'

describe('theme map loading priorities', () => {
  test.each([
    ['pizza', pizzaTheme],
    ['taco', tacoTheme],
  ])('%s keeps Michigan and New York preferred without hiding other markets', (_name, theme) => {
    expect(theme.search.initialStates).toEqual(US_STATE_CODES)
    expect(theme.search.publicStates).toEqual([])
    expect(theme.search.preferredStates).toEqual(['MI', 'NY'])
    expect(theme.map.primaryView.center).toHaveLength(2)
    expect(theme.map.primaryView.zoom).toBeGreaterThan(0)
  })

  test('uses the working keyless map provider for both brand modes', () => {
    expect(pizzaTheme.map.tileUrl).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(tacoTheme.map.tileUrl).toBe(pizzaTheme.map.tileUrl)
    expect(pizzaTheme.map.attribution).toContain('OpenStreetMap')
    expect(tacoTheme.map.attribution).toBe(pizzaTheme.map.attribution)
    expect(pizzaTheme.map.maxZoom).toBe(19)
    expect(tacoTheme.map.maxZoom).toBe(19)
    expect(tacoTheme.titleRotation).toEqual(['#b92d27', '#8c6848', '#176a45'])
  })
})
