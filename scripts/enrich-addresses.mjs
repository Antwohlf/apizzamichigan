#!/usr/bin/env node
/**
 * Enrich missing addresses using reverse geocoding
 * Uses OpenStreetMap Nominatim API (free, 1 req/sec limit)
 *
 * Usage:
 *   node scripts/enrich-addresses.mjs pizza_places --dry-run
 *   node scripts/enrich-addresses.mjs pizza_places --limit=100
 *   node scripts/enrich-addresses.mjs taco_places --commit
 *   node scripts/enrich-addresses.mjs pizza_places --stats
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import 'dotenv/config'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY must be set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Progress file path
function getProgressFile(table) {
  return `scripts/.address-enrichment-${table}.json`
}

/**
 * Load progress from file
 */
function loadProgress(table) {
  const file = getProgressFile(table)
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return { processed: {}, lastId: null }
    }
  }
  return { processed: {}, lastId: null }
}

/**
 * Save progress to file
 */
function saveProgress(table, progress) {
  const file = getProgressFile(table)
  writeFileSync(file, JSON.stringify(progress, null, 2))
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Reverse geocode coordinates to get address
 */
async function getAddressFromCoords(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'APizzaMichigan/1.0 (pizza/taco map app)'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const addr = data.address || {}

    // Build address string
    const parts = []

    // Street address
    if (addr.house_number && addr.road) {
      parts.push(`${addr.house_number} ${addr.road}`)
    } else if (addr.road) {
      parts.push(addr.road)
    }

    // City
    const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb
    if (city) {
      parts.push(city)
    }

    // State
    let state = null
    if (addr['ISO3166-2-lvl4'] && addr['ISO3166-2-lvl4'].startsWith('US-')) {
      state = addr['ISO3166-2-lvl4'].replace('US-', '')
    }
    if (state) {
      parts.push(state)
    }

    // Zip code
    if (addr.postcode) {
      parts.push(addr.postcode)
    }

    const address = parts.length >= 2 ? parts.join(', ') : null

    return {
      address,
      state,
      city,
      raw: addr
    }
  } catch (error) {
    return { error: error.message }
  }
}

/**
 * Fetch places with missing addresses (with pagination)
 */
async function fetchPlacesNeedingAddresses(table, batchSize = 1000) {
  const { data, error } = await supabase
    .from(table)
    .select('id, name, lat, lng, address, state')
    .is('address', null)
    .order('id', { ascending: true })
    .limit(batchSize)

  if (error) {
    throw error
  }

  return data || []
}

/**
 * Get count of places still needing addresses
 */
async function countPlacesNeedingAddresses(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .is('address', null)

  if (error) {
    throw error
  }

  return count || 0
}

/**
 * Show stats
 */
async function showStats(table) {
  const { count: total } = await supabase.from(table).select('*', { count: 'exact', head: true })
  const { count: noAddr } = await supabase.from(table).select('*', { count: 'exact', head: true }).is('address', null)

  const progress = loadProgress(table)
  const processed = Object.keys(progress.processed).length

  console.log(`\n=== ${table} Address Stats ===`)
  console.log(`Total places: ${total}`)
  console.log(`With address: ${total - noAddr} (${Math.round((1 - noAddr/total)*100)}%)`)
  console.log(`Missing address: ${noAddr}`)
  console.log(`Already processed (in progress file): ${processed}`)
  console.log(`Remaining to process: ${Math.max(0, noAddr - processed)}`)
}

/**
 * Process a single batch of places
 */
async function processBatch(table, places, progress, commit) {
  let enriched = 0
  let failed = 0
  const updates = []

  for (let i = 0; i < places.length; i++) {
    const place = places[i]

    if (!place.lat || !place.lng) {
      console.log(`[${i+1}/${places.length}] ${place.name} - No coordinates, skipping`)
      progress.processed[place.id] = { skipped: 'no coordinates' }
      continue
    }

    console.log(`[${i+1}/${places.length}] ${place.name} (${place.lat}, ${place.lng})`)

    const result = await getAddressFromCoords(place.lat, place.lng)

    if (result.error) {
      console.log(`  -> Error: ${result.error}`)
      progress.processed[place.id] = { error: result.error }
      failed++
    } else if (result.address) {
      console.log(`  -> ${result.address}`)
      progress.processed[place.id] = { address: result.address, state: result.state }
      updates.push({
        id: place.id,
        address: result.address,
        state: result.state
      })
      enriched++
    } else {
      console.log(`  -> Could not build address from geocode result`)
      progress.processed[place.id] = { failed: 'insufficient data', raw: result.raw }
      failed++
    }

    // Save progress every 50 places
    if ((i + 1) % 50 === 0) {
      saveProgress(table, progress)
      console.log(`  [Progress saved: ${i+1}/${places.length}]`)
    }

    // Rate limit: 1 request per second
    if (i < places.length - 1) {
      await sleep(1100)
    }
  }

  // Save final progress for this batch
  saveProgress(table, progress)

  // Commit updates immediately for this batch
  if (commit && updates.length > 0) {
    console.log(`\nCommitting ${updates.length} updates...`)

    let committed = 0
    let errors = 0

    for (const update of updates) {
      const updateData = { address: update.address }
      if (update.state) {
        updateData.state = update.state
      }

      const { error } = await supabase
        .from(table)
        .update(updateData)
        .eq('id', update.id)

      if (error) {
        errors++
      } else {
        committed++
      }
    }

    console.log(`Committed ${committed} (${errors} errors)`)
  }

  return { enriched, failed }
}

async function main() {
  const args = process.argv.slice(2)
  const table = args.find(a => !a.startsWith('--')) || 'pizza_places'
  const dryRun = args.includes('--dry-run')
  const commit = args.includes('--commit')
  const statsOnly = args.includes('--stats')
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
  const batchSize = 1000

  if (!['pizza_places', 'taco_places'].includes(table)) {
    console.error('Usage: node enrich-addresses.mjs <pizza_places|taco_places> [--dry-run|--commit|--stats] [--limit=N]')
    process.exit(1)
  }

  if (statsOnly) {
    await showStats(table)
    return
  }

  console.log(`\n=== Address Enrichment for ${table} ===`)
  if (dryRun) console.log('MODE: Dry Run (preview only)')
  if (limit) console.log(`LIMIT: ${limit} places total`)

  // Load progress
  const progress = loadProgress(table)
  console.log(`Loaded progress: ${Object.keys(progress.processed).length} already processed in previous runs`)

  // Get total count
  const totalNeeding = await countPlacesNeedingAddresses(table)
  console.log(`Total places still needing addresses: ${totalNeeding}`)

  if (totalNeeding === 0) {
    console.log('All places have addresses!')
    return
  }

  let totalEnriched = 0
  let totalFailed = 0
  let batchNum = 0
  let remaining = limit || totalNeeding

  // Loop through batches until done
  while (remaining > 0) {
    batchNum++
    const thisBatchSize = Math.min(batchSize, remaining)

    console.log(`\n========== BATCH ${batchNum} (${thisBatchSize} places) ==========`)

    // Fetch next batch of places needing addresses
    const places = await fetchPlacesNeedingAddresses(table, thisBatchSize)

    if (places.length === 0) {
      console.log('No more places to process!')
      break
    }

    // Filter out already processed (shouldn't happen but just in case)
    const toProcess = places.filter(p => !progress.processed[p.id])

    if (toProcess.length === 0) {
      console.log('All fetched places already processed, fetching next batch...')
      continue
    }

    console.log(`Processing ${toProcess.length} places...`)

    const { enriched, failed } = await processBatch(table, toProcess, progress, commit)

    totalEnriched += enriched
    totalFailed += failed
    remaining -= toProcess.length

    // Check how many are left
    const stillNeeding = await countPlacesNeedingAddresses(table)
    console.log(`\nBatch ${batchNum} complete. Still needing addresses: ${stillNeeding}`)

    if (stillNeeding === 0) {
      console.log('All done!')
      break
    }
  }

  console.log(`\n========== FINAL SUMMARY ==========`)
  console.log(`Total batches: ${batchNum}`)
  console.log(`Total enriched: ${totalEnriched}`)
  console.log(`Total failed: ${totalFailed}`)

  if (!commit) {
    console.log('\nRun with --commit to save to database')
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
