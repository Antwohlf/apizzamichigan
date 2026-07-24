import { readFileSync } from 'node:fs'

const taxonomy = JSON.parse(readFileSync(new URL('../../config/pizza-style-taxonomy.json', import.meta.url), 'utf8'))

export const PIZZA_STYLES = Object.freeze([...taxonomy.styles])
export const LEGACY_PIZZA_STYLE_ALIASES = Object.freeze({ ...taxonomy.legacy_aliases })

const specificityOrder = taxonomy.specificity_order

export function normalizePizzaStyle(value) {
  if (!value) return null
  const styles = String(value)
    .split(/[,;|]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => LEGACY_PIZZA_STYLE_ALIASES[part] || part)
    .filter(part => PIZZA_STYLES.includes(part))

  if (!styles.length) return null
  return [...new Set(styles)].sort((left, right) => specificityOrder.indexOf(left) - specificityOrder.indexOf(right))[0]
}
