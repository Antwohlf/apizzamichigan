#!/usr/bin/env node

/**
 * Apply an explicit replacement website for one canonical place and enqueue
 * a fresh scrape. This is intentionally a bounded, operator-driven action.
 */

import pg from 'pg'
import 'dotenv/config'
import { getQueue } from '../enrichment/queue.mjs'
import { normalizeWebsiteUrl } from '../lib/website-url.mjs'

const args = parseArgs(process.argv.slice(2))
const table = args.entity === 'taco' ? 'taco_places' : 'pizza_places'
const normalizedUrl = normalizeWebsiteUrl(args.url)
if (!normalizedUrl) throw new Error('The replacement URL is not a valid HTTP(S) website URL.')

const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || '',
})
const queue = getQueue()

function parseArgs(argv) {
  const out = { entity: 'pizza', placeId: null, url: null, apply: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--entity') out.entity = argv[++i]
    else if (argv[i] === '--place-id') out.placeId = argv[++i]
    else if (argv[i] === '--url') out.url = argv[++i]
    else if (argv[i] === '--apply') out.apply = true
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/ops/replace-website-url.mjs --place-id <google_place_id> --url <url> [--entity pizza|taco] [--apply]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (!['pizza', 'taco'].includes(out.entity)) throw new Error('--entity must be pizza or taco')
  if (!out.placeId) throw new Error('--place-id is required')
  if (!out.url) throw new Error('--url is required')
  return out
}

try {
  await client.connect()
  const existing = await client.query(
    `SELECT id, name, state, website_url FROM ${table} WHERE google_place_id = $1`,
    [args.placeId]
  )
  const place = existing.rows[0]
  if (!place) throw new Error(`No ${args.entity} place found for ${args.placeId}`)

  if (!args.apply) {
    console.log(JSON.stringify({ mode: 'dry-run', entity: args.entity, place, replacement_url: normalizedUrl }, null, 2))
    process.exitCode = 0
  } else {
    await client.query(
      `UPDATE ${table}
       SET website_url = $2,
           scrape_method = NULL
       WHERE google_place_id = $1`,
      [args.placeId, normalizedUrl]
    )

    const job = queue.db.prepare(
      `SELECT id, status FROM jobs WHERE job_type = 'scrape' AND osm_id = ?`
    ).get(args.placeId)

    if (!job) {
      queue.addJob('scrape', args.placeId, args.entity, { state: place.state, skipCache: 1, manualReplacement: true })
    } else if (job.status === 'failed' || job.status === 'processing') {
      queue.retry(job.id, `Manual replacement URL supplied: ${normalizedUrl}`, { refundAttempt: true })
      queue.db.prepare(
        `UPDATE jobs SET data = json_set(COALESCE(data, '{}'), '$.skipCache', 1, '$.manualReplacement', 1) WHERE id = ?`
      ).run(job.id)
    } else {
      queue.db.prepare(
        `UPDATE jobs
         SET status = 'pending', worker_id = NULL, started_at = NULL, completed_at = NULL,
             attempts = 0, last_error = ?,
             data = json_set(COALESCE(data, '{}'), '$.skipCache', 1, '$.manualReplacement', 1)
         WHERE id = ?`
      ).run(`Manual replacement URL supplied: ${normalizedUrl}`, job.id)
    }

    console.log(JSON.stringify({
      mode: 'apply',
      entity: args.entity,
      place_id: args.placeId,
      place_name: place.name,
      previous_url: place.website_url,
      replacement_url: normalizedUrl,
      scrape_job: 'queued',
    }, null, 2))
  }
} finally {
  await client.end().catch(() => {})
  queue.close()
}

