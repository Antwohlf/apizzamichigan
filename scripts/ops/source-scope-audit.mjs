#!/usr/bin/env node

/**
 * Read-only audit of source evidence against the configured geographic scope.
 * This reports evidence that may need archival review; it never deletes or
 * updates place_sources, source_review_queue, or canonical place rows.
 */

import pg from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWithinScope } from './source-input-sample-report.mjs'

const tables = { pizza: 'pizza_places', taco: 'taco_places' }

function parseArgs(argv) {
  const args = { entity: 'pizza', source: '', limit: 50000, sample: 10, json: false }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--entity') args.entity = argv[++i]
    else if (arg === '--source') args.source = argv[++i]
    else if (arg === '--limit') args.limit = Number(argv[++i])
    else if (arg === '--sample') args.sample = Number(argv[++i])
    else if (arg === '--json') args.json = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/ops/source-scope-audit.mjs [--entity pizza|taco] [--source osm] [--limit N] [--sample N] [--json]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!tables[args.entity]) throw new Error('Invalid --entity. Use pizza or taco.')
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error('Invalid --limit.')
  if (!Number.isInteger(args.sample) || args.sample < 0) throw new Error('Invalid --sample.')
  return args
}

function loadEnv(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const [key, ...rest] = line.split('=')
      return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')]
    }))
}

function dbConfig() {
  const env = {
    ...loadEnv(resolve(process.cwd(), '.env')),
    ...loadEnv(resolve(process.cwd(), '.env.local')),
    ...process.env,
  }
  return {
    host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
    port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
    database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
  }
}

function loadScope() {
  const path = resolve(process.cwd(), 'config/source-pipeline.json')
  if (!existsSync(path)) return { region_scope: 'unconfigured', regions: [] }
  const config = JSON.parse(readFileSync(path, 'utf8'))
  return { region_scope: config.region_scope || 'unconfigured', regions: config.regions || [] }
}

export function classifyScope(data, scope) {
  const lat = Number(data?.lat ?? data?.latitude)
  const lng = Number(data?.lng ?? data?.lon ?? data?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'no_coordinates'

  const region = String(data?.region ?? data?.state ?? data?.['addr:state'] ?? '').trim()
  const candidate = { lat, lng, region }
  if (isWithinScope(candidate, scope)) return region ? 'in_scope' : 'unknown_region'
  return region ? 'explicit_out_of_scope' : 'out_of_scope_unknown_region'
}

function table(rows) {
  if (!rows.length) return '_none_'
  const keys = Object.keys(rows[0])
  return [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${keys.map(key => String(row[key] ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`),
  ].join('\n')
}

export async function runAudit(argv = process.argv) {
  const args = parseArgs(argv)
  const client = new pg.Client(dbConfig())
  const scope = loadScope()

  try {
    await client.connect()
  const params = [args.entity]
  const sourceFilter = args.source ? `AND ps.source = $${params.push(args.source)}` : ''
  const totalResult = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM place_sources ps
    WHERE ps.entity_type = $1 ${sourceFilter}
  `, params)
  const result = await client.query(`
    SELECT ps.id, ps.source, ps.source_id, ps.place_id, ps.match_method,
           ps.retrieved_at, p.name AS place_name, ps.data
    FROM place_sources ps
    LEFT JOIN ${tables[args.entity]} p ON p.id = ps.place_id
    WHERE ps.entity_type = $1 ${sourceFilter}
    ORDER BY ps.id
    LIMIT ${args.limit}
  `, params)

  const counts = Object.fromEntries([
    'in_scope', 'unknown_region', 'explicit_out_of_scope',
    'out_of_scope_unknown_region', 'no_coordinates',
  ].map(key => [key, 0]))
  const samples = Object.fromEntries(Object.keys(counts).map(key => [key, []]))

  for (const row of result.rows) {
    const classification = classifyScope(row.data, scope)
    counts[classification] += 1
    if (samples[classification].length < args.sample) {
      samples[classification].push({
        id: row.id,
        source: row.source,
        source_id: row.source_id,
        place_id: row.place_id,
        place_name: row.place_name,
        region: row.data?.region || row.data?.state || row.data?.['addr:state'] || null,
        match_method: row.match_method,
        retrieved_at: row.retrieved_at,
      })
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    entity: args.entity,
    source: args.source || 'all',
    scope: scope.regions.map(region => ({ key: region.key, region_codes: region.region_codes || [] })),
    total_rows: totalResult.rows[0].total,
    rows_inspected: result.rows.length,
    truncated: result.rows.length < totalResult.rows[0].total,
    counts,
    samples,
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`# Source Scope Audit (${args.entity})`)
    console.log(`Source: ${report.source}`)
    console.log(`Rows inspected: ${report.rows_inspected}`)
    console.log('Read-only: yes')
    console.log('')
    console.log(table(Object.entries(counts).map(([classification, count]) => ({ classification, count }))))
    for (const [classification, rows] of Object.entries(samples)) {
      if (rows.length) {
        console.log(`\n## ${classification}`)
        console.log(table(rows))
      }
    }
  }
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runAudit().catch(error => {
    console.error(`source-scope-audit failed: ${error.message || error}`)
    process.exit(1)
  })
}
