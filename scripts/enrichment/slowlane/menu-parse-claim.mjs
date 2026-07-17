#!/usr/bin/env node
/**
 * Claim ONE menu_parse job and return enriched input payload as JSON.
 *
 * Output:
 *  - JSON object with jobId, osmId, placeType, input (name, website_url, scrape_notes, state)
 *  - or "null" if no job available
 */

import { getQueue } from '../queue.mjs'
import pg from 'pg'
import { extractMenuData } from '../../lib/menu-data-extractor.mjs'

const queue = getQueue()

function getPgClient() {
  return new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })
}

async function main() {
  const workerId = process.env.MENU_PARSE_WORKER_ID || `menu_parse-${Date.now()}`

  const job = queue.claim('menu_parse', workerId)
  if (!job) {
    console.log('null')
    return
  }

  const table = job.placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  const client = getPgClient()
  await client.connect()
  try {
    const row = await client.query(`
      SELECT id, name, state, website_url, scrape_notes, menu_data
      FROM ${table}
      WHERE google_place_id = $1
      LIMIT 1
    `, [job.osmId])

    const place = row.rows[0]

    // If already has menu_data, just complete job as skipped.
    if (place?.menu_data) {
      queue.complete(job.id, { skipped: 'already_has_menu_data' })
      console.log(JSON.stringify({ skipped: true, reason: 'already_has_menu_data', jobId: job.id, osmId: job.osmId }))
      return
    }

    const payload = {
      jobId: job.id,
      osmId: job.osmId,
      placeType: job.placeType,
      placeId: place?.id ?? null,
      input: {
        name: place?.name ?? null,
        state: place?.state ?? null,
        website_url: place?.website_url ?? null,
        // scrape_notes may already be JSON string
        scrape_notes: place?.scrape_notes ?? null
      },
      // A worker may complete this deterministically without spending an
      // Ollama request. Null means the evidence needs a later parser.
      deterministic_menu_data: extractMenuData(place?.scrape_notes, { websiteUrl: place?.website_url })
    }

    console.log(JSON.stringify(payload))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
