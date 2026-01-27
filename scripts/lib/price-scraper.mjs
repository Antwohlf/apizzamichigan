/**
 * Price scraping from Yelp
 */

import * as cheerio from 'cheerio'

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
]

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Build Yelp search URL
 */
function buildYelpSearchUrl(name, city) {
  const query = encodeURIComponent(name)
  const location = encodeURIComponent(`${city}, MI`)
  return `https://www.yelp.com/search?find_desc=${query}&find_loc=${location}`
}

/**
 * Extract price level from Yelp HTML
 * Returns: '$', '$$', '$$$', '$$$$', or null
 */
function extractPriceFromHtml(html) {
  const $ = cheerio.load(html)

  // Look for price indicator patterns
  // Yelp shows price as spans with $ symbols
  const pricePatterns = ['$$$$', '$$$', '$$', '$']

  // Search in various possible locations
  const textContent = $('body').text()

  // Look for price range indicators near "Price range" text
  const priceRangeMatch = textContent.match(/\$\$\$\$|\$\$\$|\$\$/g)
  if (priceRangeMatch && priceRangeMatch.length > 0) {
    // Return the most common price found (usually the first result card)
    return priceRangeMatch[0]
  }

  // Look for aria-label with price info
  const priceElements = $('[aria-label*="price"]').text()
  for (const pattern of pricePatterns) {
    if (priceElements.includes(pattern)) {
      return pattern
    }
  }

  return null
}

/**
 * Extract categories from Yelp HTML
 */
function extractCategoriesFromHtml(html) {
  const $ = cheerio.load(html)
  const categories = []

  // Look for category links
  $('a[href*="/c/"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text.length < 50) {
      categories.push(text.toLowerCase())
    }
  })

  // Also look for category spans
  $('span').each((_, el) => {
    const text = $(el).text().trim().toLowerCase()
    if (text.includes('pizza') || text.includes('italian') ||
        text.includes('detroit') || text.includes('neapolitan') ||
        text.includes('chicago') || text.includes('new york')) {
      categories.push(text)
    }
  })

  return [...new Set(categories)]
}

/**
 * Scrape Yelp for price and category info
 */
export async function scrapeYelpPrice(name, city, rateLimiter) {
  const url = buildYelpSearchUrl(name, city)

  try {
    await rateLimiter.throttle()

    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    })

    if (response.status === 429) {
      rateLimiter.reportError(429)
      return {
        found: false,
        error: 'Rate limited',
        price: null,
        categories: [],
      }
    }

    if (response.status === 403) {
      rateLimiter.reportError(403)
      return {
        found: false,
        error: 'Forbidden (possible bot detection)',
        price: null,
        categories: [],
      }
    }

    if (!response.ok) {
      rateLimiter.reportError(response.status)
      return {
        found: false,
        error: `HTTP ${response.status}`,
        price: null,
        categories: [],
      }
    }

    rateLimiter.reportSuccess()

    const html = await response.text()
    const price = extractPriceFromHtml(html)
    const categories = extractCategoriesFromHtml(html)

    return {
      found: true,
      price,
      categories,
      source: 'yelp',
    }
  } catch (error) {
    rateLimiter.reportError(500)
    return {
      found: false,
      error: error.message,
      price: null,
      categories: [],
    }
  }
}

/**
 * Extract city from address string
 */
export function extractCity(address) {
  if (!address) return 'Michigan'

  // Common pattern: "123 Main St, City, MI 12345"
  const parts = address.split(',').map(p => p.trim())

  if (parts.length >= 2) {
    // Get the part before the state
    const cityPart = parts[parts.length - 2] || parts[parts.length - 1]
    // Remove state/zip if present
    const city = cityPart.replace(/\s*(MI|Michigan)\s*\d*/gi, '').trim()
    if (city && city.length > 0) {
      return city
    }
  }

  return 'Michigan'
}
