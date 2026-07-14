#!/usr/bin/env node
/**
 * Website Scraper Worker
 *
 * Simple fetch-based website scraper. No Puppeteer initially - just plain fetch.
 * Runs 5 concurrent scrapers max.
 *
 * Usage:
 *   node scripts/enrichment/workers/website-scraper.mjs --type pizza --concurrency 5
 *   node scripts/enrichment/workers/website-scraper.mjs --type taco --dry-run
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATS_FILE = join(__dirname, '../../.enrichment-stats.json')

// User agent to avoid blocks
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Timeout for fetch requests
const FETCH_TIMEOUT_MS = 15000

// Max content length to process (10MB)
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024

/**
 * Fetch a website with timeout and error handling
 */
async function fetchWebsite(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      redirect: 'follow'
    })

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText}`,
        statusCode: response.status
      }
    }

    // Check content type
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return {
        success: false,
        error: `Non-HTML content type: ${contentType}`
      }
    }

    // Check content length
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_LENGTH) {
      return {
        success: false,
        error: `Content too large: ${contentLength} bytes`
      }
    }

    const html = await response.text()

    // Check if we got meaningful content
    if (html.length < 100) {
      return {
        success: false,
        error: 'Response too short (likely blocked or empty)'
      }
    }

    return {
      success: true,
      html,
      finalUrl: response.url,
      contentLength: html.length
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timeout' }
    }
    return { success: false, error: error.message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Extract basic info from HTML (without LLM)
 * This is a simple extraction - LLM will do deeper analysis
 */
function extractBasicInfo(html) {
  const info = {}

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) info.title = titleMatch[1].trim()

  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
  if (descMatch) info.description = descMatch[1].trim()

  // Look for phone patterns
  const phoneMatch = html.match(/(?:tel:|phone:|call\s*:?\s*)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/gi)
  if (phoneMatch) info.phones = [...new Set(phoneMatch)].slice(0, 5)

  // Look for address patterns (basic)
  const addressMatch = html.match(/\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)[\w\s,]*\d{5}/gi)
  if (addressMatch) info.addresses = [...new Set(addressMatch)].slice(0, 3)

  // Look for hours patterns
  const hoursMatch = html.match(/(?:hours|open)[\s\S]{0,200}?(?:am|pm|AM|PM)/gi)
  if (hoursMatch) info.hoursHints = hoursMatch.slice(0, 3)

  // Look for price indicators
  const priceMatch = html.match(/\$\d+(?:\.\d{2})?/g)
  if (priceMatch) {
    const prices = priceMatch.map(p => parseFloat(p.replace('$', '')))
    info.avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length
    info.priceCount = prices.length
  }

  // Look for style keywords (pizza)
  const styleKeywords = ['detroit', 'new york', 'chicago', 'neapolitan', 'sicilian', 'tavern', 'roman', 'california', 'deep dish', 'thin crust', 'pan pizza']
  const foundStyles = styleKeywords.filter(style =>
    html.toLowerCase().includes(style.toLowerCase())
  )
  if (foundStyles.length) info.styleHints = foundStyles

  // Look for taco type keywords
  const tacoKeywords = ['al pastor', 'carne asada', 'carnitas', 'chorizo', 'barbacoa', 'birria', 'lengua', 'cabeza', 'pollo']
  const foundTacos = tacoKeywords.filter(type =>
    html.toLowerCase().includes(type.toLowerCase())
  )
  if (foundTacos.length) info.tacoHints = foundTacos

  return info
}

/**
 * Update local PostgreSQL with scrape results
 */
async function updateLocalDb(client, placeType, osmId, result, extractedInfo) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  if (!result.success) {
    // Mark as failed
    await client.query(`
      UPDATE ${table}
      SET
        scrape_method = 'failed',
        scrape_notes = $2,
        last_enriched_at = NOW()
      WHERE google_place_id = $1
    `, [osmId, result.error])
    return false
  }

  // Store successful scrape (HTML stored separately, not in DB)
  await client.query(`
    UPDATE ${table}
    SET
      scrape_method = 'fetch',
      scrape_notes = $2,
      last_enriched_at = NOW()
    WHERE google_place_id = $1
  `, [osmId, JSON.stringify(extractedInfo)])

  return true
}

/**
 * Log enrichment attempt
 */
async function logEnrichment(client, osmId, placeType, phase, status, errorMessage, durationMs) {
  await client.query(`
    INSERT INTO enrichment_log (osm_id, place_type, phase, status, error_message, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [osmId, placeType, phase, status, errorMessage, durationMs])
}

/**
 * Get places with websites that need scraping
 */
async function getPlacesToScrape(client, placeType, limit) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  const result = await client.query(`
    SELECT google_place_id, website_url, name
    FROM ${table}
    WHERE website_url IS NOT NULL
      AND website_url != ''
      AND (scrape_method IS NULL OR scrape_method = '')
      AND google_place_id LIKE 'osm:%'
    ORDER BY random()
    LIMIT $1
  `, [limit])

  return result.rows
}

/**
 * Update stats file
 */
function updateStats(processed, success, failed) {
  let stats = {}
  if (existsSync(STATS_FILE)) {
    try {
      stats = JSON.parse(readFileSync(STATS_FILE, 'utf-8'))
    } catch {}
  }

  if (!stats.phases) stats.phases = {}
  if (!stats.phases.scrape) stats.phases.scrape = { processed: 0, success: 0, failed: 0 }

  stats.phases.scrape.processed += processed
  stats.phases.scrape.success += success
  stats.phases.scrape.failed += failed
  stats.lastUpdated = new Date().toISOString()

  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
}

/**
 * Process a batch of places concurrently
 */
async function processBatch(client, places, placeType) {
  const results = await Promise.all(
    places.map(async (place) => {
      const startTime = Date.now()

      try {
        const result = await fetchWebsite(place.website_url)
        const duration = Date.now() - startTime

        let extractedInfo = null
        if (result.success) {
          extractedInfo = extractBasicInfo(result.html)
          console.log(`  ✓ ${place.name}: ${result.contentLength} bytes, ${extractedInfo.styleHints?.length || 0} style hints`)
        } else {
          console.log(`  ✗ ${place.name}: ${result.error}`)
        }

        await updateLocalDb(client, placeType, place.google_place_id, result, extractedInfo)
        await logEnrichment(
          client,
          place.google_place_id,
          placeType,
          'scrape',
          result.success ? 'success' : 'failed',
          result.error || null,
          duration
        )

        return { success: result.success }
      } catch (error) {
        console.log(`  ✗ ${place.name}: ${error.message}`)
        await logEnrichment(client, place.google_place_id, placeType, 'scrape', 'failed', error.message, 0)
        return { success: false }
      }
    })
  )

  return {
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'pizza'
  const concurrency = args.includes('--concurrency') ? parseInt(args[args.indexOf('--concurrency') + 1], 10) : 5
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 100
  const dryRun = args.includes('--dry-run')

  return { type, concurrency, limit, dryRun }
}

/**
 * Main function
 */
async function main() {
  const { type, concurrency, limit, dryRun } = parseArgs()

  console.log(`=== Website Scraper ===`)
  console.log(`Type: ${type}`)
  console.log(`Concurrency: ${concurrency}`)
  console.log(`Limit: ${limit}`)
  console.log(`Dry run: ${dryRun}`)
  console.log()

  // Connect to local PostgreSQL
  const client = new pg.Client({
    host: 'localhost',
    database: 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()
    console.log('Connected to local PostgreSQL')

    // Get places to scrape
    const places = await getPlacesToScrape(client, type, limit)
    console.log(`Found ${places.length} places with websites to scrape\n`)

    if (dryRun) {
      console.log('Dry run - would scrape:')
      for (const place of places.slice(0, 10)) {
        console.log(`  ${place.name}: ${place.website_url}`)
      }
      if (places.length > 10) {
        console.log(`  ... and ${places.length - 10} more`)
      }
      return
    }

    let totalSuccess = 0
    let totalFailed = 0

    // Process in batches of `concurrency` size
    for (let i = 0; i < places.length; i += concurrency) {
      const batch = places.slice(i, i + concurrency)
      console.log(`\nBatch ${Math.floor(i / concurrency) + 1}/${Math.ceil(places.length / concurrency)} (${batch.length} places)`)

      const results = await processBatch(client, batch, type)
      totalSuccess += results.success
      totalFailed += results.failed

      // Small delay between batches
      if (i + concurrency < places.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // Update stats
    updateStats(places.length, totalSuccess, totalFailed)

    console.log('\n=== Summary ===')
    console.log(`Processed: ${places.length}`)
    console.log(`Success: ${totalSuccess}`)
    console.log(`Failed: ${totalFailed}`)
    console.log(`Success rate: ${((totalSuccess / places.length) * 100).toFixed(1)}%`)

  } finally {
    await client.end()
  }
}

main().catch(console.error)
