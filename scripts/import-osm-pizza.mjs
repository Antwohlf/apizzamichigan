#!/usr/bin/env node
/**
 * OpenStreetMap Pizza Import Script
 *
 * Imports pizza places from OpenStreetMap into the pizza_places table.
 * Places are imported with status='unvisited' so they appear as grey markers.
 *
 * Usage:
 *   node scripts/import-osm-pizza.mjs --dry-run    # Preview without inserting
 *   node scripts/import-osm-pizza.mjs              # Actually import via API
 *   node scripts/import-osm-pizza.mjs --sql        # Output SQL to file
 */

import { writeFileSync } from 'fs'

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Supabase config (same as src/supabaseClient.js)
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0YWh5aXV2cW1hbGZwYmdpaXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4ODcwNDgsImV4cCI6MjA1MzQ2MzA0OH0.OJTKw2TJ8-NEy7fIym0Pe_a8F3cCYPMroNG1fHLGJbA'
const supabase = createClient(supabaseUrl, supabaseKey)

// Overpass API query for pizza places within Michigan state boundary
const OVERPASS_QUERY = `
[out:json][timeout:180];
area["name"="Michigan"]["admin_level"="4"]->.mi;
(
  // Restaurants with pizza cuisine
  node["amenity"="restaurant"]["cuisine"~"pizza"](area.mi);
  way["amenity"="restaurant"]["cuisine"~"pizza"](area.mi);

  // Fast food with pizza cuisine
  node["amenity"="fast_food"]["cuisine"~"pizza"](area.mi);
  way["amenity"="fast_food"]["cuisine"~"pizza"](area.mi);
);
out center;
`

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

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
 */
function isDuplicate(newPlace, existingPlace) {
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
 */
function buildAddress(tags) {
  const parts = []

  if (tags['addr:housenumber'] && tags['addr:street']) {
    parts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`)
  } else if (tags['addr:street']) {
    parts.push(tags['addr:street'])
  }

  if (tags['addr:city']) {
    parts.push(tags['addr:city'])
  }

  if (tags['addr:state']) {
    parts.push(tags['addr:state'])
  } else {
    parts.push('MI') // Default to Michigan
  }

  if (tags['addr:postcode']) {
    parts.push(tags['addr:postcode'])
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Fetch pizza places from OpenStreetMap
 */
async function fetchOsmPizzaPlaces() {
  console.log('Fetching pizza places from OpenStreetMap...')

  const response = await fetch(OVERPASS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`
  })

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  console.log(`Found ${data.elements.length} raw OSM elements`)

  // Parse and filter elements
  const places = []
  for (const el of data.elements) {
    const tags = el.tags || {}
    const name = tags.name

    // Skip entries without names
    if (!name) continue

    // Get coordinates (ways have center, nodes have direct lat/lon)
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon

    if (!lat || !lng) continue

    places.push({
      name,
      lat,
      lng,
      address: buildAddress(tags),
      google_place_id: `osm:${el.type}/${el.id}`,
      status: 'unvisited',
      style: null,
      price: null,
      rating: null,
      notes: null
    })
  }

  console.log(`Parsed ${places.length} valid pizza places with names`)
  return places
}

/**
 * Fetch existing places from database
 */
async function fetchExistingPlaces() {
  console.log('Fetching existing places from database...')

  const { data, error } = await supabase
    .from('pizza_places')
    .select('id, name, lat, lng, google_place_id')

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  console.log(`Found ${data.length} existing places in database`)
  return data
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
function generateSql(places) {
  if (places.length === 0) {
    return '-- No places to insert'
  }

  const lines = [
    '-- OpenStreetMap Pizza Import',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Total places: ${places.length}`,
    '',
    'INSERT INTO pizza_places (name, lat, lng, address, google_place_id, status, style, price, rating, notes)',
    'VALUES'
  ]

  const values = places.map((p, i) => {
    const isLast = i === places.length - 1
    return `  (${escapeSql(p.name)}, ${p.lat}, ${p.lng}, ${escapeSql(p.address)}, ${escapeSql(p.google_place_id)}, 'unvisited', NULL, NULL, NULL, NULL)${isLast ? ';' : ','}`
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
    const { error } = await supabase.from('pizza_places').insert(batch)

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
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const sqlMode = args.includes('--sql')

  if (dryRun) {
    console.log('=== DRY RUN MODE (no changes will be made) ===\n')
  }
  if (sqlMode) {
    console.log('=== SQL MODE (will output SQL file) ===\n')
  }

  try {
    // Fetch from OSM and database
    const osmPlaces = await fetchOsmPizzaPlaces()
    const existingPlaces = await fetchExistingPlaces()

    // Deduplicate
    console.log('\nDeduplicating...')
    const { toInsert, skipped } = deduplicatePlaces(osmPlaces, existingPlaces)

    // Report
    console.log(`\n=== RESULTS ===`)
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
      const sql = generateSql(toInsert)
      const filename = 'scripts/osm-pizza-import.sql'
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

  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
