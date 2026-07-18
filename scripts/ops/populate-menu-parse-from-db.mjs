#!/usr/bin/env node

/** Queue bounded menu parsing for places with a menu URL but no parse result. */

import pg from 'pg'
import { getQueue } from '../enrichment/queue.mjs'
import { calculatePriority } from '../enrichment/priority.mjs'

function parseArgs(argv) {
  const args = { ids: [], state: null, limit: 100, priorityBoost: 100000, apply: false, dryRun: false }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--ids') args.ids = argv[++i].split(',').map(value => Number.parseInt(value.trim(), 10)).filter(Number.isInteger)
    else if (arg === '--state') args.state = argv[++i]
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i], 10)
    else if (arg === '--priority-boost') args.priorityBoost = Number.parseInt(argv[++i], 10)
    else if (arg === '--apply') args.apply = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/ops/populate-menu-parse-from-db.mjs [--ids a,b] [--state MI] [--limit n] [--priority-boost n] [--apply]')
      console.log('Default mode is read-only. Queues only rows with menu_url and no menu_last_parsed_at.')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 1000) throw new Error('--limit must be between 1 and 1000')
  if (!Number.isInteger(args.priorityBoost) || args.priorityBoost < 0) throw new Error('--priority-boost must be zero or greater')
  if (args.dryRun) args.apply = false
  return args
}

const args = parseArgs(process.argv)
const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: Number.parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || '',
})

await client.connect()
const clauses = [
  "NULLIF(menu_url, '') IS NOT NULL",
  'menu_last_parsed_at IS NULL',
]
const values = []
if (args.ids.length) {
  values.push(args.ids)
  clauses.push(`id = ANY($${values.length}::int[])`)
}
if (args.state) {
  values.push(args.state.toUpperCase())
  clauses.push(`state = $${values.length}`)
}
values.push(args.limit)
const { rows } = await client.query(`
  SELECT id, google_place_id, state, name
  FROM pizza_places
  WHERE ${clauses.join(' AND ')}
  ORDER BY CASE WHEN state = 'MI' THEN 0 ELSE 1 END, id
  LIMIT $${values.length}
`, values)
await client.end()

const jobs = rows.map(row => ({
  jobType: 'menu_parse',
  osmId: row.google_place_id,
  placeType: 'pizza',
  priority: calculatePriority(row.state) + args.priorityBoost,
  data: { state: row.state, reason: 'menu_url_backfill' },
}))

let added = 0
let boosted = 0
if (args.apply && jobs.length) {
  const queue = getQueue()
  try {
    added = queue.addJobs(jobs)
    if (args.priorityBoost > 0) {
      const stmt = queue.db.prepare(`
        UPDATE jobs
        SET priority = MAX(priority, ?)
        WHERE job_type = 'menu_parse'
          AND osm_id = ?
          AND status = 'pending'
      `)
      for (const job of jobs) boosted += stmt.run(job.priority, job.osmId).changes
    }
  } finally {
    queue.close()
  }
}

console.log(JSON.stringify({
  mode: args.apply ? 'apply' : 'dry-run',
  candidates: rows.length,
  added,
  boosted,
  sample: rows.slice(0, 10).map(row => ({ id: row.id, name: row.name, state: row.state })),
}, null, 2))
