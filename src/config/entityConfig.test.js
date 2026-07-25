import { ENTITY_CONFIG, entityConfig, entityConfigForTheme, normalizeEntityStyle } from './entityConfig'
import { ThemeKeys } from '../themes/siteTheme'

describe('entity configuration', () => {
  test('keeps public entity routes and tables together', () => {
    expect(entityConfig('pizza')).toMatchObject({
      table: 'pizza_places',
      frozenTable: 'frozen_pizzas',
      features: { frozenDirectory: true },
      frozenDirectoryTitle: 'Frozen Pizza Directory',
      frozenUnavailableMessage: 'Frozen pizza entries are coming soon.',
      loadingVariant: 'pizza',
      pageTitle: 'APizzaMichigan - Pizza Map',
      switchTo: { route: '/tacos', label: 'Check out TacoBoutMichigan' },
      publicRoute: '/',
      placeRoute: '/places',
      styleOptions: expect.arrayContaining(['Detroit', 'New York']),
      editorial: { picks: { minimumRating: 8, label: "Anthony's Picks" } },
    })
    expect(entityConfig('taco')).toMatchObject({
      table: 'taco_places',
      frozenTable: 'frozen_tacos',
      features: { frozenDirectory: false },
      frozenDirectoryTitle: 'Frozen Taco Directory',
      frozenUnavailableMessage: 'Taco recipes are coming soon.',
      loadingVariant: 'taco',
      pageTitle: 'TacoBoutMichigan - Taco Map',
      switchTo: { route: '/', label: 'Check out APizzaMichigan' },
      publicRoute: '/tacos',
      placeRoute: '/tacos/places',
      styleOptions: expect.arrayContaining(['Al Pastor', 'Birria']),
      editorial: { picks: { minimumRating: 8, label: "Anthony's Picks" } },
    })
  })

  test('resolves theme keys and falls back to pizza', () => {
    expect(entityConfigForTheme(ThemeKeys.TACO).entity).toBe('taco')
    expect(entityConfigForTheme('unknown').entity).toBe('pizza')
    expect(Object.keys(ENTITY_CONFIG)).toEqual(['pizza', 'taco'])
  })

  test('normalizes styles through the selected entity configuration', () => {
    expect(normalizeEntityStyle('pizza', 'Traditional')).toBe('Standard Round')
    expect(normalizeEntityStyle('taco', 'Birria')).toBe('Birria')
    expect(normalizeEntityStyle('taco', '')).toBeNull()
  })
})
