#!/usr/bin/env node
/**
 * Sync from Supabase - One-Time Download
 *
 * Downloads all data from Supabase to local PostgreSQL.
 * This is the initial setup step before running the enrichment pipeline.
 * After this, all reads happen locally (zero egress).
 *
 * Usage:
 *   node scripts/enrichment/sync-from-supabase.mjs
 *   node scripts/enrichment/sync-from-supabase.mjs --type pizza
 *   node scripts/enrichment/sync-from-supabase.mjs --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import 'dotenv/config'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Batch size for fetching and inserting
const BATCH_SIZE = 1000

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'all'
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')  // Skip confirmation
  return { type, dryRun, force }
}

/**
 * Fetch all records from a Supabase table
 */
async function fetchAllFromSupabase(tableName) {
  const records = []
  let offset = 0
  let hasMore = true

  console.log(`\nFetching ${tableName} from Supabase...`)

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id', { ascending: true })

    if (error) {
      throw new Error(`Supabase error: ${error.message}`)
    }

    if (data && data.length > 0) {
      records.push(...data)
      offset += data.length
      process.stdout.write(`\r  Fetched ${records.length} records...`)
    }

    hasMore = data && data.length === BATCH_SIZE
  }

  console.log(`\r  Fetched ${records.length} records total.`)
  return records
}

/**
 * Insert records into local PostgreSQL
 */
async function insertIntoLocal(client, tableName, records) {
  if (records.length === 0) {
    console.log(`  No records to insert into ${tableName}`)
    return 0
  }

  console.log(`\nInserting ${records.length} records into local ${tableName}...`)

  // Get column names from first record
  const columns = Object.keys(records[0])

  // Build parameterized INSERT with ON CONFLICT
  let inserted = 0
  let updated = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    for (const record of batch) {
      const values = columns.map(col => record[col])
      const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ')
      const updateSet = columns
        .filter(col => col !== 'id')
        .map(col => `${col} = EXCLUDED.${col}`)
        .join(', ')

      const query = `
        INSERT INTO ${tableName} (${columns.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT (id) DO UPDATE SET ${updateSet}
        RETURNING (xmax = 0) as inserted
      `

      try {
        const result = await client.query(query, values)
        if (result.rows[0]?.inserted) {
          inserted++
        } else {
          updated++
        }
      } catch (error) {
        // Skip records with constraint violations
        if (!error.message.includes('duplicate key')) {
          console.error(`\n  Error inserting record: ${error.message}`)
        }
      }
    }

    process.stdout.write(`\r  Processed ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}...`)
  }

  console.log(`\r  Inserted: ${inserted}, Updated: ${updated}`)
  return inserted + updated
}

/**
 * Verify sync by comparing counts
 */
async function verifyCounts(client, tableName, expectedCount) {
  const result = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`)
  const localCount = parseInt(result.rows[0].count, 10)

  console.log(`  ${tableName}: Local=${localCount}, Supabase=${expectedCount}`)

  if (localCount < expectedCount) {
    console.log(`  Warning: Local has ${expectedCount - localCount} fewer records`)
  }

  return localCount
}

/**
 * Populate the enrichment queue from synced data
 */
async function populateEnrichmentQueue(client, placeType) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  console.log(`\nPopulating enrichment queue for ${placeType}...`)

  // Insert OSM records that need enrichment
  const result = await client.query(`
    INSERT INTO enrichment_queue (osm_id, place_type, phase, priority, status)
    SELECT
      google_place_id,
      '${placeType}',
      'osm_extract',
      calculate_priority(state, 'US'),
      'pending'
    FROM ${table}
    WHERE google_place_id LIKE 'osm:%'
      AND (enrichment_status IS NULL OR enrichment_status = 'pending')
    ON CONFLICT (osm_id) DO NOTHING
    RETURNING osm_id
  `)

  console.log(`  Added ${result.rowCount} records to enrichment queue`)
  return result.rowCount
}

/**
 * Populate Google Places queue for high-priority places missing websites
 */
async function populateGooglePlacesQueue(client, placeType) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  console.log(`\nPopulating Google Places queue for ${placeType}...`)

  // Only add places that:
  // 1. Are in priority states (MI, major US states)
  // 2. Don't have a website yet
  // 3. Are OSM-sourced
  const result = await client.query(`
    INSERT INTO google_places_queue (osm_id, place_type, name, lat, lng, state, priority)
    SELECT
      google_place_id,
      '${placeType}',
      name,
      lat,
      lng,
      state,
      calculate_priority(state, 'US')
    FROM ${table}
    WHERE google_place_id LIKE 'osm:%'
      AND website_url IS NULL
      AND state IN ('MI', 'NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'NJ')
    ON CONFLICT (osm_id) DO NOTHING
    RETURNING osm_id
  `)

  console.log(`  Added ${result.rowCount} high-priority places to Google queue`)
  return result.rowCount
}

/**
 * Main sync function
 */
async function main() {
  const { type, dryRun, force } = parseArgs()

  console.log('=== Supabase to Local PostgreSQL Sync ===')
  console.log(`Date: ${new Date().toISOString()}`)
  console.log(`Type: ${type}`)
  console.log(`Dry run: ${dryRun}`)
  console.log()

  // Warning about egress
  if (!force && !dryRun) {
    console.log('WARNING: This will download all data from Supabase.')
    console.log('This is a one-time operation for initial setup.')
    console.log('Run with --force to skip this warning, or --dry-run to preview.')
    console.log()

    // Wait for confirmation (simple timeout approach)
    console.log('Starting in 5 seconds... (Ctrl+C to cancel)')
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

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

    const tables = type === 'all'
      ? ['pizza_places', 'taco_places']
      : [type === 'pizza' ? 'pizza_places' : 'taco_places']

    const stats = { fetched: 0, synced: 0 }

    for (const tableName of tables) {
      // Fetch from Supabase
      const records = await fetchAllFromSupabase(tableName)
      stats.fetched += records.length

      if (dryRun) {
        console.log(`\n  [DRY RUN] Would insert ${records.length} records into ${tableName}`)
        continue
      }

      // Insert into local PostgreSQL
      const synced = await insertIntoLocal(client, tableName, records)
      stats.synced += synced

      // Verify counts
      await verifyCounts(client, tableName, records.length)

      // Populate queues
      const placeType = tableName === 'pizza_places' ? 'pizza' : 'taco'
      await populateEnrichmentQueue(client, placeType)
      await populateGooglePlacesQueue(client, placeType)
    }

    // Refresh dashboard view
    if (!dryRun) {
      console.log('\nRefreshing enrichment dashboard...')
      await client.query('SELECT refresh_enrichment_dashboard()')
    }

    // Summary
    console.log('\n=== Sync Summary ===')
    console.log(`Fetched from Supabase: ${stats.fetched}`)
    console.log(`Synced to local: ${stats.synced}`)

    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made.')
    } else {
      console.log('\nSync complete! You can now run the enrichment pipeline.')
      console.log('Next steps:')
      console.log('  1. Verify: node scripts/ops/home-status-report.mjs')
      console.log('  2. Follow docs/PIPELINE_BOUNDARY.md to operate the external runtime')
    }

  } catch (error) {
    console.error(`\nError: ${error.message}`)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main().catch(console.error)
