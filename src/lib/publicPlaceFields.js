const PUBLIC_PLACE_BASE_FIELDS = [
  'id',
  'name',
  'lat',
  'lng',
  'address',
  'google_place_id',
  'state',
  'status',
  'style',
  'price',
  'rating',
]

const PUBLIC_PIZZA_FIELDS = [
  ...PUBLIC_PLACE_BASE_FIELDS,
  'website_url',
  'menu_url',
  'phone',
  'hours',
  'price_range',
  'brand',
  'operator',
  'lifecycle_status',
  'lifecycle_replaced_by_id',
]

// Taco has the same additive lifecycle contract as pizza. The legacy list is
// kept separate so older deployments can continue to downgrade cleanly when
// those columns are not present yet.
const PUBLIC_TACO_FIELDS = [
  ...PUBLIC_PLACE_BASE_FIELDS,
  'lifecycle_status',
  'lifecycle_replaced_by_id',
]

const PUBLIC_TACO_LEGACY_FIELDS = PUBLIC_PLACE_BASE_FIELDS

const PUBLIC_PIZZA_DETAIL_FIELDS = [
  ...PUBLIC_PLACE_BASE_FIELDS,
  'website_url',
  'menu_url',
  'phone',
  'hours',
  'price_range',
  'lifecycle_status',
  'lifecycle_replaced_by_id',
]

const PUBLIC_PIZZA_LEGACY_FIELDS = [
  ...PUBLIC_PLACE_BASE_FIELDS,
  'website_url',
  'phone',
  'price_range',
  'brand',
  'operator',
]

// Keep direct place links usable while additive production migrations roll
// out. This preserves the useful contact fields without requesting the new
// lifecycle columns.
const PUBLIC_PIZZA_LEGACY_DETAIL_FIELDS = PUBLIC_PIZZA_LEGACY_FIELDS
const PUBLIC_TACO_DETAIL_FIELDS = PUBLIC_TACO_FIELDS

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
