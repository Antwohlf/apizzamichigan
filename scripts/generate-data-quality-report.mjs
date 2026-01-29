#!/usr/bin/env node
/**
 * Data Quality Report Generator
 * Identifies potential duplicates, missing addresses, and data issues
 *
 * Usage:
 *   node scripts/generate-data-quality-report.mjs                    # Report on pizza_places (default)
 *   node scripts/generate-data-quality-report.mjs taco_places        # Report on taco_places
 *   node scripts/generate-data-quality-report.mjs pizza_places MI    # Filter by state
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

/**
 * Haversine formula to calculate distance between two points
 */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Normalize a name for comparison
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function generateReport(tableName, stateFilter = null) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`DATA QUALITY REPORT: ${tableName}`)
  if (stateFilter) {
    console.log(`Filtered by state: ${stateFilter}`)
  }
  console.log(`${'='.repeat(60)}\n`)

  // Fetch all places with pagination
  let allData = []
  let offset = 0
  const pageSize = 1000

  console.log('Fetching data from database...')

  while (true) {
    let query = supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + pageSize - 1)

    if (stateFilter) {
      query = query.eq('state', stateFilter)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Supabase error: ${error.message}`)
    }

    allData = allData.concat(data)

    if (data.length < pageSize) {
      break
    }
    offset += pageSize
  }

  console.log(`Total records: ${allData.length}\n`)

  // === Issue 1: Missing addresses ===
  const missingAddress = allData.filter(p => !p.address || p.address.trim() === '')
  const addressPercent = ((allData.length - missingAddress.length) / allData.length * 100).toFixed(1)
  console.log(`--- ADDRESSES ---`)
  console.log(`  With address: ${allData.length - missingAddress.length} (${addressPercent}%)`)
  console.log(`  Missing address: ${missingAddress.length} (${(100 - parseFloat(addressPercent)).toFixed(1)}%)`)

  // === Issue 2: Missing state ===
  const missingState = allData.filter(p => !p.state)
  console.log(`\n--- STATES ---`)
  console.log(`  Missing state code: ${missingState.length}`)

  // === Issue 3: Potential duplicates (same name, different location) ===
  console.log(`\n--- DUPLICATE NAME ANALYSIS ---`)

  const nameGroups = {}
  for (const place of allData) {
    const normalized = normalizeName(place.name)
    if (!nameGroups[normalized]) {
      nameGroups[normalized] = []
    }
    nameGroups[normalized].push(place)
  }

  // Find names with multiple entries
  const duplicateNameGroups = Object.entries(nameGroups)
    .filter(([, places]) => places.length > 1)
    .sort((a, b) => b[1].length - a[1].length)

  console.log(`  Total unique names: ${Object.keys(nameGroups).length}`)
  console.log(`  Names with multiple entries: ${duplicateNameGroups.length}`)

  // Separate into likely chains vs potential duplicates
  const likelyChains = []
  const potentialDuplicates = []

  for (const [name, places] of duplicateNameGroups) {
    // Check average distance between locations
    let totalDistance = 0
    let distanceCount = 0

    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        const dist = getDistanceMeters(
          places[i].lat, places[i].lng,
          places[j].lat, places[j].lng
        )
        totalDistance += dist
        distanceCount++
      }
    }

    const avgDistanceKm = distanceCount > 0 ? (totalDistance / distanceCount) / 1000 : 0

    // If locations are spread out (>10km average), likely a chain
    // If close together (<1km), likely duplicates
    if (avgDistanceKm > 10) {
      likelyChains.push({ name, places, avgDistanceKm })
    } else if (avgDistanceKm < 1) {
      potentialDuplicates.push({ name, places, avgDistanceKm })
    }
  }

  console.log(`\n  Likely chain restaurants (avg distance >10km): ${likelyChains.length}`)
  console.log(`  Potential duplicates (avg distance <1km): ${potentialDuplicates.length}`)

  // Show top potential duplicates
  if (potentialDuplicates.length > 0) {
    console.log(`\n  TOP POTENTIAL DUPLICATES (need manual review):`)
    for (const { name, places, avgDistanceKm } of potentialDuplicates.slice(0, 15)) {
      console.log(`\n    "${places[0].name}" - ${places.length} entries, avg ${(avgDistanceKm * 1000).toFixed(0)}m apart`)
      for (const p of places.slice(0, 5)) {
        const addr = p.address || 'no address'
        const status = p.status || 'unknown'
        console.log(`      ID ${p.id}: ${addr} [${status}]`)
      }
      if (places.length > 5) {
        console.log(`      ... and ${places.length - 5} more`)
      }
    }
  }

  // === Issue 4: Invalid coordinates ===
  const invalidCoords = allData.filter(p =>
    !p.lat || !p.lng ||
    typeof p.lat !== 'number' || typeof p.lng !== 'number' ||
    p.lat < -90 || p.lat > 90 ||
    p.lng < -180 || p.lng > 180
  )
  console.log(`\n--- COORDINATES ---`)
  console.log(`  Invalid/missing coordinates: ${invalidCoords.length}`)

  // === Issue 5: Status distribution ===
  const statusCounts = {}
  for (const place of allData) {
    const status = place.status || 'null'
    statusCounts[status] = (statusCounts[status] || 0) + 1
  }
  console.log(`\n--- STATUS DISTRIBUTION ---`)
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`)
  }

  // === Summary ===
  console.log(`\n${'='.repeat(60)}`)
  console.log(`SUMMARY`)
  console.log(`${'='.repeat(60)}`)
  console.log(`Total records: ${allData.length}`)
  console.log(`Missing address: ${missingAddress.length}`)
  console.log(`Potential duplicates to review: ${potentialDuplicates.length} groups`)
  console.log(`Missing state: ${missingState.length}`)
  console.log(`Invalid coordinates: ${invalidCoords.length}`)

  return {
    total: allData.length,
    missingAddress: missingAddress.length,
    potentialDuplicates: potentialDuplicates.length,
    missingState: missingState.length,
    invalidCoords: invalidCoords.length,
    duplicateGroups: potentialDuplicates,
  }
}

async function main() {
  const tableName = process.argv[2] || 'pizza_places'
  const stateFilter = process.argv[3] || null

  if (!['pizza_places', 'taco_places'].includes(tableName)) {
    console.error('Error: table must be "pizza_places" or "taco_places"')
    process.exit(1)
  }

  try {
    await generateReport(tableName, stateFilter)
  } catch (error) {
    console.error('Error generating report:', error.message)
    process.exit(1)
  }
}

main()
