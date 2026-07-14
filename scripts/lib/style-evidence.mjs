export const STYLE_EVIDENCE = {
  Detroit: ['detroit'],
  Chicago: ['chicago', 'deep dish', 'deep-dish', 'stuffed'],
  'New York': ['new york', 'ny style', 'ny-style', 'brooklyn'],
  Neapolitan: ['neapolitan', 'wood fired', 'wood-fired', 'brick oven', 'coal fired', 'napoletana', 'napoli'],
  Sicilian: ['sicilian', 'grandma'],
  Roman: ['roman', 'al taglio', 'taglio'],
  Tavern: ['tavern', 'party cut', 'thin crust', 'square cut'],
  California: ['california'],
  Traditional: ['pizza', 'pizzeria', 'pizzaria', 'pizzería', 'pizzas', 'domino', 'pizza hut', 'papa john', 'little caesars', 'sbarro']
}

export const PIZZA_SIGNAL_TERMS = [
  'pizza',
  'pizzeria',
  'pizzaria',
  'pizzería',
  'pizzas',
  'pizz',
  'slice',
  'slices',
  'pie',
  'cuisine":"pizza',
  'cuisine:pizza',
  'italian'
]

export function toEvidenceText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function evidenceText(row) {
  return [
    row.name,
    row.website_url,
    toEvidenceText(row.osm_tags),
    toEvidenceText(row.scrape_notes)
  ].filter(Boolean).join(' ').toLowerCase()
}

export function hasAnyEvidence(text, terms) {
  return terms.some(term => text.includes(term))
}

export function hasStyleEvidence(row, style = row.style) {
  if (!style) return true
  const terms = STYLE_EVIDENCE[style] || []
  return terms.length ? hasAnyEvidence(evidenceText(row), terms) : false
}

export function hasPizzaSignal(row) {
  return hasAnyEvidence(evidenceText(row), PIZZA_SIGNAL_TERMS)
}
