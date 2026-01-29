#!/usr/bin/env node
/**
 * OpenStreetMap Taco/Mexican Restaurant Import Script
 *
 * Imports taco and Mexican restaurants from OpenStreetMap into the taco_places table.
 * Places are imported with status='unvisited' so they appear as grey markers.
 *
 * Usage:
 *   node scripts/import-osm-tacos.mjs --dry-run                    # Preview Michigan (default)
 *   node scripts/import-osm-tacos.mjs                              # Import Michigan via API
 *   node scripts/import-osm-tacos.mjs --sql                        # Output SQL to file
 *   node scripts/import-osm-tacos.mjs --state "California" --state-code "CA"  # Import specific state
 *   node scripts/import-osm-tacos.mjs --state "New York" --state-code "NY" --dry-run
 */

import { writeFileSync } from 'fs'

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import { isExcludedTacoChain } from './lib/excluded-taco-chains.mjs'

// Supabase config - use service role key to bypass RLS for imports
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY must be set in .env')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Generate Overpass API query for taco/Mexican places within a state boundary
 * Tries both 'name' and 'name:en' to handle bilingual regions (e.g., Canadian provinces)
 */
function buildOverpassQuery(stateName) {
  return `
[out:json][timeout:180];
(
  area["name"="${stateName}"]["admin_level"="4"];
  area["name:en"="${stateName}"]["admin_level"="4"];
)->.state;
(
  // Restaurants with Mexican/taco cuisine
  node["amenity"="restaurant"]["cuisine"~"mexican|taco|tex-mex|burrito"](area.state);
  way["amenity"="restaurant"]["cuisine"~"mexican|taco|tex-mex|burrito"](area.state);

  // Fast food with Mexican/taco cuisine
  node["amenity"="fast_food"]["cuisine"~"mexican|taco|tex-mex|burrito"](area.state);
  way["amenity"="fast_food"]["cuisine"~"mexican|taco|tex-mex|burrito"](area.state);
);
out center;
`
}

// Overpass API endpoints (main can be overloaded, use mirror as fallback)
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
]
const OVERPASS_API_URL = process.env.OVERPASS_URL || OVERPASS_ENDPOINTS[0]

// Distance threshold for deduplication (in meters)
const DEDUPE_DISTANCE_METERS = 50

/**
 * Haversine formula to calculate distance between two points
 */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Normalize a name for comparison (lowercase, remove punctuation)
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if two places are likely duplicates
 * State-aware: places in different states are never duplicates (prevents border false matches)
 */
function isDuplicate(newPlace, existingPlace) {
  // Different states are never duplicates (handles border cities)
  if (newPlace.state && existingPlace.state && newPlace.state !== existingPlace.state) {
    return false
  }

  const distance = getDistanceMeters(
    newPlace.lat, newPlace.lng,
    existingPlace.lat, existingPlace.lng
  )
  if (distance > DEDUPE_DISTANCE_METERS) return false

  // Check name similarity
  const name1 = normalizeName(newPlace.name)
  const name2 = normalizeName(existingPlace.name)

  // Exact match or one contains the other
  return name1 === name2 || name1.includes(name2) || name2.includes(name1)
}

/**
 * Build address string from OSM tags
 * @param {Object} tags - OSM element tags
 * @param {string} stateCode - Default state code if not in tags (e.g., 'MI', 'CA')
 */
function buildAddress(tags, stateCode) {
  const parts = []

  if (tags['addr:housenumber'] && tags['addr:street']) {
    parts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`)
  } else if (tags['addr:street']) {
    parts.push(tags['addr:street'])
  }

  if (tags['addr:city']) {
    parts.push(tags['addr:city'])
  }

  // Only add state and postcode if we have some address data
  // (avoids returning just "MI" when there's no real address)
  if (parts.length > 0) {
    if (tags['addr:state']) {
      parts.push(tags['addr:state'])
    } else {
      parts.push(stateCode)
    }

    if (tags['addr:postcode']) {
      parts.push(tags['addr:postcode'])
    }
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Fetch taco places from OpenStreetMap with automatic endpoint fallback
 * @param {string} stateName - Full state name for OSM query (e.g., 'Michigan', 'California')
 * @param {string} stateCode - 2-letter state code (e.g., 'MI', 'CA')
 */
async function fetchOsmTacoPlaces(stateName, stateCode) {
  console.log(`Fetching taco places from OpenStreetMap for ${stateName} (${stateCode})...`)

  const query = buildOverpassQuery(stateName)

  // Try each endpoint until one works
  const endpoints = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : OVERPASS_ENDPOINTS
  let lastError = null

  for (const endpoint of endpoints) {
    try {
      console.log(`Trying endpoint: ${endpoint}`)
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
        throw new Error('Received HTML/XML error page instead of JSON')
      }

      const data = JSON.parse(text)
      console.log(`Found ${data.elements.length} raw OSM elements`)

      // Parse and filter elements
      const places = []
      let excludedCount = 0
      for (const el of data.elements) {
        const tags = el.tags || {}
        const name = tags.name

        if (!name) continue

        // Skip excluded chains (Chipotle, Qdoba, etc. that don't serve tacos)
        const brand = tags.brand || tags['brand:name'] || ''
        if (isExcludedTacoChain(name, brand)) {
          excludedCount++
          continue
        }

        const lat = el.lat ?? el.center?.lat
        const lng = el.lon ?? el.center?.lon

        if (!lat || !lng) continue

        places.push({
          name,
          lat,
          lng,
          address: buildAddress(tags, stateCode),
          google_place_id: `osm:${el.type}/${el.id}`,
          state: stateCode,
          status: 'unvisited',
          style: null,
          price: null,
          rating: null,
          notes: null
        })
      }

      console.log(`Parsed ${places.length} valid taco places with names (excluded ${excludedCount} non-taco chains)`)
      return places

    } catch (error) {
      console.log(`Endpoint failed: ${error.message}`)
      lastError = error
    }
  }

  throw new Error(`All Overpass endpoints failed. Last error: ${lastError?.message}`)
}

/**
 * Fetch existing places from database
 */
async function fetchExistingPlaces() {
  console.log('Fetching existing places from database...')

  // Fetch all existing places with pagination (Supabase has 1000 row default limit)
  let allData = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('taco_places')
      .select('id, name, lat, lng, google_place_id, state')
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw new Error(`Supabase error: ${error.message}`)
    }

    allData = allData.concat(data)

    if (data.length < pageSize) {
      break
    }
    offset += pageSize
  }

  console.log(`Found ${allData.length} existing places in database`)
  return allData
}

/**
 * Filter out duplicates
 */
function deduplicatePlaces(newPlaces, existingPlaces) {
  const results = {
    toInsert: [],
    skipped: []
  }

  for (const newPlace of newPlaces) {
    // Check if OSM ID already exists
    const osmIdExists = existingPlaces.some(
      ep => ep.google_place_id === newPlace.google_place_id
    )

    if (osmIdExists) {
      results.skipped.push({ place: newPlace, reason: 'OSM ID already exists' })
      continue
    }

    // Check for nearby places with similar names
    const duplicate = existingPlaces.find(ep => isDuplicate(newPlace, ep))

    if (duplicate) {
      results.skipped.push({
        place: newPlace,
        reason: `Similar to existing: "${duplicate.name}"`
      })
      continue
    }

    results.toInsert.push(newPlace)
  }

  return results
}

/**
 * Escape a string for SQL
 */
function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL'
  return `'${String(str).replace(/'/g, "''")}'`
}

/**
 * Generate SQL INSERT statements
 */
function generateSql(places, stateCode) {
  if (places.length === 0) {
    return '-- No places to insert'
  }

  const lines = [
    '-- OpenStreetMap Taco Import',
    `-- Generated: ${new Date().toISOString()}`,
    `-- State: ${stateCode}`,
    `-- Total places: ${places.length}`,
    '',
    'INSERT INTO taco_places (name, lat, lng, address, google_place_id, state, status, style, price, rating, notes)',
    'VALUES'
  ]

  const values = places.map((p, i) => {
    const isLast = i === places.length - 1
    return `  (${escapeSql(p.name)}, ${p.lat}, ${p.lng}, ${escapeSql(p.address)}, ${escapeSql(p.google_place_id)}, ${escapeSql(p.state)}, 'unvisited', NULL, NULL, NULL, NULL)${isLast ? ';' : ','}`
  })

  return lines.concat(values).join('\n')
}

/**
 * Insert places into database
 */
async function insertPlaces(places) {
  if (places.length === 0) {
    console.log('No places to insert')
    return
  }

  console.log(`Inserting ${places.length} places...`)

  // Insert in batches of 100
  const batchSize = 100
  let inserted = 0

  for (let i = 0; i < places.length; i += batchSize) {
    const batch = places.slice(i, i + batchSize)
    const { error } = await supabase.from('taco_places').insert(batch)

    if (error) {
      console.error(`Error inserting batch at index ${i}:`, error.message)
      continue
    }

    inserted += batch.length
    console.log(`Inserted ${inserted}/${places.length}`)
  }

  console.log(`Successfully inserted ${inserted} places`)
}

/**
 * Parse command line argument value
 */
function getArgValue(args, flag) {
  const index = args.indexOf(flag)
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1]
  }
  return null
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const sqlMode = args.includes('--sql')

  // Parse state arguments (default to Michigan)
  const stateName = getArgValue(args, '--state') || 'Michigan'
  const stateCode = getArgValue(args, '--state-code') || 'MI'

  console.log(`=== Importing taco places from ${stateName} (${stateCode}) ===\n`)

  if (dryRun) {
    console.log('=== DRY RUN MODE (no changes will be made) ===\n')
  }
  if (sqlMode) {
    console.log('=== SQL MODE (will output SQL file) ===\n')
  }

  try {
    // Fetch from OSM and database
    const osmPlaces = await fetchOsmTacoPlaces(stateName, stateCode)
    const existingPlaces = await fetchExistingPlaces()

    // Deduplicate
    console.log('\nDeduplicating...')
    const { toInsert, skipped } = deduplicatePlaces(osmPlaces, existingPlaces)

    // Report
    console.log(`\n=== RESULTS for ${stateName} (${stateCode}) ===`)
    console.log(`Total from OSM: ${osmPlaces.length}`)
    console.log(`Already exists / duplicates: ${skipped.length}`)
    console.log(`New places to insert: ${toInsert.length}`)

    if (skipped.length > 0 && skipped.length <= 20) {
      console.log('\nSkipped places:')
      for (const { place, reason } of skipped) {
        console.log(`  - ${place.name}: ${reason}`)
      }
    } else if (skipped.length > 20) {
      console.log(`\nFirst 20 skipped places:`)
      for (const { place, reason } of skipped.slice(0, 20)) {
        console.log(`  - ${place.name}: ${reason}`)
      }
    }

    if (toInsert.length > 0 && toInsert.length <= 20) {
      console.log('\nPlaces to insert:')
      for (const place of toInsert) {
        console.log(`  - ${place.name} (${place.address || 'no address'})`)
      }
    } else if (toInsert.length > 20) {
      console.log(`\nFirst 20 places to insert:`)
      for (const place of toInsert.slice(0, 20)) {
        console.log(`  - ${place.name} (${place.address || 'no address'})`)
      }
    }

    // SQL mode - write to file
    if (sqlMode && toInsert.length > 0) {
      const sql = generateSql(toInsert, stateCode)
      const filename = `scripts/osm-taco-import-${stateCode.toLowerCase()}.sql`
      writeFileSync(filename, sql)
      console.log(`\n=== SQL written to ${filename} ===`)
      console.log('Copy the contents and run in Supabase SQL Editor')
      return
    }

    // Insert if not dry run
    if (!dryRun && !sqlMode && toInsert.length > 0) {
      console.log('\n')
      await insertPlaces(toInsert)
    } else if (dryRun) {
      console.log('\n=== DRY RUN COMPLETE (no changes made) ===')
    }

    // Return count for wrapper script usage
    return { inserted: toInsert.length, skipped: skipped.length, total: osmPlaces.length }

  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
