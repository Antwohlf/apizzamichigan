import taxonomy from './pizza-style-taxonomy.generated'

export const pizzaStyles = Object.freeze([...taxonomy.styles])
const legacyAliases = Object.freeze({ ...taxonomy.legacy_aliases })
const specificityOrder = taxonomy.specificity_order
const normalizeToken = value => String(value || '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US')
const canonicalStyles = new Map(
  pizzaStyles.map(style => [normalizeToken(style), style]),
)
const styleLookup = new Map([
  ...canonicalStyles,
  ...Object.entries(legacyAliases).map(([alias, style]) => [normalizeToken(alias), style]),
])

export const normalizePizzaStyle = value => {
  const rawValue = String(value || '').trim()
  if (!rawValue) return null

  const values = rawValue
    .split(/[,;|]/)
    .map(part => styleLookup.get(normalizeToken(part)))
    .filter(Boolean)

  if (!values.length) return 'Unknown'
  return [...new Set(values)].sort((left, right) => specificityOrder.indexOf(left) - specificityOrder.indexOf(right))[0]
}
