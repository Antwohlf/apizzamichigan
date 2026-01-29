#!/usr/bin/env node
/**
 * Bulk populate type and price data for taco places
 *
 * Usage:
 *   node scripts/populate-taco-metadata.mjs --dry-run          # Preview changes
 *   node scripts/populate-taco-metadata.mjs --phase=1          # Only name inference
 *   node scripts/populate-taco-metadata.mjs --phase=2          # Include scraping
 *   node scripts/populate-taco-metadata.mjs --export           # Export for review
 *   node scripts/populate-taco-metadata.mjs --commit           # Write to database
 *   node scripts/populate-taco-metadata.mjs --stats            # Show current stats
 *   node scripts/populate-taco-metadata.mjs --chains-only      # Only commit chain matches
 */

import { writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

import { RateLimiter } from './lib/rate-limiter.mjs'
import { ProgressTracker } from './lib/progress-tracker.mjs'
import {
  inferTypeFromName,
  inferPriceFromChain,
  inferTypeFromCategories,
  isKnownChain,
  formatTypesForStorage
} from './lib/type-inference-tacos.mjs'
import { scrapeYelpPrice, extractCity } from './lib/price-scraper.mjs'

// Supabase config - use service role key to bypass RLS for updates
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY must be set in .env')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

// Parse command line arguments
function parseArgs(argv) {
  const args = {
    dryRun: false,
    phase: 2,
    export: false,
    commit: false,
    stats: false,
    limit: null,
    chainsOnly: false,
  }

  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true
    if (arg === '--export') args.export = true
    if (arg === '--commit') args.commit = true
    if (arg === '--stats') args.stats = true
    if (arg === '--chains-only') args.chainsOnly = true
    if (arg.startsWith('--phase=')) args.phase = parseInt(arg.split('=')[1], 10)
    if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1], 10)
  }

  return args
}

/**
 * Fetch all places that need metadata (style or price is null)
 * Note: taco_places uses 'style' column (same as OSM import), not 'type'
 */
async function fetchPlacesNeedingMetadata() {
  const allPlaces = []
  const pageSize = 1000
  let page = 0
  let hasMore = true

  console.log('Fetching places from database...')

  while (hasMore) {
    const from = page * pageSize
    const to = from + pageSize - 1

    const { data, error } = await supabase
      .from('taco_places')
      .select('id, name, address, lat, lng, style, price')
      .or('style.is.null,price.is.null')
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      console.error('Error fetching places:', error.message)
      throw error
    }

    allPlaces.push(...(data || []))
    hasMore = data?.length === pageSize
    page++
  }

  console.log(`Found ${allPlaces.length} places needing metadata`)
  return allPlaces
}

/**
 * Phase 1: Name-based inference (fast, no network)
 */
async function runPhase1(places, tracker, args) {
  console.log('\n=== Phase 1: Name-Based Inference ===')

  let inferred = 0
  for (const place of places) {
    // Skip if already processed
    const existing = tracker.getResult(place.id)
    if (existing?.phase1Complete) continue

    const typeResult = inferTypeFromName(place.name, place.address)
    const priceResult = inferPriceFromChain(place.name)

    const result = {
      name: place.name,
      types: typeResult.types,
      style: formatTypesForStorage(typeResult.types), // Store as comma-separated string in 'style' column
      styleConfidence: typeResult.confidence,
      styleSource: typeResult.source,
      styleMatch: typeResult.match,
      price: priceResult.price || typeResult.price,
      priceConfidence: priceResult.confidence || (typeResult.price ? 'high' : null),
      priceSource: priceResult.source || (typeResult.price ? 'chain_map' : null),
      priceMatch: priceResult.match || typeResult.match,
      isKnownChain: isKnownChain(place.name),
      phase1Complete: true,
    }

    tracker.markProcessed(place.id, result)

    if (typeResult.types || priceResult.price || typeResult.price) {
      inferred++
      if (args.dryRun) {
        const parts = []
        if (typeResult.types) parts.push(`style: ${result.style}`)
        if (result.price) parts.push(`price: ${result.price}`)
        console.log(`  "${place.name}" => ${parts.join(', ')}`)
      }
    }
  }

  await tracker.save()
  console.log(`Phase 1 complete: ${inferred} places inferred`)
  return inferred
}

/**
 * Phase 2: Web scraping for price data
 */
async function runPhase2(places, tracker, args) {
  console.log('\n=== Phase 2: Yelp Scraping ===')

  const rateLimiter = new RateLimiter({ minDelay: 2500, maxDelay: 60000 })

  // Only scrape places that still need price data
  const needsScraping = places.filter(p => {
    const result = tracker.getResult(p.id)
    return !result?.price && !result?.scrapingComplete
  })

  console.log(`${needsScraping.length} places need scraping`)

  if (args.limit) {
    needsScraping.splice(args.limit)
    console.log(`Limited to ${args.limit} places`)
  }

  let scraped = 0
  let found = 0

  for (const place of needsScraping) {
    const city = extractCity(place.address) || 'Michigan'

    if (args.dryRun) {
      console.log(`  Would scrape: "${place.name}" in ${city}`)
      continue
    }

    console.log(`Scraping: "${place.name}" in ${city}...`)

    const scrapedData = await scrapeYelpPrice(place.name, city, rateLimiter)
    scraped++

    const existing = tracker.getResult(place.id) || {}
    const result = {
      ...existing,
      scrapingComplete: true,
      scrapedPrice: scrapedData.price,
      scrapedCategories: scrapedData.categories,
    }

    // Update price if scraped and not already set
    if (scrapedData.price && !existing.price) {
      result.price = scrapedData.price
      result.priceSource = 'yelp'
      result.priceConfidence = 'medium'
      found++
    }

    // Try to infer type from categories
    if (!existing.style && scrapedData.categories?.length > 0) {
      const categoryType = inferTypeFromCategories(scrapedData.categories)
      if (categoryType.types) {
        result.types = categoryType.types
        result.style = formatTypesForStorage(categoryType.types)
        result.styleSource = categoryType.source
        result.styleConfidence = categoryType.confidence
      }
    }

    tracker.markProcessed(place.id, result)

    // Save progress every 10 places
    if (scraped % 10 === 0) {
      await tracker.save()
      const summary = tracker.getSummary()
      console.log(`  Progress: ${scraped}/${needsScraping.length} scraped, ${summary.priceInferred} prices found`)
    }
  }

  await tracker.save()
  console.log(`Phase 2 complete: ${scraped} places scraped, ${found} prices found`)
  return found
}

/**
 * Export results for review
 */
async function exportForReview(tracker) {
  console.log('\n=== Exporting for Review ===')

  const results = tracker.getAllResults()

  // Separate by source type
  const chainMatches = []
  const keywordMatches = []
  const noMatch = []

  for (const [id, data] of Object.entries(results)) {
    const entry = { id, name: data.name, ...data }

    if (data.styleSource === 'chain_map' || data.priceSource === 'chain_map') {
      chainMatches.push(entry)
    } else if (data.styleSource === 'keyword' || data.styleSource === 'address_keyword') {
      keywordMatches.push(entry)
    } else if (!data.style && !data.price) {
      noMatch.push(entry)
    }
  }

  const exported = {
    summary: {
      chainMatches: chainMatches.length,
      keywordMatches: keywordMatches.length,
      noMatch: noMatch.length,
    },
    chainMatches,
    keywordMatches,
  }

  const outputPath = 'scripts/taco-metadata-review.json'
  writeFileSync(outputPath, JSON.stringify(exported, null, 2))

  console.log(`Exported to ${outputPath}`)
  console.log(`  Chain matches (high confidence): ${chainMatches.length}`)
  console.log(`  Keyword matches (needs review): ${keywordMatches.length}`)
  console.log(`  No match: ${noMatch.length}`)
}

/**
 * Commit results to database
 */
async function commitToDatabase(tracker, args) {
  console.log('\n=== Committing to Database ===')
  if (args.chainsOnly) {
    console.log('MODE: Chains only (high-confidence matches)')
  }

  const results = tracker.getAllResults()
  const updates = Object.entries(results)
    .filter(([_, data]) => {
      // Must have style or price
      if (!data.style && !data.price) return false
      // If chains-only, only include chain_map sources
      if (args.chainsOnly) {
        const styleOk = !data.style || data.styleSource === 'chain_map'
        const priceOk = !data.price || data.priceSource === 'chain_map'
        return styleOk && priceOk
      }
      return true
    })
    .map(([id, data]) => {
      // For chains-only, only include fields from chain_map
      if (args.chainsOnly) {
        return {
          id,
          ...(data.style && data.styleSource === 'chain_map' && { style: data.style }),
          ...(data.price && data.priceSource === 'chain_map' && { price: data.price }),
        }
      }
      return {
        id,
        ...(data.style && { style: data.style }),
        ...(data.price && { price: data.price }),
      }
    })
    .filter(u => u.style || u.price) // Filter out empty updates

  console.log(`${updates.length} places have data to update`)

  if (args.dryRun) {
    console.log('Dry run - no changes made')
    // Show sample updates
    updates.slice(0, 10).forEach(u => {
      console.log(`  ${u.id}: style=${u.style || 'null'}, price=${u.price || 'null'}`)
    })
    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more`)
    }
    return
  }

  // Update each place individually (update only, no insert)
  let updated = 0
  let errors = 0

  for (const update of updates) {
    const { id, ...fields } = update

    const { error } = await supabase
      .from('taco_places')
      .update(fields)
      .eq('id', id)

    if (error) {
      console.error(`Error updating id ${id}:`, error.message)
      errors++
      continue
    }

    updated++
    if (updated % 100 === 0) {
      console.log(`Updated ${updated}/${updates.length}`)
    }
  }

  console.log(`Committed ${updated} updates (${errors} errors)`)
}

/**
 * Show current stats
 */
function showStats(tracker, places) {
  const summary = tracker.getSummary()
  const results = tracker.getAllResults()

  console.log('\n=== Current Stats ===')
  console.log(`Total places needing metadata: ${places.length}`)
  console.log(`Processed: ${summary.processed}`)
  console.log(`Style inferred: ${summary.styleInferred}`)
  console.log(`Price inferred: ${summary.priceInferred}`)
  console.log(`Needs review: ${summary.needsReview}`)

  // Style (protein type) distribution
  const styleCounts = {}
  Object.values(results).forEach(r => {
    if (r.types && Array.isArray(r.types)) {
      // Count each individual protein type
      r.types.forEach(t => {
        styleCounts[t] = (styleCounts[t] || 0) + 1
      })
    }
  })
  console.log('\nProtein/Style distribution:')
  Object.entries(styleCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([style, count]) => {
      console.log(`  ${style}: ${count}`)
    })

  // Price distribution
  const priceCounts = {}
  Object.values(results).forEach(r => {
    if (r.price) {
      priceCounts[r.price] = (priceCounts[r.price] || 0) + 1
    }
  })
  console.log('\nPrice distribution:')
  Object.entries(priceCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([price, count]) => {
      console.log(`  ${price}: ${count}`)
    })
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log('Taco Metadata Population Script')
  console.log('================================')
  if (args.dryRun) console.log('MODE: Dry Run (no changes will be made)')
  console.log(`Phase: ${args.phase}`)

  // Load progress tracker with taco-specific progress file
  const tracker = new ProgressTracker('.taco-metadata-progress.json')
  await tracker.load()

  // Fetch places needing metadata
  const places = await fetchPlacesNeedingMetadata()
  tracker.setTotal(places.length)

  if (args.stats) {
    showStats(tracker, places)
    return
  }

  // Phase 1: Name inference
  if (args.phase >= 1) {
    await runPhase1(places, tracker, args)
  }

  // Phase 2: Web scraping
  if (args.phase >= 2 && !args.dryRun) {
    await runPhase2(places, tracker, args)
  } else if (args.phase >= 2 && args.dryRun) {
    console.log('\n=== Phase 2: Yelp Scraping (skipped in dry-run) ===')
  }

  // Export for review
  if (args.export) {
    await exportForReview(tracker)
  }

  // Commit to database
  if (args.commit) {
    await commitToDatabase(tracker, args)
  }

  // Final summary
  showStats(tracker, places)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
