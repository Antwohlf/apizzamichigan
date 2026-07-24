import { pizzaTheme } from './pizzaTheme'
import { tacoTheme } from './tacoTheme'

describe('theme map loading priorities', () => {
  test.each([
    ['pizza', pizzaTheme],
    ['taco', tacoTheme],
  ])('%s prioritizes the configured Michigan and New York markets', (_name, theme) => {
    expect(theme.search.initialStates).toEqual(['MI', 'NY'])
    expect(theme.search.publicStates).toEqual(['MI', 'NY'])
    expect(theme.search.initialStates).toEqual(expect.arrayContaining(theme.search.preferredStates))
    expect(theme.map.primaryView.center).toHaveLength(2)
    expect(theme.map.primaryView.zoom).toBeGreaterThan(0)
  })
})
