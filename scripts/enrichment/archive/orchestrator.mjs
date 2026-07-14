#!/usr/bin/env node
/**
 * Enrichment Pipeline Orchestrator
 *
 * Coordinates the full enrichment pipeline:
 * 1. OSM extraction (Overpass API queries)
 * 2. Website scraping (simple fetch)
 * 3. LLM classification (Groq/Together.ai)
 * 4. Daily Supabase sync
 *
 * Usage:
 *   node scripts/enrichment/orchestrator.mjs --phase extract --type pizza --limit 100
 *   node scripts/enrichment/orchestrator.mjs --phase scrape --type taco
 *   node scripts/enrichment/orchestrator.mjs --phase classify --type pizza
 *   node scripts/enrichment/orchestrator.mjs --phase sync --all
 *   node scripts/enrichment/orchestrator.mjs --full --type pizza --limit 500
 *   node scripts/enrichment/orchestrator.mjs --status
 */

import { spawn } from 'child_process'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATS_FILE = join(__dirname, '../.enrichment-stats.json')

// Worker scripts
const WORKERS = {
  extract: join(__dirname, 'workers/osm-extractor.mjs'),
  scrape: join(__dirname, 'workers/website-scraper.mjs'),
  classify: join(__dirname, 'workers/style-classifier.mjs'),
  sync: join(__dirname, 'workers/daily-sync.mjs')
}

/**
 * Run a worker script
 */
function runWorker(phase, args = []) {
  return new Promise((resolve, reject) => {
    const workerPath = WORKERS[phase]
    if (!workerPath) {
      reject(new Error(`Unknown phase: ${phase}`))
      return
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`Running ${phase} worker...`)
    console.log(`Command: node ${workerPath} ${args.join(' ')}`)
    console.log('='.repeat(60))

    const child = spawn('node', [workerPath, ...args], {
      stdio: 'inherit',
      cwd: process.cwd()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Worker ${phase} exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * Get enrichment progress from database
 */
async function getProgress() {
  const client = new pg.Client({
    host: 'localhost',
    database: 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()

    // Get enrichment progress
    const progressResult = await client.query(`SELECT * FROM enrichment_progress`)

    // Get phase progress
    const phaseResult = await client.query(`SELECT * FROM phase_progress`)

    // Get queue status
    const queueResult = await client.query(`
      SELECT phase, status, COUNT(*) as count
      FROM enrichment_queue
      GROUP BY phase, status
      ORDER BY phase, status
    `)

    return {
      enrichment: progressResult.rows,
      phases: phaseResult.rows,
      queue: queueResult.rows
    }
  } finally {
    await client.end()
  }
}

/**
 * Display enrichment status
 */
async function showStatus() {
  console.log('\n=== Enrichment Pipeline Status ===\n')

  try {
    const progress = await getProgress()

    console.log('Enrichment Progress:')
    console.log('-'.repeat(50))
    for (const row of progress.enrichment) {
      const pct = row.total > 0 ? Math.round((row.enriched / row.total) * 100) : 0
      console.log(`  ${row.place_type}: ${row.enriched}/${row.total} (${pct}%) enriched, ${row.failed} failed`)
    }

    console.log('\nPhase Progress:')
    console.log('-'.repeat(50))
    for (const row of progress.phases) {
      const successRate = row.total > 0 ? Math.round((row.success / row.total) * 100) : 0
      const avgDuration = row.avg_duration_ms ? Math.round(row.avg_duration_ms) : 0
      console.log(`  ${row.phase}: ${row.success}/${row.total} success (${successRate}%), avg ${avgDuration}ms`)
    }

    if (progress.queue.length > 0) {
      console.log('\nQueue Status:')
      console.log('-'.repeat(50))
      for (const row of progress.queue) {
        console.log(`  ${row.phase} - ${row.status}: ${row.count}`)
      }
    }

  } catch (error) {
    console.log('Could not connect to local PostgreSQL database.')
    console.log('Make sure the database is running and the schema is set up.')
    console.log(`Error: ${error.message}`)
  }

  // Show stats file if exists
  if (existsSync(STATS_FILE)) {
    console.log('\nStats File:')
    console.log('-'.repeat(50))
    try {
      const stats = JSON.parse(readFileSync(STATS_FILE, 'utf-8'))
      console.log(`  Last updated: ${stats.lastUpdated || 'unknown'}`)
      if (stats.phases) {
        for (const [phase, data] of Object.entries(stats.phases)) {
          console.log(`  ${phase}: ${data.success}/${data.processed} success`)
        }
      }
    } catch {}
  }
}

/**
 * Run full pipeline for a place type
 */
async function runFullPipeline(placeType, limit, dryRun) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`FULL PIPELINE: ${placeType}`)
  console.log(`Limit: ${limit}`)
  console.log(`Dry run: ${dryRun}`)
  console.log('='.repeat(60))

  const baseArgs = ['--type', placeType, '--limit', String(limit)]
  if (dryRun) baseArgs.push('--dry-run')

  const phases = ['extract', 'scrape', 'classify']

  for (const phase of phases) {
    try {
      await runWorker(phase, baseArgs)
      console.log(`\n✓ ${phase} phase completed`)
    } catch (error) {
      console.error(`\n✗ ${phase} phase failed: ${error.message}`)
      console.log('Continuing to next phase...')
    }
  }

  // Sync at the end (unless dry run)
  if (!dryRun) {
    try {
      await runWorker('sync', ['--type', placeType])
      console.log('\n✓ sync phase completed')
    } catch (error) {
      console.error(`\n✗ sync phase failed: ${error.message}`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`PIPELINE COMPLETE: ${placeType}`)
  console.log('='.repeat(60))
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)

  const phase = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : null
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'pizza'
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 100
  const dryRun = args.includes('--dry-run')
  const full = args.includes('--full')
  const status = args.includes('--status')
  const all = args.includes('--all')

  return { phase, type, limit, dryRun, full, status, all }
}

/**
 * Main function
 */
async function main() {
  const { phase, type, limit, dryRun, full, status, all } = parseArgs()

  console.log('=== Enrichment Pipeline Orchestrator ===')
  console.log(`Date: ${new Date().toISOString()}`)

  // Show status
  if (status) {
    await showStatus()
    return
  }

  // Full pipeline
  if (full) {
    const types = all ? ['pizza', 'taco'] : [type]
    for (const t of types) {
      await runFullPipeline(t, limit, dryRun)
    }
    return
  }

  // Single phase
  if (phase) {
    const args = ['--type', type, '--limit', String(limit)]
    if (dryRun) args.push('--dry-run')
    if (all) args.push('--all')

    await runWorker(phase, args)
    return
  }

  // No phase specified - show help
  console.log(`
Usage:
  node orchestrator.mjs --phase <phase> --type <pizza|taco> [options]
  node orchestrator.mjs --full --type <pizza|taco> [options]
  node orchestrator.mjs --status

Phases:
  extract   - Extract data from OSM (Overpass API)
  scrape    - Scrape websites for additional info
  classify  - Classify style/price using LLM
  sync      - Sync enriched data to Supabase

Options:
  --type <pizza|taco>  Place type to process (default: pizza)
  --limit <number>     Max places to process (default: 100)
  --dry-run            Preview without making changes
  --all                Process all types (for sync)
  --full               Run complete pipeline (extract → scrape → classify → sync)
  --status             Show current enrichment progress

Examples:
  # Extract OSM data for 500 pizza places
  node orchestrator.mjs --phase extract --type pizza --limit 500

  # Scrape websites for taco places (dry run)
  node orchestrator.mjs --phase scrape --type taco --dry-run

  # Run full pipeline for pizza places
  node orchestrator.mjs --full --type pizza --limit 100

  # Check current status
  node orchestrator.mjs --status
`)
}

main().catch(console.error)
