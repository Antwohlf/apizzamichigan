/**
 * Chains to exclude from taco imports
 * These serve burritos/bowls but not traditional tacos
 *
 * NOTE: Taco Bell is NOT excluded - they serve tacos
 */
export const EXCLUDED_TACO_CHAINS = [
  // Fast casual chains (burrito/bowl-focused)
  'chipotle',
  'chipotle mexican grill',
  'qdoba',
  'qdoba mexican eats',
  'qdoba mexican grill',
  "moe's southwest grill",
  "moe's",
  'cafe rio',
  'cafe rio mexican grill',
  'freebirds',
  'freebirds world burrito',
  'pancheros',
  'pancheros mexican grill',
  "willy's mexicana grill",
  'barberitos',
  'dos toros',
  'dos toros taqueria',

  // Other burrito/bowl focused chains
  'baja fresh',
  'baja fresh mexican grill',
  // NOTE: Rubio's serves fish tacos - NOT excluded
  'costa vida',
  'costa vida fresh mexican',
  'california tortilla',
  'boloco',
  'illegal pete\'s',
]

/**
 * Normalize name for comparison
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if a place should be excluded from taco imports
 * @param {string} name - Place name to check
 * @param {string} [brand] - Optional brand tag from OSM
 * @returns {boolean} True if the place should be excluded
 */
export function isExcludedTacoChain(name, brand = '') {
  const normalizedName = normalizeName(name)
  const normalizedBrand = normalizeName(brand)

  for (const chain of EXCLUDED_TACO_CHAINS) {
    const normalizedChain = normalizeName(chain)

    // Check name
    if (
      normalizedName === normalizedChain ||
      normalizedName.startsWith(normalizedChain + ' ') ||
      normalizedName.endsWith(' ' + normalizedChain) ||
      normalizedName.includes(normalizedChain)
    ) {
      return true
    }

    // Check brand tag
    if (
      normalizedBrand &&
      (normalizedBrand === normalizedChain ||
        normalizedBrand.includes(normalizedChain))
    ) {
      return true
    }
  }

  return false
}
