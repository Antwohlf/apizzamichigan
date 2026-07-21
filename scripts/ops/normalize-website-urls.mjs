#!/usr/bin/env node

/**
 * Apply only lossless URL normalization to canonical place records.
 * Redirects and domain changes are never guessed here.
 */

import pg from 'pg'
import 'dotenv/config'
import { normalizeWebsiteUrl } from '../lib/website-url.mjs'

const args = parseArgs(process.argv.slice(2))
const tables = args.entity === 'all' ? ['pizza_places', 'taco_places'] : [`${args.entity}_places`]
const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || '',
})

function parseArgs(argv) {
  const out = { entity: 'all', limit: 100000, apply: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--entity') out.entity = argv[++i]
    else if (argv[i] === '--limit') out.limit = Number.parseInt(argv[++i], 10)
    else if (argv[i] === '--apply') out.apply = true
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/ops/normalize-website-urls.mjs [--entity pizza|taco|all] [--limit 100000] [--apply]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (!['pizza', 'taco', 'all'].includes(out.entity)) throw new Error('--entity must be pizza, taco, or all')
  if (!Number.isInteger(out.limit) || out.limit < 1) throw new Error('--limit must be positive')
  return out
}

try {
  await client.connect()
  const changes = []
  for (const table of tables) {
    const rows = await client.query(
      `SELECT id, google_place_id, website_url
       FROM ${table}
       WHERE website_url IS NOT NULL AND btrim(website_url) <> ''
       ORDER BY id
       LIMIT $1`,
      [args.limit]
    )
    for (const row of rows.rows) {
      const normalized = normalizeWebsiteUrl(row.website_url)
      if (normalized && normalized !== row.website_url) changes.push({ table, ...row, normalized })
    }
  }

  if (args.apply && changes.length) {
    await client.query('BEGIN')
    try {
      for (const change of changes) {
        await client.query(`UPDATE ${change.table} SET website_url = $2 WHERE id = $1`, [change.id, change.normalized])
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }

  console.log(JSON.stringify({
    mode: args.apply ? 'apply' : 'dry-run',
    entities: args.entity,
    changed: changes.length,
    samples: changes.slice(0, 20).map(({ table, google_place_id, website_url, normalized }) => ({ table, google_place_id, from: website_url, to: normalized })),
  }, null, 2))
} finally {
  await client.end().catch(() => {})
}

