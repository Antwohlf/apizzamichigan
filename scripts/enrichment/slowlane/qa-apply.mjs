#!/usr/bin/env node
/**
 * Apply QA flags JSON to local Postgres qa_flags table.
 *
 * Usage:
 *   node qa-apply.mjs --flags-json /path/to/flags.json
 */

import fs from 'node:fs'
import pg from 'pg'

function arg(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : null
}

const flagsPath = arg('--flags-json')
if (!flagsPath) {
  console.error('Missing --flags-json')
  process.exit(1)
}

const flags = JSON.parse(fs.readFileSync(flagsPath, 'utf8'))

const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || ''
})

async function main() {
  await client.connect()

  const insert = `
    INSERT INTO qa_flags (place_id, place_type, flag_type, severity, message, evidence)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  `

  for (const f of flags) {
    if (!f.place_id || !f.flag_type || !f.message) continue
    await client.query(insert, [
      f.place_id,
      f.place_type || 'pizza',
      f.flag_type,
      f.severity || 'warn',
      f.message,
      f.evidence ? JSON.stringify(f.evidence) : null
    ])
  }

  await client.end()
  console.log(`Inserted ${flags.length} QA flags`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
