#!/usr/bin/env node
/**
 * Import Caribbean Islands
 *
 * Imports pizza and taco places from Caribbean nations.
 * Uses small country (ISO3166-1) queries for most islands.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROGRESS_FILE = join(__dirname, '.caribbean-progress.json')
const OSM_CACHE_FILE = join(__dirname, '.osm-id-cache.json')

// Supabase setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

// 60 second delay between requests
const DELAY_BETWEEN_REQUESTS = 60000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Caribbean countries and territories
const CARIBBEAN = [
  // Large islands with major cities
  { name: 'Cuba', code: 'CU', iso: 'CU', regions: [
    { name: 'Havana', code: 'HAV', bbox: [22.9, -82.5, 23.2, -82.2] },
    { name: 'Santiago de Cuba', code: 'SCU', bbox: [19.9, -75.9, 20.1, -75.7] },
  ]},
  { name: 'Dominican Republic', code: 'DO', iso: 'DO', regions: [
    { name: 'Santo Domingo', code: 'SDQ', bbox: [18.4, -70.0, 18.6, -69.8] },
    { name: 'Santiago', code: 'STI', bbox: [19.4, -70.8, 19.5, -70.6] },
    { name: 'Punta Cana', code: 'PUJ', bbox: [18.5, -68.4, 18.6, -68.3] },
  ]},
  { name: 'Jamaica', code: 'JM', iso: 'JM', regions: [
    { name: 'Kingston', code: 'KIN', bbox: [17.9, -76.9, 18.1, -76.7] },
    { name: 'Montego Bay', code: 'MBJ', bbox: [18.4, -77.9, 18.5, -77.8] },
  ]},
  { name: 'Haiti', code: 'HT', iso: 'HT', regions: [
    { name: 'Port-au-Prince', code: 'PAP', bbox: [18.5, -72.4, 18.6, -72.2] },
  ]},
  { name: 'Puerto Rico', code: 'PR', iso: 'PR', regions: [
    { name: 'San Juan', code: 'SJU', bbox: [18.4, -66.1, 18.5, -65.9] },
    { name: 'Ponce', code: 'PSE', bbox: [17.9, -66.7, 18.1, -66.5] },
  ]},
  { name: 'Trinidad and Tobago', code: 'TT', iso: 'TT', regions: [
    { name: 'Port of Spain', code: 'POS', bbox: [10.6, -61.6, 10.7, -61.4] },
  ]},
  // Smaller islands - query entire country
  { name: 'Bahamas', code: 'BS', iso: 'BS', small: true },
  { name: 'Barbados', code: 'BB', iso: 'BB', small: true },
  { name: 'Saint Lucia', code: 'LC', iso: 'LC', small: true },
  { name: 'Grenada', code: 'GD', iso: 'GD', small: true },
  { name: 'Saint Vincent and the Grenadines', code: 'VC', iso: 'VC', small: true },
  { name: 'Antigua and Barbuda', code: 'AG', iso: 'AG', small: true },
  { name: 'Dominica', code: 'DM', iso: 'DM', small: true },
  { name: 'Saint Kitts and Nevis', code: 'KN', iso: 'KN', small: true },
  { name: 'Aruba', code: 'AW', iso: 'AW', small: true },
  { name: 'Curaçao', code: 'CW', iso: 'CW', small: true },
  { name: 'Cayman Islands', code: 'KY', iso: 'KY', small: true },
  { name: 'British Virgin Islands', code: 'VG', iso: 'VG', small: true },
  { name: 'US Virgin Islands', code: 'VI', iso: 'VI', small: true },
  { name: 'Turks and Caicos', code: 'TC', iso: 'TC', small: true },
  { name: 'Martinique', code: 'MQ', iso: 'MQ', small: true },
  { name: 'Guadeloupe', code: 'GP', iso: 'GP', small: true },
  { name: 'Sint Maarten', code: 'SX', iso: 'SX', small: true },
  { name: 'Bonaire', code: 'BQ', iso: 'BQ', small: true },
  { name: 'Anguilla', code: 'AI', iso: 'AI', small: true },
  { name: 'Montserrat', code: 'MS', iso: 'MS', small: true },
]

/**
 * Build Overpass query for a bounding box
 */
function buildBboxQuery(bbox, type) {
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'
  const [south, west, north, east] = bbox

  return `
[out:json][timeout:60];
(
  node["amenity"~"restaurant|fast_food"][${cuisine}](${south},${west},${north},${east});
  way["amenity"~"restaurant|fast_food"][${cuisine}](${south},${west},${north},${east});
);
out center tags;
`.trim()
}

/**
 * Build Overpass query for entire small country
 */
function buildSmallCountryQuery(countryCode, type) {
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'

  return `
[out:json][timeout:90];
area["ISO3166-1"="${countryCode}"]->.country;
(
  node["amenity"~"restaurant|fast_food"][${cuisine}](area.country);
  way["amenity"~"restaurant|fast_food"][${cuisine}](area.country);
);
out center tags;
`.trim()
}

/**
 * Query Overpass API
 */
async function queryOverpass(query) {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`
  })

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Transform OSM element to place record
 */
function transformToPlace(element, stateCode) {
  const tags = element.tags || {}
  const lat = element.lat || element.center?.lat
  const lon = element.lon || element.center?.lon

  if (!lat || !lon || !tags.name) return null

  const parts = []
  if (tags['addr:housenumber']) parts.push(tags['addr:housenumber'])
  if (tags['addr:street']) parts.push(tags['addr:street'])
  if (tags['addr:city']) parts.push(tags['addr:city'])
  if (tags['addr:postcode']) parts.push(tags['addr:postcode'])

  return {
    google_place_id: `osm:${element.type}/${element.id}`,
    name: tags.name,
    lat,
    lng: lon,
    state: stateCode,
    address: parts.length > 0 ? parts.join(', ') : null,
    status: 'unvisited',
  }
}

/**
 * Load progress file
 */
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  }
  return { completed: {}, failed: {} }
}

/**
 * Save progress file
 */
function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

/**
 * Load OSM ID cache
 */
function loadOsmCache() {
  if (existsSync(OSM_CACHE_FILE)) {
    return JSON.parse(readFileSync(OSM_CACHE_FILE, 'utf-8'))
  }
  return { pizza: [], tacos: [] }
}

/**
 * Save OSM ID cache
 */
function saveOsmCache(cache) {
  writeFileSync(OSM_CACHE_FILE, JSON.stringify(cache, null, 2))
}

/**
 * Import a single region
 */
async function importRegion(country, region, type, progress, osmCache) {
  const regionCode = region ? region.code : country.code
  const key = region
    ? `${country.code}-${region.code}-${type}`
    : `${country.code}-${type}`

  if (progress.completed[key]) {
    console.log(`  Skipping ${key} (already done)`)
    return { skipped: true }
  }

  try {
    let query
    let stateCode = regionCode

    if (country.small || !region) {
      console.log(`  Querying entire ${country.name} for ${type}...`)
      query = buildSmallCountryQuery(country.iso, type)
    } else {
      console.log(`  Querying ${region.name}, ${country.name} for ${type}...`)
      query = buildBboxQuery(region.bbox, type)
    }

    const data = await queryOverpass(query)

    const places = data.elements
      .map(el => transformToPlace(el, stateCode))
      .filter(Boolean)

    console.log(`    Found ${places.length} ${type} places`)

    if (places.length > 0) {
      // Deduplicate
      const seen = new Set()
      const uniquePlaces = places.filter(p => {
        if (seen.has(p.google_place_id)) return false
        seen.add(p.google_place_id)
        return true
      })

      // Save to Supabase
      const table = type === 'pizza' ? 'pizza_places' : 'taco_places'
      const { error } = await supabase
        .from(table)
        .upsert(uniquePlaces, { onConflict: 'google_place_id' })

      if (error) throw error

      // Update OSM cache
      const cacheKey = type === 'pizza' ? 'pizza' : 'tacos'
      const newIds = uniquePlaces.map(p => p.google_place_id)
      if (!osmCache[cacheKey]) osmCache[cacheKey] = []
      osmCache[cacheKey] = [...new Set([...osmCache[cacheKey], ...newIds])]
      saveOsmCache(osmCache)
    }

    progress.completed[key] = {
      type,
      count: places.length,
      timestamp: new Date().toISOString()
    }
    saveProgress(progress)

    return { success: true, count: places.length }

  } catch (error) {
    console.log(`    Failed: ${error.message}`)
    progress.failed[key] = {
      type,
      error: error.message,
      timestamp: new Date().toISOString()
    }
    saveProgress(progress)
    return { success: false, count: 0 }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== Caribbean Import ===')
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms (${DELAY_BETWEEN_REQUESTS/1000}s)`)
  console.log()

  const progress = loadProgress()
  const osmCache = loadOsmCache()

  let totalPlaces = 0
  let completed = 0
  let failed = 0

  for (const country of CARIBBEAN) {
    console.log(`\n${country.name}:`)

    // If small country, query entire country
    if (country.small) {
      for (const type of ['pizza', 'tacos']) {
        const result = await importRegion(country, null, type, progress, osmCache)
        if (result.skipped) continue
        if (result.success) {
          completed++
          totalPlaces += result.count
        } else {
          failed++
        }
        await sleep(DELAY_BETWEEN_REQUESTS)
      }
    } else {
      // Query each region
      for (const region of country.regions) {
        for (const type of ['pizza', 'tacos']) {
          const result = await importRegion(country, region, type, progress, osmCache)
          if (result.skipped) continue
          if (result.success) {
            completed++
            totalPlaces += result.count
          } else {
            failed++
          }
          await sleep(DELAY_BETWEEN_REQUESTS)
        }
      }
    }
  }

  console.log('\n=== Caribbean Import Complete ===')
  console.log(`Completed: ${completed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total places: ${totalPlaces.toLocaleString()}`)
}

main().catch(console.error)
