#!/usr/bin/env node
/** Read-only canonical identity and source-link integrity report. */

import pg from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const entity = process.argv.includes('--entity') ? process.argv[process.argv.indexOf('--entity') + 1] : 'pizza'
const json = process.argv.includes('--json')
const table = entity === 'taco' ? 'taco_places' : entity === 'pizza' ? 'pizza_places' : null
if (!table) throw new Error('Invalid --entity. Use pizza or taco.')

function envFile(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
    .map(line => { const [key, ...rest] = line.split('='); return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')] }))
}

const env = { ...envFile(resolve(process.cwd(), '.env')), ...envFile(resolve(process.cwd(), '.env.local')), ...process.env }
const client = new pg.Client({
  host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
  port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
  database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
  user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
  password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || ''
})

await client.connect()
try {
  const result = {}
  result.canonical = (await client.query(`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE google_place_id IS NULL OR btrim(google_place_id) = '')::int AS missing_external_id,
      COUNT(*) FILTER (WHERE google_place_id LIKE 'osm:%')::int AS osm_ids,
      COUNT(*) FILTER (WHERE google_place_id IS NOT NULL AND google_place_id NOT LIKE 'osm:%')::int AS non_osm_ids
    FROM ${table}
  `)).rows[0]
  result.missingExternalIdByStatus = (await client.query(`
    SELECT COALESCE(status, '(null)') AS status, COUNT(*)::int AS rows
    FROM ${table}
    WHERE google_place_id IS NULL OR btrim(google_place_id) = ''
    GROUP BY status ORDER BY rows DESC, status
  `)).rows
  result.missingExternalIdSamples = (await client.query(`
    SELECT id, name, state, status
    FROM ${table}
    WHERE google_place_id IS NULL OR btrim(google_place_id) = ''
    ORDER BY id LIMIT 25
  `)).rows
  result.duplicateExternalIds = (await client.query(`
    SELECT google_place_id, COUNT(*)::int AS rows
    FROM ${table}
    WHERE google_place_id IS NOT NULL AND btrim(google_place_id) <> ''
    GROUP BY google_place_id HAVING COUNT(*) > 1
    ORDER BY rows DESC, google_place_id LIMIT 25
  `)).rows
  result.malformedOsmIds = (await client.query(`
    SELECT id, name, google_place_id
    FROM ${table}
    WHERE google_place_id LIKE 'osm:%'
      AND google_place_id !~ '^osm:(node|way|relation)/[0-9]+$'
    ORDER BY id LIMIT 25
  `)).rows
  const hasSources = (await client.query(`SELECT to_regclass('public.place_sources') IS NOT NULL AS exists`)).rows[0].exists
  result.placeSources = { exists: hasSources }
  if (hasSources) {
    result.missingPrimaryEvidence = (await client.query(`
      SELECT COUNT(*)::int AS rows
      FROM ${table} p
      WHERE p.google_place_id LIKE 'osm:%'
        AND NOT EXISTS (
          SELECT 1 FROM place_sources ps
          WHERE ps.entity_type = $1 AND ps.source = 'osm'
            AND ps.source_id = regexp_replace(p.google_place_id, '^osm:', '')
        )
    `, [entity])).rows[0]
    result.sourceIdentityCollisions = (await client.query(`
      SELECT source, source_id, COUNT(*)::int AS rows
      FROM place_sources
      WHERE entity_type = $1 AND source_id IS NOT NULL
      GROUP BY source, source_id HAVING COUNT(*) > 1
      ORDER BY rows DESC, source, source_id LIMIT 25
    `, [entity])).rows
  }
  const hasExplicitIds = (await client.query(`SELECT to_regclass('public.place_external_ids') IS NOT NULL AS exists`)).rows[0].exists
  result.placeExternalIds = { exists: hasExplicitIds }
  if (hasExplicitIds) {
    result.missingExplicitIds = (await client.query(`
      SELECT COUNT(*)::int AS rows
      FROM ${table} p
      WHERE NULLIF(btrim(p.google_place_id), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM place_external_ids pei
          WHERE pei.entity_type = $1
            AND pei.place_id = p.id
            AND pei.is_primary
            AND pei.source = CASE WHEN p.google_place_id LIKE 'osm:%' THEN 'osm' ELSE 'legacy' END
            AND pei.external_id = CASE WHEN p.google_place_id LIKE 'osm:%'
              THEN regexp_replace(p.google_place_id, '^osm:', '')
              ELSE p.google_place_id END
        )
    `, [entity])).rows[0]
    result.orphanExplicitIds = (await client.query(`
      SELECT pei.source, pei.external_id, pei.place_id
      FROM place_external_ids pei
      LEFT JOIN ${table} p ON p.id = pei.place_id
      WHERE pei.entity_type = $1 AND p.id IS NULL
      ORDER BY pei.id LIMIT 25
    `, [entity])).rows
  }
  if (json) console.log(JSON.stringify({ entity, checked_at: new Date().toISOString(), ...result }, null, 2))
  else {
    console.log(`# Identity Quality Report (${entity})`)
    console.log(JSON.stringify(result.canonical, null, 2))
    console.log(`place_sources=${result.placeSources.exists ? 'present' : 'missing'}`)
    console.log(`place_external_ids=${result.placeExternalIds.exists ? 'present' : 'missing'}`)
    if (result.missingExplicitIds) console.log(`missing_explicit_primary_ids=${result.missingExplicitIds.rows}`)
    if (result.orphanExplicitIds) console.log(`orphan_explicit_id_samples=${result.orphanExplicitIds.length}`)
    if (result.missingPrimaryEvidence) console.log(`missing_primary_osm_evidence=${result.missingPrimaryEvidence.rows}`)
    console.log(`duplicate_external_id_groups=${result.duplicateExternalIds.length}`)
    console.log(`malformed_osm_id_samples=${result.malformedOsmIds.length}`)
    if (result.sourceIdentityCollisions) console.log(`source_identity_collision_groups=${result.sourceIdentityCollisions.length}`)
  }
} finally {
  await client.end().catch(() => {})
}
