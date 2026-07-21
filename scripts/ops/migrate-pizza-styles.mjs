#!/usr/bin/env node
/**
 * Migrate legacy pizza style values in local Postgres.
 *
 * Dry-run is the default. Supabase is never modified. Run with --apply only
 * after reviewing the counts and confirming the local database is backed up.
 */

import pg from 'pg'
import 'dotenv/config'
import { LEGACY_PIZZA_STYLE_ALIASES } from '../lib/pizza-style-taxonomy.mjs'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
if (![...args].every(arg => arg === '--apply' || arg === '--help' || arg === '-h')) {
  throw new Error('Usage: node scripts/ops/migrate-pizza-styles.mjs [--apply]')
}
if (args.has('--help') || args.has('-h')) {
  console.log('Usage: node scripts/ops/migrate-pizza-styles.mjs [--apply]')
  console.log('Dry-run is the default; --apply updates local pizza_places only.')
  process.exit(0)
}

const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? Number.parseInt(process.env.PGPORT, 10) : 5432,
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || ''
})

await client.connect()
try {
  const values = Object.entries({ ...LEGACY_PIZZA_STYLE_ALIASES, Standard: 'Standard Round' })
  const counts = await client.query(`
    SELECT style, COUNT(*)::int AS count
    FROM pizza_places
    WHERE style = ANY($1::text[])
    GROUP BY style
    ORDER BY style
  `, [values.map(([style]) => style)])

  console.log(`# Pizza Style Migration (${apply ? 'apply' : 'dry-run'})`)
  console.table(counts.rows)

  if (apply) {
    for (const [legacy, current] of values) {
      const result = await client.query(
        'UPDATE pizza_places SET style = $1 WHERE style = $2 RETURNING id',
        [current, legacy]
      )
      console.log(`${legacy} -> ${current}: ${result.rowCount} rows`)
    }
  }
} finally {
  await client.end()
}
