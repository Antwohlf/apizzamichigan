#!/usr/bin/env node
/**
 * Daily Supabase Sync Worker
 *
 * Syncs enriched data from local PostgreSQL to Supabase.
 * Uses batch UPDATEs (ingress only - no egress costs).
 *
 * Usage:
 *   node scripts/enrichment/workers/daily-sync.mjs --type pizza --limit 1000
 *   node scripts/enrichment/workers/daily-sync.mjs --type taco --dry-run
 *   node scripts/enrichment/workers/daily-sync.mjs --all
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATS_FILE = join(__dirname, '../../.enrichment-stats.json')

// Supabase config
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

// Batch size for Supabase updates
const BATCH_SIZE = 100

/**
 * Get enriched places ready for sync
 */
async function getEnrichedPlaces(client, placeType, limit) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  const result = await client.query(`
    SELECT
      google_place_id,
      name,
      address,
      address_source,
      style,
      style_confidence,
      price_range,
      website_url,
      phone,
      hours,
      enrichment_status,
      last_enriched_at
    FROM ${table}
    WHERE enrichment_status = 'enriched'
      AND google_place_id LIKE 'osm:%'
      AND last_enriched_at IS NOT NULL
    ORDER BY last_enriched_at DESC
    LIMIT $1
  `, [limit])

  return result.rows
}

/**
 * Compute a simple hash of enrichment fields for change detection
 */
function computeHash(place) {
  const fields = [
    place.address || '',
    place.address_source || '',
    place.style || '',
    place.style_confidence || '',
    place.price_range || '',
    place.website_url || '',
    place.phone || '',
    JSON.stringify(place.hours || {}),
  ]
  // Simple hash - just join fields
  return fields.join('|')
}

/**
 * Update places in Supabase
 */
async function syncToSupabase(places, placeType, dryRun) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'
  let synced = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE)

    for (const place of batch) {
      // Build update object with only non-null enrichment fields
      const updates = {}

      if (place.address) updates.address = place.address
      if (place.address_source) updates.address_source = place.address_source
      if (place.style) updates.style = place.style
      if (place.style_confidence) updates.style_confidence = place.style_confidence
      if (place.price_range) updates.price_range = place.price_range
      if (place.website_url) updates.website_url = place.website_url
      if (place.phone) updates.phone = place.phone
      if (place.hours) updates.hours = place.hours
      updates.enrichment_status = 'enriched'
      updates.last_enriched_at = place.last_enriched_at

      // Skip if no enrichment data
      if (Object.keys(updates).length <= 2) {
        skipped++
        continue
      }

      if (dryRun) {
        console.log(`  Would update ${place.google_place_id}: ${JSON.stringify(updates)}`)
        synced++
        continue
      }

      try {
        const { error } = await supabase
          .from(table)
          .update(updates)
          .eq('google_place_id', place.google_place_id)

        if (error) {
          console.log(`  ✗ Failed to update ${place.name}: ${error.message}`)
          failed++
        } else {
          synced++
        }
      } catch (error) {
        console.log(`  ✗ Error updating ${place.name}: ${error.message}`)
        failed++
      }
    }

    if (!dryRun) {
      console.log(`  Synced ${Math.min(i + BATCH_SIZE, places.length)}/${places.length}`)
    }
  }

  return { synced, failed, skipped }
}

/**
 * Mark synced places in local database
 */
async function markSynced(client, placeType, osmIds) {
  if (osmIds.length === 0) return

  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  // Use ANY for array matching
  await client.query(`
    UPDATE ${table}
    SET enrichment_status = 'synced'
    WHERE google_place_id = ANY($1)
  `, [osmIds])
}

/**
 * Log sync attempt
 */
async function logSync(client, placeType, recordsSynced, startedAt) {
  await client.query(`
    INSERT INTO sync_state (table_name, records_synced, started_at, completed_at)
    VALUES ($1, $2, $3, NOW())
  `, [placeType === 'pizza' ? 'pizza_places' : 'taco_places', recordsSynced, startedAt])
}

/**
 * Update stats file
 */
function updateStats(placeType, synced, failed) {
  let stats = {}
  if (existsSync(STATS_FILE)) {
    try {
      stats = JSON.parse(readFileSync(STATS_FILE, 'utf-8'))
    } catch {}
  }

  if (!stats.sync) stats.sync = {}
  if (!stats.sync[placeType]) stats.sync[placeType] = { total: 0, success: 0, failed: 0 }

  stats.sync[placeType].total += synced + failed
  stats.sync[placeType].success += synced
  stats.sync[placeType].failed += failed
  stats.lastSynced = new Date().toISOString()

  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : null
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 1000
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')

  return { type, limit, dryRun, all }
}

/**
 * Sync a single place type
 */
async function syncPlaceType(client, placeType, limit, dryRun) {
  console.log(`\n=== Syncing ${placeType} places ===`)

  const startedAt = new Date()

  // Get enriched places
  const places = await getEnrichedPlaces(client, placeType, limit)
  console.log(`Found ${places.length} enriched ${placeType} places to sync`)

  if (places.length === 0) {
    return { synced: 0, failed: 0, skipped: 0 }
  }

  if (dryRun) {
    console.log('Dry run - would sync:')
    for (const place of places.slice(0, 10)) {
      console.log(`  ${place.name} - style: ${place.style || 'none'}, price: ${place.price_range || 'none'}`)
    }
    if (places.length > 10) {
      console.log(`  ... and ${places.length - 10} more`)
    }
    return { synced: places.length, failed: 0, skipped: 0 }
  }

  // Sync to Supabase
  const result = await syncToSupabase(places, placeType, dryRun)

  // Log sync
  await logSync(client, placeType, result.synced, startedAt)

  // Update stats
  updateStats(placeType, result.synced, result.failed)

  return result
}

/**
 * Main function
 */
async function main() {
  const { type, limit, dryRun, all } = parseArgs()

  console.log('=== Daily Supabase Sync ===')
  console.log(`Limit: ${limit}`)
  console.log(`Dry run: ${dryRun}`)
  console.log()

  // Determine which types to sync
  const types = all ? ['pizza', 'taco'] : (type ? [type] : ['pizza', 'taco'])

  // Connect to local PostgreSQL
  const client = new pg.Client({
    host: 'localhost',
    database: 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()
    console.log('Connected to local PostgreSQL')

    let totalSynced = 0
    let totalFailed = 0
    let totalSkipped = 0

    for (const placeType of types) {
      const result = await syncPlaceType(client, placeType, limit, dryRun)
      totalSynced += result.synced
      totalFailed += result.failed
      totalSkipped += result.skipped
    }

    console.log('\n=== Summary ===')
    console.log(`Synced: ${totalSynced}`)
    console.log(`Failed: ${totalFailed}`)
    console.log(`Skipped (no data): ${totalSkipped}`)

    if (dryRun) {
      console.log('\n=== DRY RUN COMPLETE (no changes made) ===')
    }

  } finally {
    await client.end()
  }
}

main().catch(console.error)
