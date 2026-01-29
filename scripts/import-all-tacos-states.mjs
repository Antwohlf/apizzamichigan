#!/usr/bin/env node
/**
 * Import All States - Nationwide Taco Place Import
 *
 * Loops through all 50 US states and imports taco/Mexican places from OpenStreetMap.
 * Uses progress tracking for resume capability and rate limiting to respect API limits.
 *
 * Usage:
 *   node scripts/import-all-tacos-states.mjs               # Run full import
 *   node scripts/import-all-tacos-states.mjs --dry-run     # Preview without inserting
 *   node scripts/import-all-tacos-states.mjs --limit=5     # Only process 5 states
 *   node scripts/import-all-tacos-states.mjs --resume      # Resume from last checkpoint
 *   node scripts/import-all-tacos-states.mjs --report      # Show progress report only
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { StateImportTracker } from './lib/state-import-tracker.mjs'
import { RateLimiter } from './lib/rate-limiter.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// All 50 US states with OSM names and 2-letter codes
const US_STATES = [
  { name: 'Alabama', code: 'AL' },
  { name: 'Alaska', code: 'AK' },
  { name: 'Arizona', code: 'AZ' },
  { name: 'Arkansas', code: 'AR' },
  { name: 'California', code: 'CA' },
  { name: 'Colorado', code: 'CO' },
  { name: 'Connecticut', code: 'CT' },
  { name: 'Delaware', code: 'DE' },
  { name: 'Florida', code: 'FL' },
  { name: 'Georgia', code: 'GA' },
  { name: 'Hawaii', code: 'HI' },
  { name: 'Idaho', code: 'ID' },
  { name: 'Illinois', code: 'IL' },
  { name: 'Indiana', code: 'IN' },
  { name: 'Iowa', code: 'IA' },
  { name: 'Kansas', code: 'KS' },
  { name: 'Kentucky', code: 'KY' },
  { name: 'Louisiana', code: 'LA' },
  { name: 'Maine', code: 'ME' },
  { name: 'Maryland', code: 'MD' },
  { name: 'Massachusetts', code: 'MA' },
  { name: 'Michigan', code: 'MI' },
  { name: 'Minnesota', code: 'MN' },
  { name: 'Mississippi', code: 'MS' },
  { name: 'Missouri', code: 'MO' },
  { name: 'Montana', code: 'MT' },
  { name: 'Nebraska', code: 'NE' },
  { name: 'Nevada', code: 'NV' },
  { name: 'New Hampshire', code: 'NH' },
  { name: 'New Jersey', code: 'NJ' },
  { name: 'New Mexico', code: 'NM' },
  { name: 'New York', code: 'NY' },
  { name: 'North Carolina', code: 'NC' },
  { name: 'North Dakota', code: 'ND' },
  { name: 'Ohio', code: 'OH' },
  { name: 'Oklahoma', code: 'OK' },
  { name: 'Oregon', code: 'OR' },
  { name: 'Pennsylvania', code: 'PA' },
  { name: 'Rhode Island', code: 'RI' },
  { name: 'South Carolina', code: 'SC' },
  { name: 'South Dakota', code: 'SD' },
  { name: 'Tennessee', code: 'TN' },
  { name: 'Texas', code: 'TX' },
  { name: 'Utah', code: 'UT' },
  { name: 'Vermont', code: 'VT' },
  { name: 'Virginia', code: 'VA' },
  { name: 'Washington', code: 'WA' },
  { name: 'West Virginia', code: 'WV' },
  { name: 'Wisconsin', code: 'WI' },
  { name: 'Wyoming', code: 'WY' }
]

/**
 * Run the import script for a single state
 * Returns the number of places inserted
 */
function importState(stateName, stateCode, dryRun = false) {
  return new Promise((resolve, reject) => {
    const args = [
      join(__dirname, 'import-osm-tacos.mjs'),
      '--state', stateName,
      '--state-code', stateCode
    ]

    if (dryRun) {
      args.push('--dry-run')
    }

    const child = spawn('node', args, {
      stdio: ['inherit', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        // Try to extract the number of places inserted from output
        const match = stdout.match(/New places to insert: (\d+)/)
        const count = match ? parseInt(match[1], 10) : 0
        resolve(count)
      } else {
        reject(new Error(`Import failed with exit code ${code}: ${stderr}`))
      }
    })
  })
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    dryRun: args.includes('--dry-run'),
    reportOnly: args.includes('--report'),
    limit: null
  }

  // Parse --limit=N
  const limitArg = args.find(a => a.startsWith('--limit='))
  if (limitArg) {
    options.limit = parseInt(limitArg.split('=')[1], 10)
  }

  return options
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  console.log('='.repeat(60))
  console.log('NATIONWIDE TACO PLACE IMPORT')
  console.log('='.repeat(60))
  console.log('')

  // Initialize tracker with taco-specific progress file
  const tracker = new StateImportTracker('scripts/.taco-state-import-progress.json')
  await tracker.load()

  // Report-only mode
  if (options.reportOnly) {
    tracker.generateReport()
    return
  }

  // Get states to process (include all states, no skip for Michigan since this is fresh)
  let statesToProcess = tracker.getStatesToProcess(US_STATES, false)

  if (statesToProcess.length === 0) {
    console.log('All states have been processed!')
    tracker.generateReport()
    return
  }

  // Apply limit if specified
  if (options.limit && options.limit > 0) {
    statesToProcess = statesToProcess.slice(0, options.limit)
    console.log(`Limiting to ${options.limit} states`)
  }

  console.log(`States to process: ${statesToProcess.length}`)
  console.log(`Already completed: ${tracker.getCompletedStates().length}`)
  console.log('')

  if (options.dryRun) {
    console.log('=== DRY RUN MODE (no changes will be made) ===\n')
  }

  // Initialize rate limiter with 60-second delays (Overpass API etiquette)
  const rateLimiter = new RateLimiter({
    minDelay: 60000,  // 60 seconds minimum
    maxDelay: 300000, // 5 minutes maximum
    backoffFactor: 2
  })

  const startTime = Date.now()
  let processedCount = 0

  for (const state of statesToProcess) {
    processedCount++
    const progress = `[${processedCount}/${statesToProcess.length}]`

    console.log('')
    console.log('='.repeat(60))
    console.log(`${progress} Importing ${state.name} (${state.code})`)
    console.log('='.repeat(60))

    try {
      // Wait for rate limit
      if (processedCount > 1) {
        const waitTime = Math.round(rateLimiter.currentDelay / 1000)
        console.log(`Waiting ${waitTime} seconds before next request...`)
        await rateLimiter.throttle()
      }

      // Import the state
      const recordCount = await importState(state.name, state.code, options.dryRun)

      // Mark as complete
      tracker.markStateComplete(state.code, recordCount)
      rateLimiter.reportSuccess()

      console.log(`\n[OK] ${state.name}: ${recordCount} places imported`)

    } catch (error) {
      console.error(`\n[ERROR] ${state.name}: ${error.message}`)

      // Mark as failed
      tracker.markStateFailed(state.code, error)

      // Check for rate limiting
      if (error.message.includes('429') || error.message.includes('rate limit')) {
        rateLimiter.reportError(429)
        console.log('Rate limited - increasing delay...')
      } else if (error.message.includes('503') || error.message.includes('unavailable')) {
        rateLimiter.reportError(503)
        console.log('Service unavailable - increasing delay...')
      }

      // Continue to next state
    }

    // Save progress after each state
    await tracker.save()

    // Show elapsed time
    const elapsed = Date.now() - startTime
    console.log(`\nElapsed time: ${formatDuration(elapsed)}`)
  }

  // Final report
  const totalTime = Date.now() - startTime
  console.log('')
  console.log('='.repeat(60))
  console.log(`IMPORT COMPLETE - Total time: ${formatDuration(totalTime)}`)
  console.log('='.repeat(60))

  tracker.generateReport()
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
