import taxonomy from './pizza-style-taxonomy.generated'

export const pizzaStyles = Object.freeze([...taxonomy.styles])
const legacyAliases = Object.freeze({ ...taxonomy.legacy_aliases })
const specificityOrder = taxonomy.specificity_order

export const normalizePizzaStyle = value => {
  const rawValue = String(value || '').trim()
  if (!rawValue) return null

  const values = rawValue
    .split(/[,;|]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => legacyAliases[part] || part)
    .filter(part => pizzaStyles.includes(part))

  if (!values.length) return 'Unknown'
  return [...new Set(values)].sort((left, right) => specificityOrder.indexOf(left) - specificityOrder.indexOf(right))[0]
}
