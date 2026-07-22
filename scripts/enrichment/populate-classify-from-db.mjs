#!/usr/bin/env node
/**
 * Populate classify jobs from local Postgres.
 *
 * Adds `classify` jobs to the SQLite queue for rows that have been scraped,
 * and do not yet have classification.
 *
 * Usage:
 *   node scripts/enrichment/populate-classify-from-db.mjs --state MI --limit 100
 *   node scripts/enrichment/populate-classify-from-db.mjs --type pizza --state MI --limit 100
 *   node scripts/enrichment/populate-classify-from-db.mjs --ids 181254,181255
 *   node scripts/enrichment/populate-classify-from-db.mjs --state '*' --id-prefix all_the_places:
 *   node scripts/enrichment/populate-classify-from-db.mjs --id-prefix all_the_places:
 *   node scripts/enrichment/populate-classify-from-db.mjs --min-place-id 181254 --max-place-id 181347
 *   node scripts/enrichment/populate-classify-from-db.mjs --priority-boost 100000
 *   node scripts/enrichment/populate-classify-from-db.mjs --dry-run
 */

import pg from 'pg'
import 'dotenv/config'
import { getQueue } from './queue.mjs'
import { calculatePriority } from './priority.mjs'

function parseArgs() {
  const args = process.argv.slice(2)
  const help = args.includes('--help') || args.includes('-h')
  const dryRun = args.includes('--dry-run')
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'pizza'
  const state = args.includes('--state') ? args[args.indexOf('--state') + 1] : 'MI'
  const ids = args.includes('--ids')
    ? args[args.indexOf('--ids') + 1].split(',').map((value) => parseInt(value.trim(), 10)).filter(Number.isFinite)
    : []
  const idPrefix = args.includes('--id-prefix') ? args[args.indexOf('--id-prefix') + 1] : null
  const minPlaceId = args.includes('--min-place-id') ? parseInt(args[args.indexOf('--min-place-id') + 1], 10) : null
  const maxPlaceId = args.includes('--max-place-id') ? parseInt(args[args.indexOf('--max-place-id') + 1], 10) : null
  const priorityBoost = args.includes('--priority-boost') ? parseInt(args[args.indexOf('--priority-boost') + 1], 10) : 0
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 200
  const skipExisting = args.includes('--skip-existing')
  return { help, dryRun, type, state, ids, idPrefix, minPlaceId, maxPlaceId, priorityBoost, limit, skipExisting }
}

function printHelp() {
  console.log(`Usage: node scripts/enrichment/populate-classify-from-db.mjs [options]

Options:
  --type <pizza>            Place table family. Only pizza is supported for now.
  --state <code|*>          State filter (default MI)
  --ids <ids>               Exact comma-separated local place ids
  --id-prefix <prefix|*>    Optional canonical id prefix filter
  --min-place-id <id>       Minimum local place id
  --max-place-id <id>       Maximum local place id
  --priority-boost <n>      Boost matching pending classify jobs after add
  --limit <n>               Maximum candidates to inspect (default 200)
  --skip-existing           Skip places that already have any classify job
  --dry-run                 Count candidates without adding or boosting jobs
  --help                    Print this help and exit

Default mode writes classify jobs to the local SQLite queue. Use --dry-run
before broad queue population. Taco classification is not wired to this
classifier yet; use --type pizza explicitly in generated handoff commands.
`)
}

async function main() {
  const { help, dryRun, type, state, ids, idPrefix, minPlaceId, maxPlaceId, priorityBoost, limit, skipExisting } = parseArgs()
  if (help) {
    printHelp()
    return
  }
  if (type !== 'pizza') {
    throw new Error(`Unsupported --type ${type}. populate-classify-from-db.mjs is currently pizza_places only.`)
  }

  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await client.connect()
  const queue = dryRun ? null : getQueue()

  const clauses = [
    "NULLIF(BTRIM(google_place_id), '') IS NOT NULL",
    `(scrape_method IN ('fetch', 'browser')
      OR osm_tags IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM place_sources ps
        WHERE ps.entity_type = 'pizza'
          AND ps.place_id = pizza_places.id
          AND ps.match_confidence >= 0.9
      ))`,
    '(style IS NULL OR price_range IS NULL)'
  ]
  const params = []

  if (ids.length) {
    params.push(ids)
    clauses.push(`id = ANY($${params.length}::int[])`)
  } else if (state && state !== '*') {
    params.push(state)
    clauses.push(`state = $${params.length}`)
  }

  if (!ids.length && idPrefix && idPrefix !== '*') {
    params.push(`${idPrefix}%`)
    clauses.push(`google_place_id LIKE $${params.length}`)
  }

  if (Number.isFinite(minPlaceId)) {
    params.push(minPlaceId)
    clauses.push(`id >= $${params.length}`)
  }

  if (Number.isFinite(maxPlaceId)) {
    params.push(maxPlaceId)
    clauses.push(`id <= $${params.length}`)
  }

  let limitSql = ''
  if (limit && Number.isFinite(limit)) {
    params.push(limit)
    // Scan beyond the bounded write batch so existing jobs do not pin the
    // feeder to the same first page forever.
    const candidateLimit = skipExisting ? 10000 : limit
    params[params.length - 1] = candidateLimit
    limitSql = `LIMIT $${params.length}`
  }

  const { rows } = await client.query(
    `SELECT id, google_place_id, state
     FROM pizza_places
     WHERE ${clauses.join(' AND ')}
     ORDER BY id ASC
     ${limitSql}`,
    params
  )

  const existingIds = skipExisting && !dryRun
    ? new Set(queue.db.prepare("SELECT osm_id FROM jobs WHERE job_type = 'classify'").all().map(row => row.osm_id))
    : new Set()
  const eligibleRows = skipExisting ? rows.filter(row => !existingIds.has(row.google_place_id)) : rows
  const jobs = eligibleRows.slice(0, limit).map((r) => ({
    jobType: 'classify',
    osmId: r.google_place_id,
    placeType: type,
    priority: calculatePriority(r.state),
    data: { state: r.state }
  }))

  const added = dryRun ? 0 : queue.addJobs(jobs)
  let boosted = 0

  if (!dryRun && Number.isFinite(priorityBoost) && priorityBoost > 0 && jobs.length) {
    const stmt = queue.db.prepare(`
      UPDATE jobs
      SET priority = ?
      WHERE job_type = 'classify'
        AND osm_id = ?
        AND status = 'pending'
        AND priority < ?
    `)
    const boostJobs = queue.db.transaction((rows) => {
      let changes = 0
      for (const job of rows) {
        const boostedPriority = (job.priority ?? calculatePriority(job.data?.state)) + priorityBoost
        const result = stmt.run(boostedPriority, job.osmId, boostedPriority)
        changes += result.changes
      }
      return changes
    })
    boosted = boostJobs(jobs)
  }

  console.log(`Found ${rows.length} candidates`)
  if (skipExisting) console.log(`Skipped ${rows.length - eligibleRows.length} places with existing classify jobs`)
  console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`)
  console.log(`Added ${added} classify jobs to SQLite queue`)
  if (priorityBoost > 0) console.log(`Boosted ${boosted} pending classify jobs by ${priorityBoost}`)

  queue?.close()
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
