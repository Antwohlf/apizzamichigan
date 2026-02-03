#!/usr/bin/env node
/**
 * Import Additional Cuisine Tags
 *
 * Searches for cuisine tags we might have missed in the original import.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Additional cuisine tags to search
const PIZZA_CUISINES = [
  'neapolitan',
  'napoletana',
  'roman_pizza',
  'sicilian',
  'new_york_pizza',
  'chicago_pizza',
  'detroit_pizza',
  'flatbread',
  'focaccia',
]

const TACO_CUISINES = [
  'burrito',
  'quesadilla',
  'latin_american',
  'central_american',
  'south_american',
  'salvadoran',
  'guatemalan',
  'honduran',
  'nicaraguan',
  'colombian',
  'peruvian',
  'venezuelan',
  'cuban',
]

// All countries (global search)
const COUNTRIES = [
  // Americas
  { name: 'United States', iso: 'US', stateCode: 'US' },
  { name: 'Canada', iso: 'CA', stateCode: 'CA' },
  { name: 'Mexico', iso: 'MX', stateCode: 'MX' },
  { name: 'Brazil', iso: 'BR', stateCode: 'BR' },
  { name: 'Argentina', iso: 'AR', stateCode: 'AR' },
  { name: 'Colombia', iso: 'CO', stateCode: 'CO' },
  { name: 'Peru', iso: 'PE', stateCode: 'PE' },
  { name: 'Chile', iso: 'CL', stateCode: 'CL' },
  // Europe
  { name: 'Italy', iso: 'IT', stateCode: 'IT' },
  { name: 'Germany', iso: 'DE', stateCode: 'DE' },
  { name: 'France', iso: 'FR', stateCode: 'FR' },
  { name: 'Spain', iso: 'ES', stateCode: 'ES' },
  { name: 'United Kingdom', iso: 'GB', stateCode: 'GB' },
  { name: 'Netherlands', iso: 'NL', stateCode: 'NL' },
  { name: 'Belgium', iso: 'BE', stateCode: 'BE' },
  { name: 'Austria', iso: 'AT', stateCode: 'AT' },
  { name: 'Switzerland', iso: 'CH', stateCode: 'CH' },
  { name: 'Poland', iso: 'PL', stateCode: 'PL' },
  // Asia-Pacific
  { name: 'Australia', iso: 'AU', stateCode: 'AU' },
  { name: 'Japan', iso: 'JP', stateCode: 'JP' },
  { name: 'South Korea', iso: 'KR', stateCode: 'KR' },
  { name: 'China', iso: 'CN', stateCode: 'CN' },
  { name: 'India', iso: 'IN', stateCode: 'IN' },
  { name: 'Thailand', iso: 'TH', stateCode: 'TH' },
  { name: 'Singapore', iso: 'SG', stateCode: 'SG' },
]

function buildCuisineQuery(isoCode, cuisines) {
  const pattern = cuisines.join('|')
  return `
[out:json][timeout:180];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  node[amenity~"restaurant|fast_food"][cuisine~"${pattern}",i](area.searchArea);
  way[amenity~"restaurant|fast_food"][cuisine~"${pattern}",i](area.searchArea);
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
  console.log('=== Importing Additional Cuisine Tags ===')
  console.log(`Countries to search: ${COUNTRIES.length}`)
  console.log(`Pizza cuisines: ${PIZZA_CUISINES.join(', ')}`)
  console.log(`Taco cuisines: ${TACO_CUISINES.join(', ')}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let totalPizza = 0
  let totalTacos = 0
  let queryCount = 0

  for (const country of COUNTRIES) {
    console.log(`\n${country.name}:`)

    // Pizza cuisines
    try {
      console.log(`  Searching pizza cuisines...`)
      const query = buildCuisineQuery(country.iso, PIZZA_CUISINES)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, country.stateCode)
      await upsertPlaces(places, 'pizza_places')
      console.log(`    Found ${places.length} places with specialty pizza cuisines`)
      totalPizza += places.length
      queryCount++
    } catch (error) {
      console.log(`    Pizza cuisines failed: ${error.message}`)
    }

    await delay(DELAY_BETWEEN_REQUESTS)

    // Taco cuisines
    try {
      console.log(`  Searching taco-related cuisines...`)
      const query = buildCuisineQuery(country.iso, TACO_CUISINES)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, country.stateCode)
      await upsertPlaces(places, 'taco_places')
      console.log(`    Found ${places.length} places with Latin American cuisines`)
      totalTacos += places.length
      queryCount++
    } catch (error) {
      console.log(`    Taco cuisines failed: ${error.message}`)
    }

    if (queryCount < COUNTRIES.length * 2) {
      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total specialty pizza places: ${totalPizza}`)
  console.log(`Total Latin American cuisine places: ${totalTacos}`)
}

main().catch(console.error)
