#!/usr/bin/env node
/**
 * Retry Failed 504 Queries
 *
 * Retries queries that timed out with simpler patterns.
 * Breaks large regex patterns into smaller chunks (3-4 alternatives).
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Break taco cuisines into smaller chunks (3-4 each)
const TACO_CUISINE_CHUNKS = [
  ['burrito', 'quesadilla', 'latin_american'],
  ['central_american', 'south_american', 'salvadoran'],
  ['guatemalan', 'honduran', 'nicaraguan'],
  ['colombian', 'peruvian', 'venezuelan', 'cuban'],
]

// Pizza cuisines that failed (smaller list)
const PIZZA_CUISINES = [
  'neapolitan', 'napoletana', 'roman_pizza',
  'sicilian', 'new_york_pizza', 'chicago_pizza',
  'detroit_pizza', 'flatbread', 'focaccia',
]

// Failed taco cuisine queries (from additional-cuisines script)
const FAILED_TACO_CUISINES = [
  { name: 'United States', iso: 'US', stateCode: 'US' },
  { name: 'Canada', iso: 'CA', stateCode: 'CA' },
  { name: 'Mexico', iso: 'MX', stateCode: 'MX' },
  { name: 'Brazil', iso: 'BR', stateCode: 'BR' },
  { name: 'Argentina', iso: 'AR', stateCode: 'AR' },
  { name: 'Colombia', iso: 'CO', stateCode: 'CO' },
  { name: 'Chile', iso: 'CL', stateCode: 'CL' },
  { name: 'Spain', iso: 'ES', stateCode: 'ES' },
  { name: 'Belgium', iso: 'BE', stateCode: 'BE' },
  { name: 'Austria', iso: 'AT', stateCode: 'AT' },
  { name: 'South Korea', iso: 'KR', stateCode: 'KR' },
  { name: 'India', iso: 'IN', stateCode: 'IN' },
]

// Failed pizza cuisine queries
const FAILED_PIZZA_CUISINES = [
  { name: 'Brazil', iso: 'BR', stateCode: 'BR' },
  { name: 'United Kingdom', iso: 'GB', stateCode: 'GB' },
  { name: 'Netherlands', iso: 'NL', stateCode: 'NL' },
  { name: 'Japan', iso: 'JP', stateCode: 'JP' },
  { name: 'India', iso: 'IN', stateCode: 'IN' },
  { name: 'Thailand', iso: 'TH', stateCode: 'TH' },
]

// Failed street food queries
const FAILED_STREET_FOOD = [
  // Tacos
  { name: 'Mexico', iso: 'MX', stateCode: 'MX', type: 'tacos' },
  { name: 'El Salvador', iso: 'SV', stateCode: 'SV', type: 'tacos' },
  { name: 'Brazil', iso: 'BR', stateCode: 'BR', type: 'tacos' },
  { name: 'Spain', iso: 'ES', stateCode: 'ES', type: 'tacos' },
  { name: 'Thailand', iso: 'TH', stateCode: 'TH', type: 'tacos' },
  { name: 'Thailand', iso: 'TH', stateCode: 'TH', type: 'pizza' },
  // Pizza
  { name: 'Peru', iso: 'PE', stateCode: 'PE', type: 'pizza' },
  { name: 'Argentina', iso: 'AR', stateCode: 'AR', type: 'pizza' },
  { name: 'India', iso: 'IN', stateCode: 'IN', type: 'pizza' },
]

// Failed chain queries - split into smaller chain groups
const PIZZA_CHAIN_CHUNKS = [
  ["Domino's", "Pizza Hut", "Papa John's", "Little Caesars"],
  ["Papa Murphy's", "Marco's Pizza", "Jet's Pizza", "Round Table Pizza"],
  ["Sbarro", "Cicis", "Godfather's Pizza", "Hungry Howie's"],
  ["Mellow Mushroom", "Blaze Pizza", "MOD Pizza", "Pieology"],
  ["Pie Five", "Mountain Mike's", "Pizza Ranch", "Giordano's"],
  ["Lou Malnati's", "Telepizza", "Pizza Express", "Pizza Hut Express"],
]

const TACO_CHAIN_CHUNKS = [
  ["Taco Bell", "Del Taco", "Chipotle", "Qdoba"],
  ["Moe's Southwest", "Taco Cabana", "Taco John's", "Taco Bueno"],
  ["Chronic Tacos", "Fuzzy's Taco", "Torchy's Tacos", "Velvet Taco"],
]

const FAILED_CHAINS = [
  { name: 'Canada', iso: 'CA', stateCode: 'CA', type: 'pizza' },
  { name: 'France', iso: 'FR', stateCode: 'FR', type: 'taco' },
  { name: 'South Korea', iso: 'KR', stateCode: 'KR', type: 'taco' },
  { name: 'India', iso: 'IN', stateCode: 'IN', type: 'pizza' },
  { name: 'UAE', iso: 'AE', stateCode: 'AE', type: 'pizza' },
  { name: 'Indonesia', iso: 'ID', stateCode: 'ID', type: 'taco' },
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

function buildStreetFoodQuery(isoCode, type) {
  const namePattern = type === 'pizza'
    ? '[Pp]izza|[Pp]izzeria'
    : '[Tt]aco|[Tt]aquer|[Bb]urrito'

  return `
[out:json][timeout:180];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  node[amenity=fast_food][name~"${namePattern}",i]["cuisine"!~"."](area.searchArea);
  node[shop=food][name~"${namePattern}",i](area.searchArea);
  node[amenity=food_court][name~"${namePattern}",i](area.searchArea);
  node[shop=kiosk][name~"${namePattern}",i](area.searchArea);
  node[amenity=cafe][name~"${namePattern}",i](area.searchArea);
  node[takeaway=only][name~"${namePattern}",i](area.searchArea);
  way[takeaway=only][name~"${namePattern}",i](area.searchArea);
);
out center;`
}

function buildChainQuery(isoCode, chains) {
  const pattern = chains.map(c => c.replace(/'/g, ".")).join('|')
  return `
[out:json][timeout:180];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  node[amenity~"restaurant|fast_food"][name~"${pattern}",i](area.searchArea);
  way[amenity~"restaurant|fast_food"][name~"${pattern}",i](area.searchArea);
  node[brand~"${pattern}",i](area.searchArea);
  way[brand~"${pattern}",i](area.searchArea);
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

    if (!lat || !lon) continue

    const name = tags.name || tags.brand
    if (!name) continue

    const stateValue = (tags['addr:state'] || stateCode).substring(0, 10)

    places.push({
      google_place_id: `osm:${element.type}/${element.id}`,
      name,
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
  console.log('=== Retrying Failed 504 Queries ===')
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let totalPizza = 0
  let totalTacos = 0

  // 1. Retry taco cuisines with chunked patterns
  console.log('\n--- Retrying Taco Cuisines (chunked) ---')
  for (const country of FAILED_TACO_CUISINES) {
    console.log(`\n${country.name}:`)

    for (let i = 0; i < TACO_CUISINE_CHUNKS.length; i++) {
      const chunk = TACO_CUISINE_CHUNKS[i]
      console.log(`  Chunk ${i + 1}/${TACO_CUISINE_CHUNKS.length}: ${chunk.join(', ')}`)

      try {
        const query = buildCuisineQuery(country.iso, chunk)
        const data = await queryOverpass(query)
        const places = extractPlaces(data, country.stateCode)
        await upsertPlaces(places, 'taco_places')
        console.log(`    Found ${places.length} places`)
        totalTacos += places.length
      } catch (error) {
        console.log(`    Failed: ${error.message}`)
      }

      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  // 2. Retry pizza cuisines
  console.log('\n--- Retrying Pizza Cuisines ---')
  for (const country of FAILED_PIZZA_CUISINES) {
    console.log(`\n${country.name}:`)

    try {
      const query = buildCuisineQuery(country.iso, PIZZA_CUISINES)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, country.stateCode)
      await upsertPlaces(places, 'pizza_places')
      console.log(`  Found ${places.length} places`)
      totalPizza += places.length
    } catch (error) {
      console.log(`  Failed: ${error.message}`)
    }

    await delay(DELAY_BETWEEN_REQUESTS)
  }

  // 3. Retry street food
  console.log('\n--- Retrying Street Food ---')
  for (const item of FAILED_STREET_FOOD) {
    console.log(`\n${item.name} (${item.type}):`)

    try {
      const query = buildStreetFoodQuery(item.iso, item.type)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, item.stateCode)
      const table = item.type === 'pizza' ? 'pizza_places' : 'taco_places'
      await upsertPlaces(places, table)
      console.log(`  Found ${places.length} ${item.type} vendors`)
      if (item.type === 'pizza') totalPizza += places.length
      else totalTacos += places.length
    } catch (error) {
      console.log(`  Failed: ${error.message}`)
    }

    await delay(DELAY_BETWEEN_REQUESTS)
  }

  // 4. Retry chains with chunked patterns
  console.log('\n--- Retrying Chains (chunked) ---')
  for (const item of FAILED_CHAINS) {
    console.log(`\n${item.name} (${item.type} chains):`)

    const chunks = item.type === 'pizza' ? PIZZA_CHAIN_CHUNKS : TACO_CHAIN_CHUNKS
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      console.log(`  Chunk ${i + 1}/${chunks.length}: ${chunk.slice(0, 2).join(', ')}...`)

      try {
        const query = buildChainQuery(item.iso, chunk)
        const data = await queryOverpass(query)
        const places = extractPlaces(data, item.stateCode)
        const table = item.type === 'pizza' ? 'pizza_places' : 'taco_places'
        await upsertPlaces(places, table)
        console.log(`    Found ${places.length} locations`)
        if (item.type === 'pizza') totalPizza += places.length
        else totalTacos += places.length
      } catch (error) {
        console.log(`    Failed: ${error.message}`)
      }

      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Retry Complete ===')
  console.log(`Total pizza places recovered: ${totalPizza}`)
  console.log(`Total taco places recovered: ${totalTacos}`)
}

main().catch(console.error)
