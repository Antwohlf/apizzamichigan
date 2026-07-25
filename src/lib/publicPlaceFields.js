import publicFieldPolicy from '../config/public-fields.generated'

const PUBLIC_PIZZA_FIELDS = publicFieldPolicy.pizza.map
const PUBLIC_TACO_FIELDS = publicFieldPolicy.taco.map
const PUBLIC_TACO_LEGACY_FIELDS = publicFieldPolicy.taco.legacy_map
const PUBLIC_PIZZA_DETAIL_FIELDS = publicFieldPolicy.pizza.detail
const PUBLIC_PIZZA_LEGACY_FIELDS = publicFieldPolicy.pizza.legacy_map

// Keep direct place links usable while additive production migrations roll
// out. This preserves the useful contact fields without requesting the new
// lifecycle columns.
const PUBLIC_PIZZA_LEGACY_DETAIL_FIELDS = PUBLIC_PIZZA_LEGACY_FIELDS
const PUBLIC_TACO_DETAIL_FIELDS = publicFieldPolicy.taco.detail

export const publicPlaceFieldsForTable = table => (
  table === 'taco_places' ? PUBLIC_TACO_FIELDS : PUBLIC_PIZZA_FIELDS
)

export const publicPlaceSelectForTable = table => publicPlaceFieldsForTable(table).join(', ')

export const publicPlaceLegacySelectForTable = table => (
  table === 'taco_places' ? PUBLIC_TACO_LEGACY_FIELDS : PUBLIC_PIZZA_LEGACY_FIELDS
).join(', ')

export const publicPlaceSearchSelectForTable = table => publicPlaceSelectForTable(table)

export const publicPlaceDetailSelectForTable = table => (
  table === 'taco_places' ? PUBLIC_TACO_DETAIL_FIELDS : PUBLIC_PIZZA_DETAIL_FIELDS
).join(', ')

export const publicPlaceLegacyDetailSelectForTable = table => (
  table === 'taco_places' ? PUBLIC_TACO_LEGACY_FIELDS : PUBLIC_PIZZA_LEGACY_DETAIL_FIELDS
).join(', ')

export const publicPizzaPlaceSelect = publicPlaceSelectForTable('pizza_places')

export const publicPizzaPlaceDetailSelect = publicPlaceDetailSelectForTable('pizza_places')
