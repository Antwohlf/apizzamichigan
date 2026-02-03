#!/usr/bin/env node
/**
 * Build OSM ID Cache
 *
 * One-time script to export all existing OSM IDs from Supabase to a local cache file.
 * This eliminates egress costs for future imports - we check the local cache instead
 * of querying Supabase.
 *
 * Run this once, then the import scripts will use the local cache.
 *
 * Usage:
 *   node scripts/build-osm-cache.mjs
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import { saveOsmIdCache } from './lib/osm-id-cache.mjs'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY must be set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function fetchAllOsmIds(table) {
  console.log(`Fetching OSM IDs from ${table}...`)

  const osmIds = new Set()
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('google_place_id')
      .like('google_place_id', 'osm:%')  // Only OSM entries
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw new Error(`Supabase error: ${error.message}`)
    }

    for (const row of data) {
      if (row.google_place_id) {
        osmIds.add(row.google_place_id)
      }
    }

    console.log(`  Fetched ${offset + data.length} records...`)

    if (data.length < pageSize) {
      break
    }
    offset += pageSize
  }

  return osmIds
}

async function main() {
  console.log('=== Building OSM ID Cache ===\n')
  console.log('This is a one-time operation to export all OSM IDs to a local file.')
  console.log('Future imports will use this cache instead of querying Supabase.\n')

  try {
    const pizzaIds = await fetchAllOsmIds('pizza_places')
    console.log(`Found ${pizzaIds.size} pizza OSM IDs\n`)

    const tacoIds = await fetchAllOsmIds('taco_places')
    console.log(`Found ${tacoIds.size} taco OSM IDs\n`)

    const cache = {
      pizza: pizzaIds,
      taco: tacoIds,
    }

    await saveOsmIdCache(cache)

    console.log('\n=== Cache built successfully! ===')
    console.log('Import scripts will now use the local cache for deduplication.')
    console.log('No more Supabase egress for checking duplicates.')

  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
