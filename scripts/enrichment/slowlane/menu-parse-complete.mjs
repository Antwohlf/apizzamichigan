#!/usr/bin/env node
/**
 * Complete a menu_parse job:
 * - Update pizza_places.menu_data + confidence + notes
 * - Mark job completed in SQLite queue
 *
 * Usage:
 *   node menu-parse-complete.mjs --job-id 123 --osm-id osm:node/... --place-type pizza --result-json /path/to/result.json
 */

import fs from 'node:fs'
import pg from 'pg'
import { getQueue } from '../queue.mjs'

function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : null
}

const jobId = parseInt(arg('--job-id'), 10)
const osmId = arg('--osm-id')
const placeType = arg('--place-type') || 'pizza'
const resultJsonPath = arg('--result-json')

if (!jobId || !osmId || !resultJsonPath) {
  console.error('Missing required args')
  process.exit(1)
}

const result = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'))

const queue = getQueue()

const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || ''
})

async function main() {
  await client.connect()

  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  const menuData = result.menu_data ?? null
  const confidence = result.confidence ?? null
  const notes = result.notes ?? null

  await client.query(`
    UPDATE ${table}
    SET
      menu_data = COALESCE($2::jsonb, menu_data),
      menu_parse_confidence = $3,
      menu_parse_notes = $4,
      menu_last_parsed_at = NOW(),
      last_enriched_at = NOW()
    WHERE google_place_id = $1
  `, [osmId, menuData ? JSON.stringify(menuData) : null, confidence, notes])

  queue.complete(jobId, { ok: true, confidence })

  await client.end()
}

main().catch((err) => {
  console.error(err)
  try { queue.fail(jobId, err.message) } catch {}
  process.exit(1)
})
