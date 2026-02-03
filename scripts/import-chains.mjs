#!/usr/bin/env node
/**
 * Import Pizza and Taco Chains
 *
 * Searches for major chains by name that might not have cuisine tags.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Major chains to search for
const PIZZA_CHAINS = [
  "Domino's",
  "Pizza Hut",
  "Papa John's",
  "Little Caesars",
  "Papa Murphy's",
  "Marco's Pizza",
  "Jet's Pizza",
  "Round Table Pizza",
  "Sbarro",
  "Cicis",
  "Godfather's Pizza",
  "Hungry Howie's",
  "Mellow Mushroom",
  "Blaze Pizza",
  "MOD Pizza",
  "Pieology",
  "Pie Five",
  "Mountain Mike's",
  "Pizza Ranch",
  "Giordano's",
  "Lou Malnati's",
  // International chains
  "Telepizza",
  "Pizza Express",
  "Pizza Hut Express",
  "Tutti Pizza",
  "Pizza Marzano",
]

const TACO_CHAINS = [
  "Taco Bell",
  "Del Taco",
  "Chipotle",
  "Qdoba",
  "Moe's Southwest",
  "Taco Cabana",
  "Taco John's",
  "Taco Bueno",
  "Chronic Tacos",
  "Fuzzy's Taco",
  "Torchy's Tacos",
  "Velvet Taco",
  "Taco Casa",
  // International
  "Taco Maker",
  "Taco Time",
]

// Regions to search (global)
const REGIONS = [
  { name: 'United States', iso: 'US', stateCode: 'US' },
  { name: 'Canada', iso: 'CA', stateCode: 'CA' },
  { name: 'Mexico', iso: 'MX', stateCode: 'MX' },
  { name: 'United Kingdom', iso: 'GB', stateCode: 'GB' },
  { name: 'Germany', iso: 'DE', stateCode: 'DE' },
  { name: 'France', iso: 'FR', stateCode: 'FR' },
  { name: 'Spain', iso: 'ES', stateCode: 'ES' },
  { name: 'Italy', iso: 'IT', stateCode: 'IT' },
  { name: 'Australia', iso: 'AU', stateCode: 'AU' },
  { name: 'Japan', iso: 'JP', stateCode: 'JP' },
  { name: 'South Korea', iso: 'KR', stateCode: 'KR' },
  { name: 'China', iso: 'CN', stateCode: 'CN' },
  { name: 'India', iso: 'IN', stateCode: 'IN' },
  { name: 'Brazil', iso: 'BR', stateCode: 'BR' },
  { name: 'Russia', iso: 'RU', stateCode: 'RU' },
  { name: 'South Africa', iso: 'ZA', stateCode: 'ZA' },
  { name: 'UAE', iso: 'AE', stateCode: 'AE' },
  { name: 'Saudi Arabia', iso: 'SA', stateCode: 'SA' },
  { name: 'Philippines', iso: 'PH', stateCode: 'PH' },
  { name: 'Indonesia', iso: 'ID', stateCode: 'ID' },
]

function buildChainQuery(isoCode, chains) {
  // Build regex pattern for all chains
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

    const name = tags.name || tags.brand || 'Unknown'
    if (name === 'Unknown') continue

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
  console.log('=== Importing Pizza & Taco Chains ===')
  console.log(`Regions to search: ${REGIONS.length}`)
  console.log(`Pizza chains: ${PIZZA_CHAINS.length}`)
  console.log(`Taco chains: ${TACO_CHAINS.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let totalPizza = 0
  let totalTacos = 0
  let queryCount = 0

  for (const region of REGIONS) {
    console.log(`\n${region.name}:`)

    // Pizza chains
    try {
      console.log(`  Searching pizza chains...`)
      const query = buildChainQuery(region.iso, PIZZA_CHAINS)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, region.stateCode)
      await upsertPlaces(places, 'pizza_places')
      console.log(`    Found ${places.length} pizza chain locations`)
      totalPizza += places.length
      queryCount++
    } catch (error) {
      console.log(`    Pizza chains failed: ${error.message}`)
    }

    await delay(DELAY_BETWEEN_REQUESTS)

    // Taco chains
    try {
      console.log(`  Searching taco chains...`)
      const query = buildChainQuery(region.iso, TACO_CHAINS)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, region.stateCode)
      await upsertPlaces(places, 'taco_places')
      console.log(`    Found ${places.length} taco chain locations`)
      totalTacos += places.length
      queryCount++
    } catch (error) {
      console.log(`    Taco chains failed: ${error.message}`)
    }

    if (queryCount < REGIONS.length * 2) {
      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total pizza chains: ${totalPizza}`)
  console.log(`Total taco chains: ${totalTacos}`)
}

main().catch(console.error)
