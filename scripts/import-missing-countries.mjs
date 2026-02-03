#!/usr/bin/env node
/**
 * Import Missing Countries
 *
 * Adds the 10 countries missing from our worldwide coverage:
 * - Mauritania, Djibouti (real gaps)
 * - European microstates: Andorra, Monaco, Liechtenstein, San Marino, Vatican
 * - Pacific islands: Kiribati, Nauru, Tuvalu
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Missing countries (all use ISO queries since they're small)
const MISSING_COUNTRIES = [
  // Real gaps
  { name: 'Mauritania', iso: 'MR', stateCode: 'MR' },
  { name: 'Djibouti', iso: 'DJ', stateCode: 'DJ' },
  // European microstates
  { name: 'Andorra', iso: 'AD', stateCode: 'AD' },
  { name: 'Monaco', iso: 'MC', stateCode: 'MC' },
  { name: 'Liechtenstein', iso: 'LI', stateCode: 'LI' },
  { name: 'San Marino', iso: 'SM', stateCode: 'SM' },
  { name: 'Vatican', iso: 'VA', stateCode: 'VA' },
  // Pacific islands
  { name: 'Kiribati', iso: 'KI', stateCode: 'KI' },
  { name: 'Nauru', iso: 'NR', stateCode: 'NR' },
  { name: 'Tuvalu', iso: 'TV', stateCode: 'TV' },
]

function buildIsoQuery(isoCode, type) {
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'
  return `
[out:json][timeout:90];
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
  console.log('=== Importing Missing Countries ===')
  console.log(`Countries to import: ${MISSING_COUNTRIES.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let totalPlaces = 0
  let queryCount = 0

  for (const country of MISSING_COUNTRIES) {
    console.log(`\n${country.name}:`)

    for (const type of ['pizza', 'tacos']) {
      queryCount++
      console.log(`  Querying ${country.name} for ${type}...`)

      try {
        const query = buildIsoQuery(country.iso, type)
        const data = await queryOverpass(query)
        const places = extractPlaces(data, country.stateCode)

        const table = type === 'pizza' ? 'pizza_places' : 'taco_places'
        await upsertPlaces(places, table)

        console.log(`    Found ${places.length} ${type} places`)
        totalPlaces += places.length

      } catch (error) {
        console.log(`    Failed: ${error.message}`)
      }

      // Delay between requests
      if (queryCount < MISSING_COUNTRIES.length * 2) {
        await delay(DELAY_BETWEEN_REQUESTS)
      }
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total places added: ${totalPlaces}`)
}

main().catch(console.error)
