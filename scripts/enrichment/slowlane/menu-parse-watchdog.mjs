#!/usr/bin/env node
/**
 * menu-parse-watchdog.mjs
 *
 * Purpose: prevent infinite re-claim loops for slowlane menu_parse jobs when the
 * OpenClaw/LLM run aborts before calling menu-parse-complete.
 *
 * Usage (spawned by menu-parse-claim.mjs):
 *   node menu-parse-watchdog.mjs --job-id 123 --osm-id osm:... --place-type pizza
 *
 * Behavior:
 *   - Wait WATCHDOG_MS (default 5 minutes)
 *   - If job is still in status=processing, auto-write a fallback menu_data to PG
 *     and mark the SQLite job completed.
 */

import pg from 'pg'
import { getQueue } from '../queue.mjs'

function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : null
}

const jobId = parseInt(arg('--job-id'), 10)
const osmId = arg('--osm-id')
const placeType = arg('--place-type') || 'pizza'

const WATCHDOG_MS = process.env.MENU_PARSE_WATCHDOG_MS
  ? parseInt(process.env.MENU_PARSE_WATCHDOG_MS, 10)
  : 5 * 60 * 1000

if (!jobId || !osmId) {
  console.error('Missing required args --job-id / --osm-id')
  process.exit(1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fallbackResult(reason) {
  return {
    confidence: 'low',
    menu_data: {
      has_menu: false,
      menu_urls: [],
      ordering_urls: [],
      signature_pizzas: [],
      toppings: [],
      dietary_options: [],
      price_examples: {
        small: null,
        medium: null,
        large: null,
        slice: null
      }
    },
    notes: `watchdog_autocomplete: ${reason}`
  }
}

async function main() {
  await sleep(WATCHDOG_MS)

  const queue = getQueue()
  // NOTE: queue.db is intentionally used here for a lightweight status check.
  const job = queue.db
    .prepare('SELECT id, status, worker_id, attempts, max_attempts, started_at, updated_at FROM jobs WHERE id = ?')
    .get(jobId)

  if (!job) return
  if (job.status !== 'processing') return

  const result = fallbackResult('job still processing after watchdog delay (likely aborted run)')

  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()

    const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

    // Write fallback menu_data so the place is not perpetually "missing".
    await client.query(`
      UPDATE ${table}
      SET
        menu_data = COALESCE($2::jsonb, menu_data),
        menu_parse_confidence = $3,
        menu_parse_notes = $4,
        menu_last_parsed_at = NOW(),
        last_enriched_at = NOW()
      WHERE google_place_id = $1
    `, [
      osmId,
      JSON.stringify(result.menu_data),
      result.confidence,
      result.notes
    ])

    // Mark the queue job completed to prevent re-claim loops.
    queue.complete(jobId, { ok: false, watchdog: true, confidence: result.confidence })
  } catch (err) {
    // If PG update fails, still complete the queue job to stop infinite reclaims.
    try {
      queue.complete(jobId, { ok: false, watchdog: true, confidence: 'low', pgError: String(err?.message || err) })
    } catch {}

    // Log to stderr for local debugging.
    console.error(err)
  } finally {
    try { await client.end() } catch {}
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
