#!/usr/bin/env node
/**
 * Populate classify jobs from local Postgres (pizza-only for now).
 *
 * Adds `classify` jobs to the SQLite queue for rows that have been scraped,
 * and do not yet have classification.
 *
 * Usage:
 *   node scripts/enrichment/populate-classify-from-db.mjs --state MI --limit 100
 */

import pg from 'pg'
import 'dotenv/config'
import { getQueue } from './queue.mjs'
import { calculatePriority } from './priority.mjs'

function parseArgs() {
  const args = process.argv.slice(2)
  const state = args.includes('--state') ? args[args.indexOf('--state') + 1] : 'MI'
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 200
  return { state, limit }
}

async function main() {
  const { state, limit } = parseArgs()

  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await client.connect()
  const queue = getQueue()

  const { rows } = await client.query(
    `SELECT google_place_id, state
     FROM pizza_places
     WHERE state = $1
       AND scrape_method = 'fetch'
       AND (style IS NULL AND price_range IS NULL)
     ORDER BY id ASC
     LIMIT $2`,
    [state, limit]
  )

  const jobs = rows.map((r) => ({
    jobType: 'classify',
    osmId: r.google_place_id,
    placeType: 'pizza',
    priority: calculatePriority(r.state),
    data: { state: r.state }
  }))

  const added = queue.addJobs(jobs)
  console.log(`Found ${rows.length} candidates, added ${added} classify jobs`)

  queue.close()
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
