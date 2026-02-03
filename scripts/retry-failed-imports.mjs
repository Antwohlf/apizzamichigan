#!/usr/bin/env node
/**
 * Retry Failed Imports
 *
 * Retries only the failed regions from import-rest-of-world.mjs
 * Uses a longer delay (8 seconds) to avoid rate limiting.
 *
 * Usage:
 *   node scripts/retry-failed-imports.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROGRESS_FILE = join(__dirname, '.rest-of-world-progress.json')
const OSM_CACHE_FILE = join(__dirname, '.osm-id-cache.json')

// Supabase setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

// Longer delay for retries to avoid rate limiting (60 seconds like working scripts)
const DELAY_BETWEEN_REQUESTS = 60000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// All region definitions with bboxes
const ALL_REGIONS = {
  // Russia
  'RU-MOW': { name: 'Moscow', bbox: [55.4, 37.2, 56.0, 37.9], country: 'RU' },
  'RU-SPE': { name: 'Saint Petersburg', bbox: [59.7, 29.9, 60.1, 30.6], country: 'RU' },
  'RU-KAZ': { name: 'Kazan', bbox: [55.6, 48.8, 55.9, 49.3], country: 'RU' },
  'RU-NIZ': { name: 'Nizhny Novgorod', bbox: [56.2, 43.8, 56.4, 44.1], country: 'RU' },
  'RU-NVS': { name: 'Novosibirsk', bbox: [54.9, 82.7, 55.1, 83.2], country: 'RU' },
  // Ukraine
  'UA-KYI': { name: 'Kyiv', bbox: [50.3, 30.2, 50.6, 30.8], country: 'UA' },
  'UA-KHA': { name: 'Kharkiv', bbox: [49.9, 36.1, 50.1, 36.4], country: 'UA' },
  // Serbia
  'RS-NSD': { name: 'Novi Sad', bbox: [45.2, 19.8, 45.3, 19.9], country: 'RS' },
  // Kosovo
  'XK-PRI': { name: 'Pristina', bbox: [42.6, 21.1, 42.7, 21.2], country: 'XK' },
  // Egypt
  'EG-GIZ': { name: 'Giza', bbox: [29.9, 30.9, 30.1, 31.3], country: 'EG' },
  // Morocco
  'MA-RAB': { name: 'Rabat', bbox: [33.9, -6.9, 34.1, -6.7], country: 'MA' },
  // Algeria
  'DZ-ORA': { name: 'Oran', bbox: [35.6, -0.7, 35.8, -0.5], country: 'DZ' },
  // Nigeria
  'NG-LAG': { name: 'Lagos', bbox: [6.4, 3.2, 6.7, 3.6], country: 'NG' },
  // Kenya
  'KE-MOM': { name: 'Mombasa', bbox: [-4.1, 39.6, -4.0, 39.7], country: 'KE' },
  // Ivory Coast
  'CI-ABI': { name: 'Abidjan', bbox: [5.2, -4.1, 5.4, -3.9], country: 'CI' },
  // Uganda
  'UG-KAM': { name: 'Kampala', bbox: [0.2, 32.5, 0.4, 32.7], country: 'UG' },
  // UAE
  'AE-DXB': { name: 'Dubai', bbox: [25.0, 55.1, 25.3, 55.4], country: 'AE' },
  // Turkey
  'TR-IZM': { name: 'Izmir', bbox: [38.3, 27.0, 38.5, 27.2], country: 'TR' },
  'TR-BUR': { name: 'Bursa', bbox: [40.1, 28.9, 40.3, 29.1], country: 'TR' },
  // Saudi Arabia
  'SA-RIY': { name: 'Riyadh', bbox: [24.5, 46.5, 24.8, 46.9], country: 'SA' },
  // Oman
  'OM-MUS': { name: 'Muscat', bbox: [23.5, 58.3, 23.7, 58.6], country: 'OM' },
  // Jordan
  'JO-AMM': { name: 'Amman', bbox: [31.9, 35.8, 32.0, 36.0], country: 'JO' },
  // Iran
  'IR-SYZ': { name: 'Shiraz', bbox: [29.5, 52.5, 29.7, 52.6], country: 'IR' },
  'IR-MHD': { name: 'Mashhad', bbox: [36.2, 59.5, 36.4, 59.7], country: 'IR' },
  'IR-THR': { name: 'Tehran', bbox: [35.6, 51.3, 35.8, 51.5], country: 'IR' },
  'IR-IFN': { name: 'Isfahan', bbox: [32.6, 51.6, 32.7, 51.7], country: 'IR' },
  // Iraq
  'IQ-BGW': { name: 'Baghdad', bbox: [33.2, 44.3, 33.4, 44.5], country: 'IQ' },
  'IQ-EBL': { name: 'Erbil', bbox: [36.1, 44.0, 36.2, 44.1], country: 'IQ' },
  'IQ-BSR': { name: 'Basra', bbox: [30.5, 47.8, 30.6, 47.9], country: 'IQ' },
  // Yemen
  'YE-SAH': { name: 'Sanaa', bbox: [15.3, 44.1, 15.4, 44.3], country: 'YE' },
  'YE-ADE': { name: 'Aden', bbox: [12.7, 45.0, 12.8, 45.1], country: 'YE' },
  // Syria
  'SY-DAM': { name: 'Damascus', bbox: [33.4, 36.2, 33.6, 36.4], country: 'SY' },
  // Palestine
  'PS-GZA': { name: 'Gaza', bbox: [31.4, 34.4, 31.6, 34.5], country: 'PS' },
  'PS-RAM': { name: 'Ramallah', bbox: [31.9, 35.2, 32.0, 35.3], country: 'PS' },
  // Georgia
  'GE-TBS': { name: 'Tbilisi', bbox: [41.6, 44.7, 41.8, 44.9], country: 'GE' },
  // Armenia
  'AM-EVN': { name: 'Yerevan', bbox: [40.1, 44.4, 40.2, 44.6], country: 'AM' },
  // Azerbaijan
  'AZ-BAK': { name: 'Baku', bbox: [40.3, 49.8, 40.5, 50.0], country: 'AZ' },
  // Australia
  'AU-PER': { name: 'Perth', bbox: [-32.1, 115.7, -31.8, 116.0], country: 'AU' },
  'AU-ADL': { name: 'Adelaide', bbox: [-35.0, 138.5, -34.8, 138.7], country: 'AU' },
  'AU-DRW': { name: 'Darwin', bbox: [-12.5, 130.8, -12.3, 131.0], country: 'AU' },
  // New Zealand
  'NZ-WLG': { name: 'Wellington', bbox: [-41.4, 174.7, -41.2, 174.9], country: 'NZ' },
  // Japan
  'JP-NGY': { name: 'Nagoya', bbox: [35.0, 136.8, 35.3, 137.0], country: 'JP' },
  // South Korea
  'KR-BUS': { name: 'Busan', bbox: [35.0, 128.9, 35.2, 129.2], country: 'KR' },
  // China
  'CN-CAN': { name: 'Guangzhou', bbox: [22.9, 113.2, 23.2, 113.5], country: 'CN' },
  'CN-NKG': { name: 'Nanjing', bbox: [31.9, 118.6, 32.2, 119.0], country: 'CN' },
  'CN-CKG': { name: 'Chongqing', bbox: [29.4, 106.4, 29.7, 106.7], country: 'CN' },
  'CN-SHA': { name: 'Shanghai', bbox: [31.0, 121.3, 31.4, 121.6], country: 'CN' },
  'CN-WUH': { name: 'Wuhan', bbox: [30.4, 114.2, 30.7, 114.5], country: 'CN' },
  // Philippines
  'PH-MNL': { name: 'Manila', bbox: [14.5, 120.9, 14.7, 121.1], country: 'PH' },
  // Thailand
  'TH-BKK': { name: 'Bangkok', bbox: [13.6, 100.4, 13.9, 100.7], country: 'TH' },
  'TH-HKT': { name: 'Phuket', bbox: [7.8, 98.3, 8.0, 98.5], country: 'TH' },
  // Indonesia
  'ID-JOG': { name: 'Yogyakarta', bbox: [-7.9, 110.3, -7.7, 110.5], country: 'ID' },
  // Vietnam
  'VN-SGN': { name: 'Ho Chi Minh City', bbox: [10.7, 106.6, 10.9, 106.8], country: 'VN' },
  // India
  'IN-GOI': { name: 'Goa', bbox: [15.4, 73.7, 15.6, 74.0], country: 'IN' },
  // Bangladesh
  'BD-DAC': { name: 'Dhaka', bbox: [23.7, 90.3, 23.9, 90.5], country: 'BD' },
  // Myanmar
  'MM-RGN': { name: 'Yangon', bbox: [16.7, 96.0, 16.9, 96.3], country: 'MM' },
  // Nepal
  'NP-KTM': { name: 'Kathmandu', bbox: [27.6, 85.2, 27.8, 85.4], country: 'NP' },
}

// Small countries (query entire country)
const SMALL_COUNTRIES = {
  'SI': 'Slovenia',
  'MT': 'Malta',
  'QA': 'Qatar',
  'HK': 'Hong Kong',
  'MO': 'Macao',
  'BN': 'Brunei',
  'TL': 'East Timor',
  'VU': 'Vanuatu',
  'BT': 'Bhutan',
  'LB': 'Lebanon',
}

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
 * Retry a single failed region
 */
async function retryRegion(key, progress, osmCache) {
  // Parse the key: "RU-MOW-pizza" -> country=RU, region=MOW, type=pizza
  const parts = key.split('-')
  const type = parts.pop() // 'pizza' or 'tacos'
  const regionCode = parts.length > 1 ? parts[1] : null
  const countryCode = parts[0]

  const fullRegionKey = regionCode ? `${countryCode}-${regionCode}` : countryCode
  const region = ALL_REGIONS[fullRegionKey]
  const isSmallCountry = SMALL_COUNTRIES[countryCode]

  console.log(`\nRetrying: ${key}`)

  try {
    let query
    let stateCode

    if (isSmallCountry) {
      console.log(`  Querying entire ${isSmallCountry}...`)
      query = buildSmallCountryQuery(countryCode, type === 'pizza' ? 'pizza' : 'taco')
      stateCode = countryCode
    } else if (region) {
      console.log(`  Querying ${region.name} (${region.country})...`)
      query = buildBboxQuery(region.bbox, type === 'pizza' ? 'pizza' : 'taco')
      stateCode = regionCode || countryCode
    } else {
      console.log(`  Unknown region: ${fullRegionKey}, skipping`)
      return { success: false, count: 0 }
    }

    const data = await queryOverpass(query)

    const places = data.elements
      .map(el => transformToPlace(el, stateCode))
      .filter(Boolean)

    console.log(`  Found ${places.length} places`)

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

      console.log(`  Saved ${uniquePlaces.length} places to Supabase`)
    }

    // Move from failed to completed
    delete progress.failed[key]
    progress.completed[key] = {
      type,
      count: places.length,
      retried: true,
      timestamp: new Date().toISOString()
    }
    saveProgress(progress)

    return { success: true, count: places.length }

  } catch (error) {
    console.log(`  Failed again: ${error.message}`)
    progress.failed[key].retryError = error.message
    progress.failed[key].lastRetry = new Date().toISOString()
    saveProgress(progress)
    return { success: false, count: 0 }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== Retry Failed Imports ===')
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms (${DELAY_BETWEEN_REQUESTS/1000}s)`)
  console.log()

  const progress = loadProgress()
  const osmCache = loadOsmCache()

  const failedKeys = Object.keys(progress.failed)
  console.log(`Found ${failedKeys.length} failed regions to retry`)
  console.log()

  if (failedKeys.length === 0) {
    console.log('No failed regions to retry!')
    return
  }

  let successCount = 0
  let failCount = 0
  let totalPlaces = 0

  for (let i = 0; i < failedKeys.length; i++) {
    const key = failedKeys[i]
    console.log(`[${i + 1}/${failedKeys.length}] ${key}`)

    const result = await retryRegion(key, progress, osmCache)

    if (result.success) {
      successCount++
      totalPlaces += result.count
    } else {
      failCount++
    }

    // Wait before next request
    if (i < failedKeys.length - 1) {
      console.log(`  Waiting ${DELAY_BETWEEN_REQUESTS/1000}s...`)
      await sleep(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Retry Complete ===')
  console.log(`Succeeded: ${successCount}`)
  console.log(`Still failed: ${failCount}`)
  console.log(`Total places added: ${totalPlaces}`)
}

main().catch(console.error)
