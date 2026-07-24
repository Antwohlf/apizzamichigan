#!/usr/bin/env node

/**
 * Read-only report for source records whose business name changed at the same
 * exact OSM identity. Personal history is deliberately reported separately;
 * this script never changes a place or a review decision. An exact OSM
 * identity does not prove that a business rename is safe: the same location
 * can contain a successor business.
 */

import pg from 'pg'

const entity = process.argv.includes('--entity')
  ? process.argv[process.argv.indexOf('--entity') + 1]
  : 'pizza'

const tables = { pizza: 'pizza_places', taco: 'taco_places' }
if (!tables[entity]) throw new Error(`Unsupported entity: ${entity}`)

const env = process.env
const pool = new pg.Pool({
  host: env.LOCAL_DB_HOST || env.PGHOST || '127.0.0.1',
  port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
  database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
  user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
  password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
})

try {
  const { rows } = await pool.query(`
    SELECT
      srq.id,
      srq.source,
      srq.source_id,
      srq.source_name,
      p.id AS place_id,
      p.name AS current_name,
      p.status,
      p.rating,
      NULLIF(btrim(p.notes), '') IS NOT NULL AS has_notes,
      CASE
        WHEN p.status <> 'unvisited' OR p.rating IS NOT NULL OR NULLIF(btrim(p.notes), '') IS NOT NULL
        THEN 'history_requires_review'
        ELSE 'unreviewed_identity_change_requires_review'
      END AS handling
    FROM source_review_queue srq
    JOIN ${tables[entity]} p ON p.id = srq.nearest_place_id
    WHERE srq.entity_type = $1
      AND srq.status = 'pending'
      AND srq.review_kind = 'ambiguous'
      AND srq.source = 'osm'
      AND srq.source_id = p.google_place_id
      AND lower(regexp_replace(coalesce(srq.source_name, ''), '[^a-z0-9]+', ' ', 'g'))
        <> lower(regexp_replace(coalesce(p.name, ''), '[^a-z0-9]+', ' ', 'g'))
    ORDER BY srq.id
  `, [entity])

  const report = {
    entity,
    generated_at: new Date().toISOString(),
    total: rows.length,
    unreviewed_identity_change_requires_review: rows.filter(row => row.handling === 'unreviewed_identity_change_requires_review').length,
    history_requires_review: rows.filter(row => row.handling === 'history_requires_review').length,
    rows,
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Replacement candidates (${entity})`)
    console.log(`Total: ${report.total}`)
    console.log(`Unreviewed identity changes requiring review: ${report.unreviewed_identity_change_requires_review}`)
    console.log(`History requires review: ${report.history_requires_review}`)
    for (const row of rows) {
      console.log(`- #${row.id}: ${row.current_name} -> ${row.source_name} [${row.handling}]`)
    }
  }
} finally {
  await pool.end()
}
