#!/usr/bin/env node
/**
 * Import International Regions - Canada and Mexico
 *
 * Imports pizza and taco places from Canadian provinces and Mexican states.
 * Uses progress tracking for resume capability and rate limiting to respect API limits.
 *
 * Usage:
 *   node scripts/import-international.mjs --dry-run             # Preview all imports
 *   node scripts/import-international.mjs --pizza-only          # Import only pizza
 *   node scripts/import-international.mjs --tacos-only          # Import only tacos
 *   node scripts/import-international.mjs --canada-only         # Import only Canada
 *   node scripts/import-international.mjs --mexico-only         # Import only Mexico
 *   node scripts/import-international.mjs --limit=5             # Only process 5 regions
 *   node scripts/import-international.mjs --report              # Show progress report only
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Progress file for tracking
const PROGRESS_FILE = join(__dirname, '.international-import-progress.json')

// Canadian Provinces & Territories (use English names for OSM name:en fallback)
const CANADIAN_REGIONS = [
  { name: 'Ontario', code: 'ON', country: 'CA' },
  { name: 'Québec', code: 'QC', country: 'CA' },
  { name: 'British Columbia', code: 'BC', country: 'CA' },
  { name: 'Alberta', code: 'AB', country: 'CA' },
  { name: 'Manitoba', code: 'MB', country: 'CA' },
  { name: 'Saskatchewan', code: 'SK', country: 'CA' },
  { name: 'Nova Scotia', code: 'NS', country: 'CA' },
  { name: 'New Brunswick', code: 'NB', country: 'CA' },
  { name: 'Newfoundland and Labrador', code: 'NL', country: 'CA' },
  { name: 'Prince Edward Island', code: 'PE', country: 'CA' },
  { name: 'Northwest Territories', code: 'NT', country: 'CA' },
  { name: 'Yukon', code: 'YT', country: 'CA' },
  { name: 'Nunavut', code: 'NU', country: 'CA' },
]

// Mexican States (use Spanish names as they appear in OSM)
const MEXICAN_STATES = [
  { name: 'Ciudad de México', code: 'CDMX', country: 'MX' },
  { name: 'Jalisco', code: 'JAL', country: 'MX' },
  { name: 'Nuevo León', code: 'NLE', country: 'MX' },
  { name: 'Estado de México', code: 'MEX', country: 'MX' },
  { name: 'Baja California', code: 'BCN', country: 'MX' },
  { name: 'Baja California Sur', code: 'BCS', country: 'MX' },
  { name: 'Sonora', code: 'SON', country: 'MX' },
  { name: 'Chihuahua', code: 'CHH', country: 'MX' },
  { name: 'Coahuila', code: 'COA', country: 'MX' },
  { name: 'Tamaulipas', code: 'TAM', country: 'MX' },
  { name: 'Sinaloa', code: 'SIN', country: 'MX' },
  { name: 'Durango', code: 'DUR', country: 'MX' },
  { name: 'Zacatecas', code: 'ZAC', country: 'MX' },
  { name: 'San Luis Potosí', code: 'SLP', country: 'MX' },
  { name: 'Aguascalientes', code: 'AGS', country: 'MX' },
  { name: 'Nayarit', code: 'NAY', country: 'MX' },
  { name: 'Colima', code: 'COL', country: 'MX' },
  { name: 'Michoacán', code: 'MIC', country: 'MX' },
  { name: 'Guanajuato', code: 'GUA', country: 'MX' },
  { name: 'Querétaro', code: 'QUE', country: 'MX' },
  { name: 'Hidalgo', code: 'HID', country: 'MX' },
  { name: 'Morelos', code: 'MOR', country: 'MX' },
  { name: 'Tlaxcala', code: 'TLA', country: 'MX' },
  { name: 'Puebla', code: 'PUE', country: 'MX' },
  { name: 'Veracruz', code: 'VER', country: 'MX' },
  { name: 'Guerrero', code: 'GRO', country: 'MX' },
  { name: 'Oaxaca', code: 'OAX', country: 'MX' },
  { name: 'Chiapas', code: 'CHP', country: 'MX' },
  { name: 'Tabasco', code: 'TAB', country: 'MX' },
  { name: 'Campeche', code: 'CAM', country: 'MX' },
  { name: 'Yucatán', code: 'YUC', country: 'MX' },
  { name: 'Quintana Roo', code: 'ROO', country: 'MX' },
]

/**
 * Load progress from file
 */
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
    } catch {
      return { completed: {}, failed: {} }
    }
  }
  return { completed: {}, failed: {} }
}

/**
 * Save progress to file
 */
function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

/**
 * Run the import script for a single region
 */
function importRegion(regionName, regionCode, type = 'pizza', dryRun = false) {
  return new Promise((resolve, reject) => {
    const scriptName = type === 'pizza' ? 'import-osm-pizza.mjs' : 'import-osm-tacos.mjs'
    const args = [
      join(__dirname, scriptName),
      '--state', regionName,
      '--state-code', regionCode
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
      // Extract the number of places from output
      const match = stdout.match(/New places to insert: (\d+)/)
      const count = match ? parseInt(match[1], 10) : 0

      // Consider success even with exit code 1 if we got results (dry run exits with 1)
      if (code === 0 || count > 0) {
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
  return {
    dryRun: args.includes('--dry-run'),
    reportOnly: args.includes('--report'),
    pizzaOnly: args.includes('--pizza-only'),
    tacosOnly: args.includes('--tacos-only'),
    canadaOnly: args.includes('--canada-only'),
    mexicoOnly: args.includes('--mexico-only'),
    limit: (() => {
      const limitArg = args.find(a => a.startsWith('--limit='))
      return limitArg ? parseInt(limitArg.split('=')[1], 10) : null
    })()
  }
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
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate progress report
 */
function generateReport(progress) {
  console.log('\n' + '='.repeat(60))
  console.log('IMPORT PROGRESS REPORT')
  console.log('='.repeat(60))

  const completedKeys = Object.keys(progress.completed)
  const failedKeys = Object.keys(progress.failed)

  console.log(`\nCompleted: ${completedKeys.length}`)
  if (completedKeys.length > 0) {
    let totalPlaces = 0
    for (const key of completedKeys) {
      const { count, type, region } = progress.completed[key]
      totalPlaces += count
      console.log(`  ${key}: ${region} (${type}) - ${count} places`)
    }
    console.log(`  Total places imported: ${totalPlaces}`)
  }

  console.log(`\nFailed: ${failedKeys.length}`)
  if (failedKeys.length > 0) {
    for (const key of failedKeys) {
      const { error, region } = progress.failed[key]
      console.log(`  ${key}: ${region} - ${error}`)
    }
  }

  console.log('')
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  console.log('='.repeat(60))
  console.log('INTERNATIONAL IMPORT - CANADA & MEXICO')
  console.log('='.repeat(60))
  console.log('')

  // Load progress
  const progress = loadProgress()

  // Report-only mode
  if (options.reportOnly) {
    generateReport(progress)
    return
  }

  // Build list of imports to run
  const imports = []

  // Add Canadian regions
  if (!options.mexicoOnly) {
    for (const region of CANADIAN_REGIONS) {
      if (!options.tacosOnly) {
        const key = `${region.code}-pizza`
        if (!progress.completed[key]) {
          imports.push({ ...region, type: 'pizza', key })
        }
      }
      if (!options.pizzaOnly) {
        const key = `${region.code}-tacos`
        if (!progress.completed[key]) {
          imports.push({ ...region, type: 'tacos', key })
        }
      }
    }
  }

  // Add Mexican states
  if (!options.canadaOnly) {
    for (const region of MEXICAN_STATES) {
      if (!options.tacosOnly) {
        const key = `${region.code}-pizza`
        if (!progress.completed[key]) {
          imports.push({ ...region, type: 'pizza', key })
        }
      }
      if (!options.pizzaOnly) {
        const key = `${region.code}-tacos`
        if (!progress.completed[key]) {
          imports.push({ ...region, type: 'tacos', key })
        }
      }
    }
  }

  if (imports.length === 0) {
    console.log('All regions have been processed!')
    generateReport(progress)
    return
  }

  // Apply limit if specified
  let toProcess = imports
  if (options.limit && options.limit > 0) {
    toProcess = imports.slice(0, options.limit)
    console.log(`Limiting to ${options.limit} imports`)
  }

  console.log(`Imports to process: ${toProcess.length}`)
  console.log(`Already completed: ${Object.keys(progress.completed).length}`)
  console.log('')

  if (options.dryRun) {
    console.log('=== DRY RUN MODE (no changes will be made) ===\n')
  }

  const startTime = Date.now()
  let processedCount = 0
  let currentDelay = 60000 // Start with 60 seconds

  for (const item of toProcess) {
    processedCount++
    const progressStr = `[${processedCount}/${toProcess.length}]`

    console.log('')
    console.log('='.repeat(60))
    console.log(`${progressStr} Importing ${item.type.toUpperCase()} from ${item.name} (${item.code})`)
    console.log('='.repeat(60))

    try {
      // Wait for rate limit (skip first one)
      if (processedCount > 1) {
        const waitTime = Math.round(currentDelay / 1000)
        console.log(`Waiting ${waitTime} seconds before next request...`)
        await sleep(currentDelay)
      }

      // Import the region
      const count = await importRegion(item.name, item.code, item.type, options.dryRun)

      // Mark as complete
      progress.completed[item.key] = {
        region: item.name,
        code: item.code,
        country: item.country,
        type: item.type,
        count,
        timestamp: new Date().toISOString()
      }
      delete progress.failed[item.key]

      // Success - can reduce delay slightly
      currentDelay = Math.max(60000, currentDelay * 0.9)

      console.log(`\n[OK] ${item.name} (${item.type}): ${count} places`)

    } catch (error) {
      console.error(`\n[ERROR] ${item.name} (${item.type}): ${error.message}`)

      // Mark as failed
      progress.failed[item.key] = {
        region: item.name,
        code: item.code,
        type: item.type,
        error: error.message,
        timestamp: new Date().toISOString()
      }

      // Check for rate limiting
      if (error.message.includes('429') || error.message.includes('rate limit')) {
        currentDelay = Math.min(300000, currentDelay * 2)
        console.log('Rate limited - increasing delay...')
      } else if (error.message.includes('503') || error.message.includes('unavailable')) {
        currentDelay = Math.min(300000, currentDelay * 1.5)
        console.log('Service unavailable - increasing delay...')
      }
    }

    // Save progress after each import
    saveProgress(progress)

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

  generateReport(progress)
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
