/**
 * Style and price inference from restaurant names
 */

// Chain name to style mappings
const CHAIN_STYLE_MAP = {
  // Detroit Style (square, thick, crispy edges)
  "buddy's": 'Detroit',
  "buddy's pizza": 'Detroit',
  "shield's": 'Detroit',
  "shields pizza": 'Detroit',
  "jet's": 'Detroit',
  "jets": 'Detroit',
  "jets pizza": 'Detroit',
  "loui's": 'Detroit',
  "louis pizza": 'Detroit',
  "cloverleaf": 'Detroit',
  "michigan & trumbull": 'Detroit',
  "supino": 'Detroit',
  "via 313": 'Detroit',
  "blue pan": 'Detroit',

  // Chicago Style (deep dish)
  "lou malnati's": 'Chicago',
  "lou malnatis": 'Chicago',
  "giordano's": 'Chicago',
  "giordanos": 'Chicago',
  "pequod's": 'Chicago',
  "pequods": 'Chicago',
  "gino's east": 'Chicago',
  "ginos east": 'Chicago',
  "chicago's pizza": 'Chicago',
  "chicago pizza": 'Chicago',
  "uno pizzeria": 'Chicago',
  "due pizzeria": 'Chicago',

  // National Chains (Traditional)
  "little caesars": 'Traditional',
  "little caesar's": 'Traditional',
  "domino's": 'Traditional',
  "dominos": 'Traditional',
  "pizza hut": 'Traditional',
  "papa john's": 'Traditional',
  "papa johns": 'Traditional',
  "marco's": 'Traditional',
  "marcos pizza": 'Traditional',
  "hungry howie's": 'Traditional',
  "hungry howies": 'Traditional',
  "papa murphy's": 'Traditional',
  "papa murphys": 'Traditional',
  "papa romano's": 'Traditional',
  "papa romanos": 'Traditional',
  "b.c. pizza": 'Traditional',
  "bc pizza": 'Traditional',
  "best choice pizza": 'Traditional',
  "chuck e. cheese": 'Traditional',
  "chuck e cheese": 'Traditional',
  "cici's": 'Traditional',
  "cicis pizza": 'Traditional',
  "sbarro": 'New York',
  "godfather's": 'Traditional',
  "godfathers pizza": 'Traditional',
  "fox's pizza": 'Traditional',
  "foxs pizza": 'Traditional',
  "round table": 'Traditional',
  "simple simon's": 'Traditional',
  "simple simons": 'Traditional',
  "simple simon's pizza": 'Traditional',
  "simple simons pizza": 'Traditional',
  "mountain mike's": 'Traditional',
  "pizza ranch": 'Traditional',
  "toppers pizza": 'Traditional',
  "donatos": 'Traditional',
  "mod pizza": 'Traditional',
  "blaze pizza": 'Traditional',
  "pieology": 'Traditional',
  "your pie": 'Traditional',
  "&pizza": 'Traditional',
  "larosa's": 'Traditional',
  "larosas": 'Traditional',
  "larosa's pizzeria": 'Traditional',
  "larosas pizzeria": 'Traditional',
  "sal's pizza": 'Traditional',
  "sals pizza": 'Traditional',

  // Michigan regional chains
  "cottage inn": 'Traditional',
  "mancino's": 'Traditional',
  "mancinos": 'Traditional',
  "pizza house": 'Traditional',
  "backroom pizza": 'Traditional',
  "toarmina's": 'Traditional',
  "toarminas": 'Traditional',
}

// Keywords that suggest specific styles
const STYLE_KEYWORDS = {
  // Detroit
  'detroit': 'Detroit',
  'detroit style': 'Detroit',
  'detroit-style': 'Detroit',
  'square pan': 'Detroit',

  // Chicago
  'chicago': 'Chicago',
  'deep dish': 'Chicago',
  'deep-dish': 'Chicago',
  'stuffed pizza': 'Chicago',

  // New York
  'new york': 'New York',
  'ny style': 'New York',
  'ny-style': 'New York',
  'brooklyn': 'New York',
  'slice house': 'New York',
  'slice shop': 'New York',

  // Neapolitan
  'neapolitan': 'Neapolitan',
  'napoletana': 'Neapolitan',
  'napoli': 'Neapolitan',
  'wood fired': 'Neapolitan',
  'wood-fired': 'Neapolitan',
  'brick oven': 'Neapolitan',
  'coal fired': 'Neapolitan',
  'forno': 'Neapolitan',
  'vera pizza': 'Neapolitan',
  'margherita': 'Neapolitan',

  // Sicilian
  'sicilian': 'Sicilian',
  'sicily': 'Sicilian',
  'grandma style': 'Sicilian',
  'grandma pizza': 'Sicilian',

  // Roman
  'roman': 'Roman',
  'al taglio': 'Roman',
  'pizza al taglio': 'Roman',

  // Tavern (Chicago thin)
  'tavern': 'Tavern',
  'tavern style': 'Tavern',
  'party cut': 'Tavern',
  'square cut': 'Tavern',
}

// Chain name to price mappings
const CHAIN_PRICE_MAP = {
  // Budget ($)
  "little caesars": '$',
  "little caesar's": '$',
  "domino's": '$',
  "dominos": '$',
  "hungry howie's": '$',
  "hungry howies": '$',
  "cici's": '$',
  "cicis pizza": '$',
  "papa murphy's": '$',
  "b.c. pizza": '$$',
  "bc pizza": '$$',
  "best choice pizza": '$$',

  // Moderate ($$)
  "pizza hut": '$$',
  "papa john's": '$$',
  "papa johns": '$$',
  "fox's pizza": '$$',
  "foxs pizza": '$$',
  "pizza ranch": '$$',
  "round table": '$$',
  "round table pizza": '$$',
  "simple simon's": '$$',
  "simple simons": '$$',
  "simple simon's pizza": '$$',
  "simple simons pizza": '$$',
  "jet's": '$$',
  "jets": '$$',
  "jets pizza": '$$',
  "buddy's": '$$',
  "buddy's pizza": '$$',
  "blaze pizza": '$$',
  "mod pizza": '$$',
  "marco's": '$$',
  "marcos pizza": '$$',
  "cottage inn": '$$',
  "mancino's": '$$',
  "sbarro": '$$',
  "chuck e. cheese": '$$',
  "toppers pizza": '$$',
  "donatos": '$$',
  "pieology": '$$',
  "&pizza": '$$',
  "larosa's": '$$',
  "larosas": '$$',
  "larosa's pizzeria": '$$',
  "larosas pizzeria": '$$',
  "sal's pizza": '$$',
  "sals pizza": '$$',
  "shield's": '$$',
  "toarmina's": '$$',

  // Expensive ($$$)
  "lou malnati's": '$$$',
  "giordano's": '$$$',
  "uno pizzeria": '$$$',
}

/**
 * Normalize restaurant name for matching
 */
function normalizeName(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Infer pizza style from restaurant name
 */
export function inferStyleFromName(name, address = '') {
  const normalized = normalizeName(name)
  const normalizedAddress = normalizeName(address)

  // Check exact chain matches first
  for (const [chain, style] of Object.entries(CHAIN_STYLE_MAP)) {
    if (normalized === chain || normalized.startsWith(chain + ' ') || normalized.includes(chain)) {
      return {
        style,
        confidence: 'high',
        source: 'chain_map',
        match: chain,
      }
    }
  }

  // Check style keywords in name
  for (const [keyword, style] of Object.entries(STYLE_KEYWORDS)) {
    if (normalized.includes(keyword)) {
      return {
        style,
        confidence: 'medium',
        source: 'keyword',
        match: keyword,
      }
    }
  }

  // Check style keywords in address (less confident)
  for (const [keyword, style] of Object.entries(STYLE_KEYWORDS)) {
    if (normalizedAddress.includes(keyword)) {
      return {
        style,
        confidence: 'low',
        source: 'address_keyword',
        match: keyword,
      }
    }
  }

  // No match found
  return {
    style: null,
    confidence: null,
    source: null,
    match: null,
  }
}

/**
 * Infer price from chain name
 */
export function inferPriceFromChain(name) {
  const normalized = normalizeName(name)

  for (const [chain, price] of Object.entries(CHAIN_PRICE_MAP)) {
    if (normalized === chain || normalized.startsWith(chain + ' ') || normalized.includes(chain)) {
      return {
        price,
        confidence: 'high',
        source: 'chain_map',
        match: chain,
      }
    }
  }

  return {
    price: null,
    confidence: null,
    source: null,
    match: null,
  }
}

/**
 * Check if name matches a known chain
 */
export function isKnownChain(name) {
  const normalized = normalizeName(name)
  const allChains = new Set([
    ...Object.keys(CHAIN_STYLE_MAP),
    ...Object.keys(CHAIN_PRICE_MAP),
  ])

  for (const chain of allChains) {
    if (normalized.includes(chain)) {
      return true
    }
  }
  return false
}

/**
 * Infer style from Yelp categories
 */
export function inferStyleFromCategories(categories = []) {
  const categoryStr = categories.join(' ').toLowerCase()

  if (categoryStr.includes('detroit')) return { style: 'Detroit', confidence: 'medium', source: 'yelp_category' }
  if (categoryStr.includes('chicago') || categoryStr.includes('deep dish')) return { style: 'Chicago', confidence: 'medium', source: 'yelp_category' }
  if (categoryStr.includes('neapolitan') || categoryStr.includes('wood-fired')) return { style: 'Neapolitan', confidence: 'medium', source: 'yelp_category' }
  if (categoryStr.includes('new york') || categoryStr.includes('ny style')) return { style: 'New York', confidence: 'medium', source: 'yelp_category' }
  if (categoryStr.includes('sicilian')) return { style: 'Sicilian', confidence: 'medium', source: 'yelp_category' }

  return { style: null, confidence: null, source: null }
}
