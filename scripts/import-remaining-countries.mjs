#!/usr/bin/env node
/**
 * Import Remaining Countries
 *
 * Completes world coverage by importing the ~40 missing UN member states:
 * - 36 Sub-Saharan African countries
 * - 3 Caucasus countries (Armenia, Azerbaijan, Georgia)
 * - 1 Pacific (Solomon Islands)
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DELAY_BETWEEN_REQUESTS = 60000 // 60 seconds

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// All remaining countries (ISO code queries work for all of these)
const REMAINING_COUNTRIES = [
  // Caucasus (3)
  { name: 'Armenia', iso: 'AM', stateCode: 'AM' },
  { name: 'Azerbaijan', iso: 'AZ', stateCode: 'AZ' },
  { name: 'Georgia', iso: 'GE', stateCode: 'GE' },

  // Pacific (1)
  { name: 'Solomon Islands', iso: 'SB', stateCode: 'SB' },

  // Sub-Saharan Africa (36)
  { name: 'Angola', iso: 'AO', stateCode: 'AO' },
  { name: 'Benin', iso: 'BJ', stateCode: 'BJ' },
  { name: 'Botswana', iso: 'BW', stateCode: 'BW' },
  { name: 'Burkina Faso', iso: 'BF', stateCode: 'BF' },
  { name: 'Burundi', iso: 'BI', stateCode: 'BI' },
  { name: 'Cape Verde', iso: 'CV', stateCode: 'CV' },
  { name: 'Cameroon', iso: 'CM', stateCode: 'CM' },
  { name: 'Central African Republic', iso: 'CF', stateCode: 'CF' },
  { name: 'Chad', iso: 'TD', stateCode: 'TD' },
  { name: 'Comoros', iso: 'KM', stateCode: 'KM' },
  { name: 'Congo', iso: 'CG', stateCode: 'CG' },
  { name: 'DR Congo', iso: 'CD', stateCode: 'CD' },
  { name: 'Equatorial Guinea', iso: 'GQ', stateCode: 'GQ' },
  { name: 'Eritrea', iso: 'ER', stateCode: 'ER' },
  { name: 'Eswatini', iso: 'SZ', stateCode: 'SZ' },
  { name: 'Gabon', iso: 'GA', stateCode: 'GA' },
  { name: 'Gambia', iso: 'GM', stateCode: 'GM' },
  { name: 'Guinea', iso: 'GN', stateCode: 'GN' },
  { name: 'Guinea-Bissau', iso: 'GW', stateCode: 'GW' },
  { name: 'Lesotho', iso: 'LS', stateCode: 'LS' },
  { name: 'Liberia', iso: 'LR', stateCode: 'LR' },
  { name: 'Libya', iso: 'LY', stateCode: 'LY' },
  { name: 'Madagascar', iso: 'MG', stateCode: 'MG' },
  { name: 'Malawi', iso: 'MW', stateCode: 'MW' },
  { name: 'Mali', iso: 'ML', stateCode: 'ML' },
  { name: 'Mozambique', iso: 'MZ', stateCode: 'MZ' },
  { name: 'Namibia', iso: 'NA', stateCode: 'NA' },
  { name: 'Niger', iso: 'NE', stateCode: 'NE' },
  { name: 'São Tomé and Príncipe', iso: 'ST', stateCode: 'ST' },
  { name: 'Seychelles', iso: 'SC', stateCode: 'SC' },
  { name: 'Sierra Leone', iso: 'SL', stateCode: 'SL' },
  { name: 'Somalia', iso: 'SO', stateCode: 'SO' },
  { name: 'South Sudan', iso: 'SS', stateCode: 'SS' },
  { name: 'Sudan', iso: 'SD', stateCode: 'SD' },
  { name: 'Togo', iso: 'TG', stateCode: 'TG' },
  { name: 'Zambia', iso: 'ZM', stateCode: 'ZM' },
  { name: 'Zimbabwe', iso: 'ZW', stateCode: 'ZW' },
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
  console.log('=== Importing Remaining Countries ===')
  console.log(`Countries to import: ${REMAINING_COUNTRIES.length}`)
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`)

  let totalPlaces = 0
  let queryCount = 0
  let failedQueries = []

  for (const country of REMAINING_COUNTRIES) {
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
        failedQueries.push({ country: country.name, iso: country.iso, type, error: error.message })
      }

      // Delay between requests
      if (queryCount < REMAINING_COUNTRIES.length * 2) {
        await delay(DELAY_BETWEEN_REQUESTS)
      }
    }
  }

  console.log('\n=== Import Complete ===')
  console.log(`Total places added: ${totalPlaces}`)
  console.log(`Failed queries: ${failedQueries.length}`)

  if (failedQueries.length > 0) {
    console.log('\nFailed queries:')
    failedQueries.forEach(q => console.log(`  ${q.country} (${q.iso}) - ${q.type}: ${q.error}`))
  }
}

main().catch(console.error)
