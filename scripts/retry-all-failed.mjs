#!/usr/bin/env node
/**
 * Retry All Failed Queries
 *
 * Retries all failed queries from previous imports:
 * - 6 Caribbean (504 errors)
 * - 1 Russia/Nizhny Novgorod (504 error)
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// All failed queries
const FAILED_QUERIES = [
  // Caribbean failures
  { name: 'Dominican Republic - Santiago', stateCode: 'DO', iso: null, bbox: [19.4, -70.8, 19.6, -70.6], type: 'tacos' },
  { name: 'Saint Lucia', stateCode: 'LC', iso: 'LC', bbox: null, type: 'pizza' },
  { name: 'British Virgin Islands', stateCode: 'VG', iso: 'VG', bbox: null, type: 'pizza' },
  { name: 'Turks and Caicos', stateCode: 'TC', iso: 'TC', bbox: null, type: 'tacos' },
  { name: 'Martinique', stateCode: 'MQ', iso: 'MQ', bbox: null, type: 'pizza' },
  { name: 'Bonaire', stateCode: 'BQ', iso: 'BQ', bbox: null, type: 'pizza' },
  // Russia failure
  { name: 'Russia - Nizhny Novgorod', stateCode: 'RU', iso: null, bbox: [56.2, 43.8, 56.4, 44.1], type: 'tacos' },
  // Africa failures
  { name: 'Equatorial Guinea', stateCode: 'GQ', iso: 'GQ', bbox: null, type: 'pizza' },
  { name: 'Mauritania', stateCode: 'MR', iso: 'MR', bbox: null, type: 'pizza' },
]

function buildBboxQuery(bbox, type) {
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'
  const [south, west, north, east] = bbox
  return `
[out:json][timeout:120];
(
  node[amenity=restaurant][${cuisine}](${south},${west},${north},${east});
  way[amenity=restaurant][${cuisine}](${south},${west},${north},${east});
  node[amenity=fast_food][${cuisine}](${south},${west},${north},${east});
  way[amenity=fast_food][${cuisine}](${south},${west},${north},${east});
);
out center;`
}

function buildIsoQuery(isoCode, type) {
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'
  return `
[out:json][timeout:120];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  node[amenity=restaurant][${cuisine}](area.searchArea);
  way[amenity=restaurant][${cuisine}](area.searchArea);
  node[amenity=fast_food][${cuisine}](area.searchArea);
  way[amenity=fast_food][${cuisine}](area.searchArea);
);
out center;`
}

async function queryOverpass(query) {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain' }
  })

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`)
  }

  return response.json()
}

function extractPlaces(data, stateCode) {
  const places = []

  for (const element of data.elements || []) {
    const tags = element.tags || {}
    const lat = element.lat || element.center?.lat
    const lon = element.lon || element.center?.lon

    if (!lat || !lon || !tags.name) continue

    // Truncate state to 10 chars max (database constraint)
    const stateValue = (tags['addr:state'] || stateCode).substring(0, 10)

    places.push({
      google_place_id: `osm:${element.type}/${element.id}`,
      name: tags.name,
      lat,
      lng: lon,
      state: stateValue,
      address: [tags['addr:street'], tags['addr:city'], tags['addr:state']].filter(Boolean).join(', ') || null,
    })
  }

  return places
}

async function upsertPlaces(places, table) {
  if (places.length === 0) return 0

  const { error } = await supabase
    .from(table)
    .upsert(places, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`    Upsert error: ${error.message}`)
    return 0
  }

  return places.length
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== Retrying All Failed Queries ===')
  console.log(`Queries to retry: ${FAILED_QUERIES.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let successCount = 0
  let failCount = 0
  let totalPlaces = 0

  for (let i = 0; i < FAILED_QUERIES.length; i++) {
    const q = FAILED_QUERIES[i]
    console.log(`[${i + 1}/${FAILED_QUERIES.length}] ${q.name} - ${q.type}...`)

    try {
      const query = q.bbox
        ? buildBboxQuery(q.bbox, q.type)
        : buildIsoQuery(q.iso, q.type)

      const data = await queryOverpass(query)
      const places = extractPlaces(data, q.stateCode)

      const table = q.type === 'pizza' ? 'pizza_places' : 'taco_places'
      await upsertPlaces(places, table)

      console.log(`  Found ${places.length} places`)
      totalPlaces += places.length
      successCount++

    } catch (error) {
      console.log(`  Still failed: ${error.message}`)
      failCount++
    }

    // Wait between requests (except for last one)
    if (i < FAILED_QUERIES.length - 1) {
      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Retry Complete ===')
  console.log(`Succeeded: ${successCount}`)
  console.log(`Still failed: ${failCount}`)
  console.log(`Total places added: ${totalPlaces}`)
}

main().catch(console.error)
