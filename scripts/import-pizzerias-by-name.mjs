#!/usr/bin/env node
/**
 * Import Pizzerias by Name
 *
 * Finds pizza places by name pattern that might not have cuisine tags.
 * Similar to how we found taquerías in Latin America.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Focus on regions where name-based search would help most
// Note: Use 3-letter codes for countries that conflict with regional codes
const REGIONS = [
  // Asia (often poor cuisine tagging)
  { name: 'Japan', iso: 'JP', stateCode: 'JP' },
  { name: 'South Korea', iso: 'KR', stateCode: 'KR' },
  { name: 'China', iso: 'CN', stateCode: 'CHN' },        // 3-letter: conflicts with Canary Islands
  { name: 'India', iso: 'IN', stateCode: 'IND' },        // 3-letter: conflicts with Indiana
  { name: 'Indonesia', iso: 'ID', stateCode: 'IDN' },    // 3-letter: conflicts with Idaho
  { name: 'Thailand', iso: 'TH', stateCode: 'THA' },     // 3-letter: conflicts with Thuringia
  { name: 'Vietnam', iso: 'VN', stateCode: 'VN' },
  { name: 'Philippines', iso: 'PH', stateCode: 'PHL' },  // 3-letter: conflicts with Paraguay
  { name: 'Malaysia', iso: 'MY', stateCode: 'MY' },
  // Middle East
  { name: 'Turkey', iso: 'TR', stateCode: 'TUR' },       // 3-letter: conflicts with Venezuela
  { name: 'Saudi Arabia', iso: 'SA', stateCode: 'SAU' }, // 3-letter: conflicts with LatAm regions
  { name: 'UAE', iso: 'AE', stateCode: 'AE' },
  { name: 'Egypt', iso: 'EG', stateCode: 'EG' },
  { name: 'Israel', iso: 'IL', stateCode: 'IL' },
  // Africa
  { name: 'South Africa', iso: 'ZA', stateCode: 'ZAF' }, // 3-letter: conflicts with Guatemala
  { name: 'Nigeria', iso: 'NG', stateCode: 'NG' },
  { name: 'Kenya', iso: 'KE', stateCode: 'KE' },
  { name: 'Morocco', iso: 'MA', stateCode: 'MA' },
  // Eastern Europe (may have untagged places)
  { name: 'Russia', iso: 'RU', stateCode: 'RU' },
  { name: 'Ukraine', iso: 'UA', stateCode: 'UA' },
  { name: 'Poland', iso: 'PL', stateCode: 'PL' },
  // Oceania
  { name: 'Australia', iso: 'AU', stateCode: 'AU' },
  { name: 'New Zealand', iso: 'NZ', stateCode: 'NZ' },
]

function buildNameQuery(isoCode) {
  // Search for places with pizza-related names (case insensitive)
  // Includes various languages: Pizza, Pizzeria, Пицца (Russian), ピザ (Japanese), 피자 (Korean)
  return `
[out:json][timeout:180];
area["ISO3166-1"="${isoCode}"]->.searchArea;
(
  node[amenity~"restaurant|fast_food"][name~"[Pp]izza|[Pp]izzeria|Пицца|ピザ|피자",i](area.searchArea);
  way[amenity~"restaurant|fast_food"][name~"[Pp]izza|[Pp]izzeria|Пицца|ピザ|피자",i](area.searchArea);
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

async function upsertPlaces(places) {
  if (places.length === 0) return { inserted: 0, duplicates: 0 }

  const { error } = await supabase
    .from('pizza_places')
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
  console.log('=== Importing Pizzerias by Name ===')
  console.log(`Regions to search: ${REGIONS.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`)
  console.log(`Searching for: Pizza, Pizzeria, Пицца, ピザ, 피자\n`)

  let totalFound = 0

  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i]
    console.log(`[${i + 1}/${REGIONS.length}] ${region.name}...`)

    try {
      const query = buildNameQuery(region.iso)
      const data = await queryOverpass(query)
      const places = extractPlaces(data, region.stateCode)

      await upsertPlaces(places)
      console.log(`  Found ${places.length} pizzerias by name`)
      totalFound += places.length

    } catch (error) {
      console.log(`  Failed: ${error.message}`)
    }

    if (i < REGIONS.length - 1) {
      await delay(DELAY_BETWEEN_REQUESTS)
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total pizzerias found by name: ${totalFound}`)
  console.log(`(Duplicates are automatically skipped)`)
}

main().catch(console.error)
