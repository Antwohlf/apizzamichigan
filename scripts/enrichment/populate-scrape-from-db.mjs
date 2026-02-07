#!/usr/bin/env node
/**
 * Populate scrape jobs from local Postgres.
 *
 * Creates `scrape` jobs in the SQLite queue for places that already have a website_url
 * and have not been scraped yet.
 *
 * Default: pizza only.
 *
 * Usage:
 *   node scripts/enrichment/populate-scrape-from-db.mjs
 *   node scripts/enrichment/populate-scrape-from-db.mjs --type pizza|taco
 *   node scripts/enrichment/populate-scrape-from-db.mjs --state MI
 *   node scripts/enrichment/populate-scrape-from-db.mjs --limit 5000
 */

import pg from 'pg'
import 'dotenv/config'
import { getQueue } from './queue.mjs'
import { calculatePriority } from './priority.mjs'

function parseArgs() {
  const args = process.argv.slice(2)
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'pizza'
  const state = args.includes('--state') ? args[args.indexOf('--state') + 1] : null
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : null
  return { type, state, limit }
}

async function main() {
  const { type, state, limit } = parseArgs()
  const table = type === 'taco' ? 'taco_places' : 'pizza_places'

  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await client.connect()
  const queue = getQueue()

  const clauses = [
    "google_place_id LIKE 'osm:%'",
    'website_url IS NOT NULL',
    "(scrape_method IS NULL OR scrape_method != 'fetch')"
  ]
  const params = []

  if (state) {
    params.push(state)
    clauses.push(`state = $${params.length}`)
  }

  let limitSql = ''
  if (limit && Number.isFinite(limit)) {
    params.push(limit)
    limitSql = `LIMIT $${params.length}`
  }

  const sql = `
    SELECT google_place_id, state
    FROM ${table}
    WHERE ${clauses.join(' AND ')}
    ORDER BY state = 'MI' DESC, id ASC
    ${limitSql}
  `

  const res = await client.query(sql, params)

  const jobs = res.rows.map((row) => ({
    jobType: 'scrape',
    osmId: row.google_place_id,
    placeType: type,
    priority: calculatePriority(row.state),
    data: { state: row.state }
  }))

  const added = queue.addJobs(jobs)

  console.log(`Found ${res.rowCount} candidates in ${table}`)
  console.log(`Added ${added} scrape jobs to SQLite queue`) 

  queue.close()
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
