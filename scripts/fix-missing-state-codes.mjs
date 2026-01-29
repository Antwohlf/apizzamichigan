#!/usr/bin/env node
/**
 * Fix missing state codes by reverse geocoding coordinates
 * Uses OpenStreetMap Nominatim API (free, no key required)
 *
 * Usage:
 *   node scripts/fix-missing-state-codes.mjs taco_places --dry-run
 *   node scripts/fix-missing-state-codes.mjs taco_places
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY must be set in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// US state name to code mapping
const STATE_CODES = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
  'puerto rico': 'PR', 'guam': 'GU', 'virgin islands': 'VI'
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Reverse geocode coordinates to get state
 */
async function getStateFromCoords(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'APizzaMichigan/1.0 (pizza map app)'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const address = data.address || {}

    // Try to get state from response
    const stateName = address.state || address.province || address.region || ''
    const stateCode = STATE_CODES[stateName.toLowerCase()]

    if (stateCode) {
      return stateCode
    }

    // Try to extract from ISO code (e.g., "US-CA")
    if (address['ISO3166-2-lvl4']) {
      const iso = address['ISO3166-2-lvl4']
      if (iso.startsWith('US-')) {
        return iso.replace('US-', '')
      }
    }

    return null
  } catch (error) {
    console.error(`  Geocode error for ${lat},${lng}: ${error.message}`)
    return null
  }
}

/**
 * Try to extract state code from address string
 */
function extractStateFromAddress(address) {
  if (!address) return null

  // Common patterns: "City, ST 12345" or "City, ST" or "Street, City, ST, 12345"
  const patterns = [
    /,\s*([A-Z]{2})\s*\d{5}/,  // ", CA 90210"
    /,\s*([A-Z]{2})\s*$/,      // ", CA"
    /,\s*([A-Z]{2}),/,         // ", CA,"
  ]

  for (const pattern of patterns) {
    const match = address.match(pattern)
    if (match && match[1]) {
      const code = match[1].toUpperCase()
      // Verify it's a valid state code
      if (Object.values(STATE_CODES).includes(code)) {
        return code
      }
    }
  }

  return null
}

async function main() {
  const tableName = process.argv[2] || 'taco_places'
  const dryRun = process.argv.includes('--dry-run')

  if (!['pizza_places', 'taco_places'].includes(tableName)) {
    console.error('Usage: node fix-missing-state-codes.mjs <pizza_places|taco_places> [--dry-run]')
    process.exit(1)
  }

  console.log(`\n=== Fixing missing state codes in ${tableName} ===`)
  if (dryRun) {
    console.log('=== DRY RUN MODE ===\n')
  }

  // Fetch places with missing state
  const { data: places, error } = await supabase
    .from(tableName)
    .select('id, name, address, lat, lng')
    .is('state', null)

  if (error) {
    console.error('Error fetching places:', error.message)
    process.exit(1)
  }

  console.log(`Found ${places.length} places with missing state code\n`)

  if (places.length === 0) {
    console.log('Nothing to fix!')
    return
  }

  const updates = []
  const failures = []

  for (const place of places) {
    console.log(`Processing: ${place.name} (ID: ${place.id})`)

    // First try to extract from address
    let stateCode = extractStateFromAddress(place.address)
    let source = 'address'

    // If not found, reverse geocode
    if (!stateCode && place.lat && place.lng) {
      stateCode = await getStateFromCoords(place.lat, place.lng)
      source = 'geocode'
      // Rate limit: Nominatim requires max 1 request per second
      await sleep(1100)
    }

    if (stateCode) {
      console.log(`  -> Found state: ${stateCode} (from ${source})`)
      updates.push({ id: place.id, state: stateCode, name: place.name })
    } else {
      console.log(`  -> Could not determine state`)
      failures.push(place)
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Found state for: ${updates.length}`)
  console.log(`Could not determine: ${failures.length}`)

  if (failures.length > 0) {
    console.log('\nPlaces that need manual review:')
    for (const place of failures) {
      console.log(`  ID ${place.id}: ${place.name} at ${place.lat},${place.lng}`)
    }
  }

  // Apply updates
  if (!dryRun && updates.length > 0) {
    console.log('\nApplying updates...')

    for (const update of updates) {
      const { error } = await supabase
        .from(tableName)
        .update({ state: update.state })
        .eq('id', update.id)

      if (error) {
        console.error(`  Error updating ${update.name}: ${error.message}`)
      } else {
        console.log(`  Updated ${update.name} -> ${update.state}`)
      }
    }

    console.log('\nDone!')
  } else if (dryRun) {
    console.log('\n=== DRY RUN - No changes made ===')
    console.log('Run without --dry-run to apply changes')
  }
}

main().catch(console.error)
