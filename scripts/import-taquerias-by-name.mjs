#!/usr/bin/env node
/**
 * Import Taquerías by Name
 *
 * Supplements our taco coverage by searching for places with taco-related names
 * in Latin America. The cuisine-based query misses many taquerías because in
 * Mexico/Central America, they don't tag themselves as "Mexican" cuisine.
 *
 * Searches for: Taquería, Tacos, Taquiza, etc.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Countries to search (focus on where tacos are common)
const COUNTRIES = [
  { name: 'Mexico', iso: 'MX', stateCode: 'MX' },
  { name: 'Guatemala', iso: 'GT', stateCode: 'GT' },
  { name: 'El Salvador', iso: 'SV', stateCode: 'SV' },
  { name: 'Honduras', iso: 'HN', stateCode: 'HN' },
  { name: 'Nicaragua', iso: 'NI', stateCode: 'NI' },
  { name: 'Costa Rica', iso: 'CR', stateCode: 'CR' },
  { name: 'Panama', iso: 'PA', stateCode: 'PA' },
  { name: 'Colombia', iso: 'CO', stateCode: 'CO' },
  { name: 'Venezuela', iso: 'VE', stateCode: 'VE' },
  { name: 'Ecuador', iso: 'EC', stateCode: 'EC' },
  { name: 'Peru', iso: 'PE', stateCode: 'PE' },
]

function buildNameQuery(isoCode) {
  // Search for places with taco-related names
  return `
[out:json][timeout:120];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  node[amenity~"restaurant|fast_food"][name~"[Tt]aquer|[Tt]aco|[Tt]aquiza",i](area.searchArea);
  way[amenity~"restaurant|fast_food"][name~"[Tt]aquer|[Tt]aco|[Tt]aquiza",i](area.searchArea);
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

async function upsertPlaces(places) {
  if (places.length === 0) return { inserted: 0, duplicates: 0 }

  // Use upsert with ignoreDuplicates to handle existing places
  const { error, count } = await supabase
    .from('taco_places')
    .upsert(places, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`    Upsert error: ${error.message}`)
    return { inserted: 0, duplicates: places.length }
  }

  return { inserted: places.length, duplicates: 0 }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== Importing Taquerías by Name ===')
  console.log(`Countries to search: ${COUNTRIES.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`)
  console.log(`Searching for: Taquería, Tacos, Taquiza\n`)

  let totalFound = 0
  let totalNew = 0

  for (let i = 0; i < COUNTRIES.length; i++) {
    const country = COUNTRIES[i]
    console.log(`[${i + 1}/${COUNTRIES.length}] ${country.name}...`)

    try {
      const query = buildNameQuery(country.iso)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, country.stateCode)

      const result = await upsertPlaces(places)

      console.log(`  Found ${places.length} taquerías`)
      totalFound += places.length

    } catch (error) {
      console.log(`  Failed: ${error.message}`)
    }

    // Delay between requests (except last one)
    if (i < COUNTRIES.length - 1) {
      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total taquerías found: ${totalFound}`)
  console.log(`(Duplicates are automatically skipped)`)
}

main().catch(console.error)
