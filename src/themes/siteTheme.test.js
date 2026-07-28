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

  test('keeps the map treatment aligned with each brand mode', () => {
    expect(pizzaTheme.map.tileUrl).toContain('/dark_all/')
    expect(tacoTheme.map.tileUrl).toContain('/light_all/')
    expect(tacoTheme.titleRotation).toEqual(['#b92d27', '#8c6848', '#176a45'])
  })
})
