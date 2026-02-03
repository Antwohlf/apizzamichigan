#!/usr/bin/env node
/**
 * Import Street Food / Food Carts
 *
 * Finds pizza/taco vendors from street carts, food trucks, and stalls.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Regions with strong street food culture
// Note: Use 3-letter codes for countries that conflict with regional codes
const REGIONS = [
  // Latin America (strong taco cart culture)
  { name: 'Mexico', iso: 'MX', stateCode: 'MX' },
  { name: 'Guatemala', iso: 'GT', stateCode: 'GT' },
  { name: 'El Salvador', iso: 'SV', stateCode: 'SV' },
  { name: 'Colombia', iso: 'CO', stateCode: 'CO' },
  { name: 'Peru', iso: 'PE', stateCode: 'PE' },
  { name: 'Brazil', iso: 'BR', stateCode: 'BR' },
  { name: 'Argentina', iso: 'AR', stateCode: 'AR' },
  // US (food trucks)
  { name: 'United States', iso: 'US', stateCode: 'US' },
  // Europe (pizza by the slice, street vendors)
  { name: 'Italy', iso: 'IT', stateCode: 'IT' },
  { name: 'France', iso: 'FR', stateCode: 'FR' },
  { name: 'Germany', iso: 'DE', stateCode: 'DE' },
  { name: 'United Kingdom', iso: 'GB', stateCode: 'GB' },
  { name: 'Spain', iso: 'ES', stateCode: 'ES' },
  // Asia (use 3-letter codes for conflicting countries)
  { name: 'Thailand', iso: 'TH', stateCode: 'THA' },     // 3-letter: conflicts with Thuringia
  { name: 'Vietnam', iso: 'VN', stateCode: 'VN' },
  { name: 'Indonesia', iso: 'ID', stateCode: 'IDN' },    // 3-letter: conflicts with Idaho
  { name: 'Philippines', iso: 'PH', stateCode: 'PHL' },  // 3-letter: conflicts with Paraguay
  { name: 'India', iso: 'IN', stateCode: 'IND' },        // 3-letter: conflicts with Indiana
]

function buildStreetFoodQuery(isoCode, type) {
  const namePattern = type === 'pizza'
    ? '[Pp]izza|[Pp]izzeria'
    : '[Tt]aco|[Tt]aquer|[Bb]urrito'

  return `
[out:json][timeout:180];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  // Food trucks and carts
  node[amenity=fast_food][name~"${namePattern}",i]["cuisine"!~"."](area.searchArea);
  node[shop=food][name~"${namePattern}",i](area.searchArea);
  node[amenity=food_court][name~"${namePattern}",i](area.searchArea);
  // Street vendors
  node[shop=kiosk][name~"${namePattern}",i](area.searchArea);
  node[amenity=cafe][name~"${namePattern}",i](area.searchArea);
  // Takeaway only
  node[takeaway=only][name~"${namePattern}",i](area.searchArea);
  way[takeaway=only][name~"${namePattern}",i](area.searchArea);
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
  console.log('=== Importing Street Food / Food Carts ===')
  console.log(`Regions to search: ${REGIONS.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let totalPizza = 0
  let totalTacos = 0
  let queryCount = 0

  for (const region of REGIONS) {
    console.log(`\n${region.name}:`)

    for (const type of ['pizza', 'tacos']) {
      queryCount++
      console.log(`  Searching ${type} street food...`)

      try {
        const query = buildStreetFoodQuery(region.iso, type)
        const data = await queryOverpass(query)
        const places = extractPlaces(data, region.stateCode)

        const table = type === 'pizza' ? 'pizza_places' : 'taco_places'
        await upsertPlaces(places, table)

        console.log(`    Found ${places.length} ${type} vendors`)
        if (type === 'pizza') totalPizza += places.length
        else totalTacos += places.length

      } catch (error) {
        console.log(`    Failed: ${error.message}`)
      }

      if (queryCount < REGIONS.length * 2) {
        await delay(DELAY_BETWEEN_REQUESTS)
      }
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total pizza street vendors: ${totalPizza}`)
  console.log(`Total taco street vendors: ${totalTacos}`)
}

main().catch(console.error)
