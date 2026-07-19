#!/usr/bin/env node

/**
 * Read-only report for business lifecycle and identity-quality candidates.
 *
 * This deliberately does not mark places closed, merge records, or rewrite
 * names. It gives the operator a bounded set of evidence-backed cases for
 * replacements, stale listings, same-location conflicts, and chain coverage.
 */

import pg from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const entityArg = process.argv.includes('--entity')
  ? process.argv[process.argv.indexOf('--entity') + 1]
  : 'pizza'
const limitArg = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : 100
const json = process.argv.includes('--json')
const tables = { pizza: 'pizza_places', taco: 'taco_places' }

if (!tables[entityArg]) throw new Error('Invalid --entity. Use pizza or taco.')
if (!Number.isInteger(limitArg) || limitArg < 1 || limitArg > 500) throw new Error('Invalid --limit. Use 1-500.')

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const [key, ...rest] = line.split('=')
      return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')]
    }))
}

const env = {
  ...readEnvFile(resolve(process.cwd(), '.env')),
  ...readEnvFile(resolve(process.cwd(), '.env.local')),
  ...process.env,
}
const client = new pg.Client({
  host: env.LOCAL_DB_HOST || env.PGHOST || '127.0.0.1',
  port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
  database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
  user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
  password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
})

const table = tables[entityArg]

try {
  await client.connect()
  const tableCheck = await client.query(`
    SELECT to_regclass('public.place_sources') IS NOT NULL AS place_sources,
           to_regclass('public.source_review_queue') IS NOT NULL AS review_queue
  `)
  const available = tableCheck.rows[0]
  const report = {
    entity: entityArg,
    generated_at: new Date().toISOString(),
    read_only: true,
    available,
    replacements: [],
    closed_or_stale: [],
    same_location_conflicts: [],
    chain_coverage: [],
  }

  if (available.review_queue) {
    const replacements = await client.query(`
      SELECT srq.id, srq.source, srq.source_id, srq.source_name,
             p.id AS place_id, p.name AS current_name, p.status, p.rating,
             p.notes,
             CASE WHEN p.status <> 'unvisited' OR p.rating IS NOT NULL
                    OR NULLIF(btrim(p.notes), '') IS NOT NULL
                  THEN 'history_requires_review'
                  ELSE 'safe_unreviewed_update'
             END AS handling
      FROM source_review_queue srq
      JOIN ${table} p ON p.id = srq.nearest_place_id
      WHERE srq.entity_type = $1
        AND srq.status = 'pending'
        AND srq.review_kind = 'ambiguous'
        AND srq.source = 'osm'
        AND srq.source_id = p.google_place_id
        AND lower(regexp_replace(coalesce(srq.source_name, ''), '[^a-z0-9]+', ' ', 'g'))
          <> lower(regexp_replace(coalesce(p.name, ''), '[^a-z0-9]+', ' ', 'g'))
      ORDER BY srq.id
      LIMIT $2
    `, [entityArg, limitArg])
    report.replacements = replacements.rows
  }

  if (available.place_sources) {
    const stale = await client.query(`
      SELECT p.id AS place_id, p.name, p.state, p.status,
             ps.source, ps.retrieved_at,
             CASE ps.source
               WHEN 'osm' THEN 30
               WHEN 'official_website' THEN 30
               WHEN 'all_the_places' THEN 90
               WHEN 'fsq_os_places' THEN 180
               WHEN 'overture_places' THEN 365
               WHEN 'wikidata' THEN 365
               ELSE 180
             END AS freshness_days
      FROM place_sources ps
      JOIN ${table} p ON p.id = ps.place_id
      WHERE ps.entity_type = $1
        AND ps.retrieved_at < NOW() - make_interval(days => CASE ps.source
          WHEN 'osm' THEN 30
          WHEN 'official_website' THEN 30
          WHEN 'all_the_places' THEN 90
          WHEN 'fsq_os_places' THEN 180
          WHEN 'overture_places' THEN 365
          WHEN 'wikidata' THEN 365
          ELSE 180 END)
        AND lower(coalesce(p.status, '')) NOT LIKE 'closed%'
      ORDER BY ps.retrieved_at
      LIMIT $2
    `, [entityArg, limitArg])
    report.closed_or_stale = stale.rows

    const conflicts = await client.query(`
      WITH candidates AS (
        SELECT id, name, state, lat, lng,
               ROUND(lat::numeric, 4) AS lat_bucket,
               ROUND(lng::numeric, 4) AS lng_bucket,
               lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name
        FROM ${table}
        WHERE lat IS NOT NULL AND lng IS NOT NULL
      )
      SELECT a.id AS first_place_id, a.name AS first_name,
             b.id AS second_place_id, b.name AS second_name,
             a.state,
             ROUND((ABS(a.lat - b.lat) * 111000)::numeric, 1) AS latitude_gap_m,
             ROUND((ABS(a.lng - b.lng) * 111000 * COS(RADIANS(a.lat)))::numeric, 1) AS longitude_gap_m
      FROM candidates a
      JOIN candidates b ON b.id > a.id
        AND b.lat_bucket = a.lat_bucket
        AND b.lng_bucket = a.lng_bucket
        AND COALESCE(a.state, '') = COALESCE(b.state, '')
        AND ABS(a.lat - b.lat) < 0.00015
        AND ABS(a.lng - b.lng) < 0.00015
        AND a.normalized_name <> b.normalized_name
      ORDER BY a.id, b.id
      LIMIT $1
    `, [limitArg])
    report.same_location_conflicts = conflicts.rows

    const chains = await client.query(`
      SELECT COALESCE(NULLIF(btrim(p.brand_wikidata), ''), NULLIF(btrim(p.operator_wikidata), ''),
                      NULLIF(btrim(p.brand), ''), NULLIF(btrim(p.operator), '')) AS chain_identity,
             COUNT(*)::int AS places,
             COUNT(*) FILTER (WHERE lower(coalesce(p.status, '')) LIKE 'closed%')::int AS closed_places
      FROM ${table} p
      WHERE COALESCE(NULLIF(btrim(p.brand_wikidata), ''), NULLIF(btrim(p.operator_wikidata), ''),
                     NULLIF(btrim(p.brand), ''), NULLIF(btrim(p.operator), '')) IS NOT NULL
      GROUP BY 1
      HAVING COUNT(*) > 1
      ORDER BY places DESC, chain_identity
      LIMIT $1
    `, [limitArg])
    report.chain_coverage = chains.rows
  }

  report.counts = Object.fromEntries(Object.entries(report)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length]))

  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`# Lifecycle Quality Report (${entityArg})`)
    console.log(`Generated: ${report.generated_at}`)
    console.log(`Replacements: ${report.replacements.length}`)
    console.log(`Closed/stale listings: ${report.closed_or_stale.length}`)
    console.log(`Same-location conflicts: ${report.same_location_conflicts.length}`)
    console.log(`Chain coverage groups: ${report.chain_coverage.length}`)
  }
} finally {
  await client.end().catch(() => {})
}
