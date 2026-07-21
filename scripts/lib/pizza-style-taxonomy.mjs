import { readFileSync } from 'node:fs'

const taxonomy = JSON.parse(readFileSync(new URL('../../config/pizza-style-taxonomy.json', import.meta.url), 'utf8'))

export const PIZZA_STYLES = Object.freeze([...taxonomy.styles])
export const LEGACY_PIZZA_STYLE_ALIASES = Object.freeze({ ...taxonomy.legacy_aliases })

export function normalizePizzaStyle(value) {
  if (!value) return null
  const style = String(value).trim()
  return PIZZA_STYLES.includes(style) ? style : LEGACY_PIZZA_STYLE_ALIASES[style] || null
}
