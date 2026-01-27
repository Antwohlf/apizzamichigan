#!/usr/bin/env node
/**
 * Bulk populate style and price data for pizza places
 *
 * Usage:
 *   node scripts/populate-pizza-metadata.mjs --dry-run          # Preview changes
 *   node scripts/populate-pizza-metadata.mjs --phase=1          # Only name inference
 *   node scripts/populate-pizza-metadata.mjs --phase=2          # Include scraping
 *   node scripts/populate-pizza-metadata.mjs --export           # Export for review
 *   node scripts/populate-pizza-metadata.mjs --commit           # Write to database
 *   node scripts/populate-pizza-metadata.mjs --stats            # Show current stats
 */

import { writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

import { RateLimiter } from './lib/rate-limiter.mjs'
import { ProgressTracker } from './lib/progress-tracker.mjs'
import { inferStyleFromName, inferPriceFromChain, inferStyleFromCategories, isKnownChain } from './lib/style-inference.mjs'
import { scrapeYelpPrice, extractCity } from './lib/price-scraper.mjs'

// Supabase config
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0YWh5aXV2cW1hbGZwYmdpaXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4ODcwNDgsImV4cCI6MjA1MzQ2MzA0OH0.OJTKw2TJ8-NEy7fIym0Pe_a8F3cCYPMroNG1fHLGJbA'
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
  }

  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true
    if (arg === '--export') args.export = true
    if (arg === '--commit') args.commit = true
    if (arg === '--stats') args.stats = true
    if (arg.startsWith('--phase=')) args.phase = parseInt(arg.split('=')[1], 10)
    if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1], 10)
  }

  return args
}

/**
 * Fetch all places that need metadata (style or price is null)
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
      .from('pizza_places')
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

    const styleResult = inferStyleFromName(place.name, place.address)
    const priceResult = inferPriceFromChain(place.name)

    const result = {
      name: place.name,
      style: styleResult.style,
      styleConfidence: styleResult.confidence,
      styleSource: styleResult.source,
      styleMatch: styleResult.match,
      price: priceResult.price,
      priceConfidence: priceResult.confidence,
      priceSource: priceResult.source,
      priceMatch: priceResult.match,
      isKnownChain: isKnownChain(place.name),
      phase1Complete: true,
    }

    tracker.markProcessed(place.id, result)

    if (styleResult.style || priceResult.price) {
      inferred++
      if (args.dryRun) {
        const parts = []
        if (styleResult.style) parts.push(`style: ${styleResult.style}`)
        if (priceResult.price) parts.push(`price: ${priceResult.price}`)
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

    // Try to infer style from categories
    if (!existing.style && scrapedData.categories?.length > 0) {
      const categoryStyle = inferStyleFromCategories(scrapedData.categories)
      if (categoryStyle.style) {
        result.style = categoryStyle.style
        result.styleSource = categoryStyle.source
        result.styleConfidence = categoryStyle.confidence
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

  const exported = tracker.exportForReview()
  const outputPath = 'scripts/pizza-metadata-review.json'

  writeFileSync(outputPath, JSON.stringify(exported, null, 2))

  console.log(`Exported to ${outputPath}`)
  console.log(`  High confidence: ${exported.highConfidence.length}`)
  console.log(`  Medium confidence: ${exported.mediumConfidence.length}`)
  console.log(`  Low confidence / needs review: ${exported.lowConfidence.length}`)
  console.log(`  Unknown: ${exported.unknown.length}`)
}

/**
 * Commit results to database
 */
async function commitToDatabase(tracker, args) {
  console.log('\n=== Committing to Database ===')

  const results = tracker.getAllResults()
  const updates = Object.entries(results)
    .filter(([_, data]) => data.style || data.price)
    .map(([id, data]) => ({
      id,
      ...(data.style && { style: data.style }),
      ...(data.price && { price: data.price }),
    }))

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

  // Batch updates in groups of 100
  const batchSize = 100
  let updated = 0
  let errors = 0

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)

    const { error } = await supabase
      .from('pizza_places')
      .upsert(batch, { onConflict: 'id' })

    if (error) {
      console.error(`Error updating batch at index ${i}:`, error.message)
      errors++
      continue
    }

    updated += batch.length
    console.log(`Updated ${updated}/${updates.length}`)
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

  // Style distribution
  const styleCounts = {}
  Object.values(results).forEach(r => {
    if (r.style) {
      styleCounts[r.style] = (styleCounts[r.style] || 0) + 1
    }
  })
  console.log('\nStyle distribution:')
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

  console.log('Pizza Metadata Population Script')
  console.log('================================')
  if (args.dryRun) console.log('MODE: Dry Run (no changes will be made)')
  console.log(`Phase: ${args.phase}`)

  // Load progress tracker
  const tracker = new ProgressTracker()
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
