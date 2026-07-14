#!/usr/bin/env node
/**
 * OSM Extractor Worker
 *
 * Queries Overpass API for full OSM details using the OSM IDs from our local cache.
 * Zero Supabase egress - all data comes from OpenStreetMap.
 *
 * Usage:
 *   node scripts/enrichment/workers/osm-extractor.mjs --type pizza --batch 100
 *   node scripts/enrichment/workers/osm-extractor.mjs --type taco --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_FILE = join(__dirname, '../../.osm-id-cache.json')
const STATS_FILE = join(__dirname, '../../.enrichment-stats.json')

// Overpass API endpoints
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]

// Nominatim for reverse geocoding (1 req/sec limit)
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'

/**
 * Parse OSM ID string into type and ID
 * @param {string} osmIdString - e.g., "osm:node/12345"
 * @returns {{ type: string, id: number } | null}
 */
function parseOsmId(osmIdString) {
  const match = osmIdString?.match(/^osm:(node|way|relation)\/(\d+)$/)
  if (!match) return null
  return { type: match[1], id: parseInt(match[2], 10) }
}

/**
 * Load OSM ID cache
 */
function loadOsmCache() {
  if (!existsSync(CACHE_FILE)) {
    throw new Error(`OSM cache not found at ${CACHE_FILE}`)
  }
  const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
  return {
    pizza: new Set(data.pizza || []),
    taco: new Set(data.taco || [])
  }
}

/**
 * Build Overpass query for a batch of OSM elements
 */
function buildOverpassQuery(elements) {
  const parts = elements.map(el => {
    if (el.type === 'node') return `node(${el.id});`
    if (el.type === 'way') return `way(${el.id});`
    if (el.type === 'relation') return `relation(${el.id});`
    return ''
  }).filter(Boolean)

  return `
[out:json][timeout:180];
(
  ${parts.join('\n  ')}
);
out center tags;
`
}

/**
 * Query Overpass API for element details
 */
async function queryOverpass(elements) {
  if (!elements.length) return []

  const query = buildOverpassQuery(elements)

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`  Querying ${endpoint} for ${elements.length} elements...`)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      const text = await response.text()
      if (text.startsWith('<?xml') || text.startsWith('<')) {
        throw new Error('Received HTML/XML error page')
      }

      const data = JSON.parse(text)
      return data.elements || []
    } catch (error) {
      console.log(`  Endpoint failed: ${error.message}`)
    }
  }

  throw new Error('All Overpass endpoints failed')
}

/**
 * Reverse geocode coordinates using Nominatim
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `${NOMINATIM_URL}?format=json&lat=${lat}&lon=${lng}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PizzaEnrichmentPipeline/1.0' }
    })

    if (!response.ok) return null

    const data = await response.json()
    if (!data.address) return null

    return {
      address: data.display_name,
      city: data.address.city || data.address.town || data.address.village,
      state: data.address.state,
      country: data.address.country,
      postcode: data.address.postcode
    }
  } catch (error) {
    console.log(`  Nominatim error: ${error.message}`)
    return null
  }
}

/**
 * Extract enrichment data from OSM element
 */
function extractEnrichmentData(element) {
  const tags = element.tags || {}
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon

  return {
    osmId: `osm:${element.type}/${element.id}`,
    name: tags.name || tags['name:en'],
    lat,
    lng,

    // Contact info
    website: tags.website || tags['contact:website'] || tags.url,
    phone: tags.phone || tags['contact:phone'],

    // Address from OSM
    address: buildAddressFromTags(tags),

    // Hours
    hours: tags.opening_hours ? parseOpeningHours(tags.opening_hours) : null,

    // Cuisine (for style hints)
    cuisine: tags.cuisine,

    // Raw tags for LLM classification
    rawTags: tags
  }
}

/**
 * Build address string from OSM tags
 */
function buildAddressFromTags(tags) {
  const parts = []

  if (tags['addr:housenumber'] && tags['addr:street']) {
    parts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`)
  } else if (tags['addr:street']) {
    parts.push(tags['addr:street'])
  }

  if (tags['addr:city']) parts.push(tags['addr:city'])
  if (tags['addr:state']) parts.push(tags['addr:state'])
  if (tags['addr:postcode']) parts.push(tags['addr:postcode'])

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Parse opening hours string into JSONB format
 * (Simplified - full parsing would be complex)
 */
function parseOpeningHours(hoursString) {
  // Store raw for now, can be parsed more thoroughly later
  return { raw: hoursString }
}

/**
 * Update local PostgreSQL with enrichment data
 */
async function updateLocalDb(client, placeType, enrichmentData) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  const query = `
    UPDATE ${table}
    SET
      website_url = COALESCE($2, website_url),
      phone = COALESCE($3, phone),
      address = COALESCE($4, address),
      address_source = CASE WHEN $4 IS NOT NULL THEN 'osm' ELSE address_source END,
      hours = COALESCE($5, hours),
      enrichment_status = 'enriched',
      last_enriched_at = NOW()
    WHERE google_place_id = $1
    RETURNING id
  `

  const result = await client.query(query, [
    enrichmentData.osmId,
    enrichmentData.website,
    enrichmentData.phone,
    enrichmentData.address,
    enrichmentData.hours ? JSON.stringify(enrichmentData.hours) : null
  ])

  return result.rowCount > 0
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
 * Update stats file
 */
function updateStats(placeType, processed, success, failed) {
  let stats = {}
  if (existsSync(STATS_FILE)) {
    try {
      stats = JSON.parse(readFileSync(STATS_FILE, 'utf-8'))
    } catch {}
  }

  if (!stats.phases) stats.phases = {}
  if (!stats.phases.osm_extract) stats.phases.osm_extract = { processed: 0, success: 0, failed: 0 }

  stats.phases.osm_extract.processed += processed
  stats.phases.osm_extract.success += success
  stats.phases.osm_extract.failed += failed
  stats.lastUpdated = new Date().toISOString()

  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'pizza'
  const batch = args.includes('--batch') ? parseInt(args[args.indexOf('--batch') + 1], 10) : 50
  const dryRun = args.includes('--dry-run')
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : null

  return { type, batch, dryRun, limit }
}

/**
 * Main function
 */
async function main() {
  const { type, batch, dryRun, limit } = parseArgs()

  console.log(`=== OSM Extractor ===`)
  console.log(`Type: ${type}`)
  console.log(`Batch size: ${batch}`)
  console.log(`Dry run: ${dryRun}`)
  if (limit) console.log(`Limit: ${limit}`)
  console.log()

  // Load OSM cache
  const cache = loadOsmCache()
  const osmIds = Array.from(cache[type])
  console.log(`Found ${osmIds.length} ${type} OSM IDs in cache`)

  // Parse into elements
  const elements = osmIds
    .map(id => ({ ...parseOsmId(id), fullId: id }))
    .filter(el => el !== null)

  if (limit) {
    elements.splice(limit)
    console.log(`Limited to ${elements.length} elements`)
  }

  if (dryRun) {
    console.log('\nDry run - would process:')
    console.log(`  Total elements: ${elements.length}`)
    console.log(`  Batches: ${Math.ceil(elements.length / batch)}`)
    console.log(`  Sample IDs: ${elements.slice(0, 5).map(e => e.fullId).join(', ')}`)
    return
  }

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

    let totalProcessed = 0
    let totalSuccess = 0
    let totalFailed = 0

    // Process in batches
    for (let i = 0; i < elements.length; i += batch) {
      const batchElements = elements.slice(i, i + batch)
      console.log(`\nBatch ${Math.floor(i / batch) + 1}/${Math.ceil(elements.length / batch)} (${batchElements.length} elements)`)

      const startTime = Date.now()

      try {
        // Query Overpass for this batch
        const osmElements = await queryOverpass(batchElements)
        console.log(`  Received ${osmElements.length} elements from Overpass`)

        // Create lookup by ID
        const elementMap = new Map()
        for (const el of osmElements) {
          elementMap.set(`osm:${el.type}/${el.id}`, el)
        }

        // Process each element
        for (const batchEl of batchElements) {
          const osmEl = elementMap.get(batchEl.fullId)

          if (!osmEl) {
            totalFailed++
            await logEnrichment(client, batchEl.fullId, type, 'osm_extract', 'failed', 'Not found in Overpass', 0)
            continue
          }

          try {
            const data = extractEnrichmentData(osmEl)
            const updated = await updateLocalDb(client, type, data)

            if (updated) {
              totalSuccess++
              await logEnrichment(client, batchEl.fullId, type, 'osm_extract', 'success', null, Date.now() - startTime)
            } else {
              totalFailed++
              await logEnrichment(client, batchEl.fullId, type, 'osm_extract', 'failed', 'No matching record in DB', 0)
            }
          } catch (error) {
            totalFailed++
            await logEnrichment(client, batchEl.fullId, type, 'osm_extract', 'failed', error.message, 0)
          }
        }

        totalProcessed += batchElements.length
        console.log(`  Success: ${totalSuccess}, Failed: ${totalFailed}`)

        // Rate limit: wait before next batch
        if (i + batch < elements.length) {
          console.log('  Waiting 2 seconds before next batch...')
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      } catch (error) {
        console.error(`  Batch failed: ${error.message}`)
        totalFailed += batchElements.length
      }
    }

    // Update stats
    updateStats(type, totalProcessed, totalSuccess, totalFailed)

    console.log('\n=== Summary ===')
    console.log(`Processed: ${totalProcessed}`)
    console.log(`Success: ${totalSuccess}`)
    console.log(`Failed: ${totalFailed}`)
    console.log(`Success rate: ${((totalSuccess / totalProcessed) * 100).toFixed(1)}%`)

  } finally {
    await client.end()
  }
}

main().catch(console.error)
