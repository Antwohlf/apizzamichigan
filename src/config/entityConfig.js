import { ThemeKeys } from '../themes/siteTheme'
import { pizzaStyles, normalizePizzaStyle } from '../data/pizzaStyles'
import { TACO_TYPES } from '../data/tacoTypes'

export const ENTITY_CONFIG = Object.freeze({
  pizza: Object.freeze({
    entity: 'pizza',
    themeKey: ThemeKeys.PIZZA,
    table: 'pizza_places',
    frozenTable: 'frozen_pizzas',
    publicRoute: '/',
    placeRoute: '/places',
    defaultPlaceType: 'pizzeria',
    styleOptions: Object.freeze([...pizzaStyles]),
    editorial: Object.freeze({
      picks: Object.freeze({
        minimumRating: 8,
        label: "Anthony's Picks",
      }),
    }),
  }),
  taco: Object.freeze({
    entity: 'taco',
    themeKey: ThemeKeys.TACO,
    table: 'taco_places',
    frozenTable: 'frozen_tacos',
    publicRoute: '/tacos',
    placeRoute: '/tacos/places',
    defaultPlaceType: 'taqueria',
    styleOptions: Object.freeze([...TACO_TYPES]),
    editorial: Object.freeze({
      picks: Object.freeze({
        minimumRating: 8,
        label: "Anthony's Picks",
      }),
    }),
  }),
})

export function entityConfig(entity) {
  return ENTITY_CONFIG[entity] || ENTITY_CONFIG.pizza
}

export function entityConfigForTheme(themeKey) {
  return Object.values(ENTITY_CONFIG).find(config => config.themeKey === themeKey) || ENTITY_CONFIG.pizza
}

export function normalizeEntityStyle(entity, value) {
  const config = entityConfig(entity)
  if (config.entity === 'pizza') {
    const rawValue = String(value || '').trim()
    if (!rawValue) return null
    return normalizePizzaStyle(rawValue)
  }
  return String(value || '').trim() || null
}
