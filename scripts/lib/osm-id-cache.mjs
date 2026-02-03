/**
 * Local OSM ID Cache
 *
 * Maintains a local file of all existing OSM IDs to avoid querying Supabase
 * for deduplication. This eliminates egress costs entirely for the dedup check.
 *
 * Usage:
 *   // Before importing, load the cache
 *   const cache = await loadOsmIdCache()
 *
 *   // Check if an OSM ID exists
 *   if (cache.pizza.has('osm:node/123456')) { ... }
 *
 *   // After successful import, update the cache
 *   await appendToOsmIdCache('pizza', newPlaces)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_FILE = join(__dirname, '..', '.osm-id-cache.json')

/**
 * Load the OSM ID cache from disk
 * Returns { pizza: Set<string>, taco: Set<string> }
 */
export async function loadOsmIdCache() {
  if (!existsSync(CACHE_FILE)) {
    console.log('[Cache] No local cache found, will need to build it first')
    return { pizza: new Set(), taco: new Set() }
  }

  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
    return {
      pizza: new Set(data.pizza || []),
      taco: new Set(data.taco || []),
    }
  } catch (err) {
    console.warn(`[Cache] Failed to load cache: ${err.message}`)
    return { pizza: new Set(), taco: new Set() }
  }
}

/**
 * Save the full cache to disk
 */
export async function saveOsmIdCache(cache) {
  const data = {
    pizza: Array.from(cache.pizza),
    taco: Array.from(cache.taco),
    lastUpdated: new Date().toISOString(),
  }
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2))
  console.log(`[Cache] Saved ${data.pizza.length} pizza + ${data.taco.length} taco OSM IDs to cache`)
}

/**
 * Append new OSM IDs to the cache after successful import
 * @param {'pizza'|'taco'} type - Which table
 * @param {Array} places - Array of places with google_place_id
 */
export async function appendToOsmIdCache(type, places) {
  const cache = await loadOsmIdCache()

  let added = 0
  for (const place of places) {
    if (place.google_place_id && !cache[type].has(place.google_place_id)) {
      cache[type].add(place.google_place_id)
      added++
    }
  }

  if (added > 0) {
    await saveOsmIdCache(cache)
    console.log(`[Cache] Added ${added} new ${type} OSM IDs to cache`)
  }

  return added
}

/**
 * Check if cache file exists and has data
 */
export function hasCacheFile() {
  if (!existsSync(CACHE_FILE)) return false
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
    return (data.pizza?.length > 0 || data.taco?.length > 0)
  } catch {
    return false
  }
}
