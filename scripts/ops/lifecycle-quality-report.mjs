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
const allStates = process.argv.includes('--all-states')
const stateArgIndex = process.argv.indexOf('--states')
const explicitStates = (stateArgIndex >= 0 ? process.argv[stateArgIndex + 1] : process.env.LIFECYCLE_REPORT_STATES || '')
  .split(',')
  .map(value => value.trim().toUpperCase())
  .filter(Boolean)
const tables = { pizza: 'pizza_places', taco: 'taco_places' }

if (!tables[entityArg]) throw new Error('Invalid --entity. Use pizza or taco.')
if (!Number.isInteger(limitArg) || limitArg < 1 || limitArg > 500) throw new Error('Invalid --limit. Use 1-500.')

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const pipeline = readJson(resolve(process.cwd(), 'config/source-pipeline.json'))
const sourcePolicy = readJson(resolve(process.cwd(), 'config/source-policy.json'))
const entityProfiles = readJson(resolve(process.cwd(), 'config/entity-profiles.json'))
const configuredStates = pipeline?.entity === entityArg
  ? (pipeline.regions || []).map(region => String(region.key).toUpperCase())
  : (entityProfiles?.profiles?.[entityArg]?.regions || []).map(region => String(region).toUpperCase())
const states = allStates ? [] : (explicitStates.length ? explicitStates : configuredStates)
const sourceFreshnessCase = Object.entries(sourcePolicy?.sources || {})
  .map(([source, config]) => `WHEN '${source.replaceAll("'", "''")}' THEN ${Number(config.freshness_days) || 365}`)
  .join(' ')
  || 'WHEN \'__missing_policy__\' THEN 365'

function normalizeOsmSourceId(value) {
  return String(value || '').trim().replace(/^osm:/i, '')
}

function latestOsmInputs() {
  const regionKeys = states.length
    ? states
    : (pipeline?.operational_regions || pipeline?.regions || [])
      .map(region => typeof region === 'string' ? region : region.key)
      .filter(Boolean)
      .map(region => String(region).toUpperCase())
  const files = regionKeys
    .map(region => resolve(process.cwd(), 'reports', 'osm', `${region.toLowerCase()}-${entityArg}.json`))
    .filter(existsSync)
  const ids = new Set()
  for (const file of files) {
    try {
      const payload = JSON.parse(readFileSync(file, 'utf8'))
      const rows = Array.isArray(payload) ? payload : payload?.rows
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        const id = normalizeOsmSourceId(row?.id || row?.source_id)
        if (id) ids.add(id)
      }
    } catch {
      // A malformed input cannot prove that a source was observed.
    }
  }
  return { files, ids }
}

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
    scope: states.length ? { states } : { states: 'all' },
    available,
    replacements: [],
    closed_or_stale: [],
    closed_signals: [],
    same_location_conflicts: [],
    chain_coverage: [],
    totals: {
      replacements: 0,
      stale_evidence: 0,
      stale_places: 0,
      stale_observed_in_latest_input: 0,
      stale_unobserved_in_latest_input: 0,
      stale_observation_unknown: 0,
      closed_signals: 0,
      same_location_conflicts: 0,
      chain_coverage_groups: 0,
    },
  }

  if (available.review_queue) {
    const replacements = await client.query(`
      SELECT srq.id, srq.source, srq.source_id, srq.source_name,
             p.id AS place_id, p.name AS current_name, p.status, p.rating,
             p.notes,
             CASE WHEN p.status <> 'unvisited' OR p.rating IS NOT NULL
                    OR NULLIF(btrim(p.notes), '') IS NOT NULL
                  THEN 'history_requires_review'
                  ELSE 'unreviewed_identity_change_requires_review'
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
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($3::text[])" : ''}
      ORDER BY srq.id
      LIMIT $2
      `, states.length ? [entityArg, limitArg, states] : [entityArg, limitArg])
    report.replacements = replacements.rows

    const replacementTotal = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM source_review_queue srq
      JOIN ${table} p ON p.id = srq.nearest_place_id
      WHERE srq.entity_type = $1
        AND srq.status = 'pending'
        AND srq.review_kind = 'ambiguous'
        AND srq.source = 'osm'
        AND srq.source_id = p.google_place_id
        AND lower(regexp_replace(coalesce(srq.source_name, ''), '[^a-z0-9]+', ' ', 'g'))
          <> lower(regexp_replace(coalesce(p.name, ''), '[^a-z0-9]+', ' ', 'g'))
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($2::text[])" : ''}
    `, states.length ? [entityArg, states] : [entityArg])
    report.totals.replacements = Number(replacementTotal.rows[0]?.total || 0)
  }

  if (available.place_sources) {
    const latestInputs = latestOsmInputs()
    const stale = await client.query(`
      WITH latest_source AS (
        SELECT DISTINCT ON (ps.place_id, ps.source)
               ps.place_id, ps.source, ps.source_id, ps.retrieved_at, ps.data
        FROM place_sources ps
        WHERE ps.entity_type = $1
        ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
      )
      SELECT p.id AS place_id, p.name, p.state, p.status,
             latest_source.source, latest_source.source_id, latest_source.retrieved_at,
             CASE latest_source.source ${sourceFreshnessCase} ELSE 180 END AS freshness_days
      FROM latest_source
      JOIN ${table} p ON p.id = latest_source.place_id
      WHERE latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source ${sourceFreshnessCase} ELSE 180 END)
        AND lower(coalesce(p.status, '')) NOT LIKE 'closed%'
        AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($3::text[])" : ''}
      ORDER BY latest_source.retrieved_at
        LIMIT $2
      `, states.length ? [entityArg, limitArg, states] : [entityArg, limitArg])
    report.closed_or_stale = stale.rows.map(row => ({
      ...row,
      observation_status: row.source === 'osm' && latestInputs.files.length
        ? latestInputs.ids.has(normalizeOsmSourceId(row.source_id))
          ? 'observed_in_latest_input'
          : 'unobserved_in_latest_input'
        : 'unknown',
    }))

    const staleTotal = await client.query(`
      WITH latest_source AS (
        SELECT DISTINCT ON (ps.place_id, ps.source)
               ps.place_id, ps.source, ps.retrieved_at
        FROM place_sources ps
        WHERE ps.entity_type = $1
        ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
      )
      SELECT COUNT(*)::int AS total
      FROM latest_source
      JOIN ${table} p ON p.id = latest_source.place_id
      WHERE latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source ${sourceFreshnessCase} ELSE 180 END)
        AND lower(coalesce(p.status, '')) NOT LIKE 'closed%'
        AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($2::text[])" : ''}
    `, states.length ? [entityArg, states] : [entityArg])
    report.totals.stale_evidence = Number(staleTotal.rows[0]?.total || 0)

    const stalePlaceTotal = await client.query(`
      WITH latest_source AS (
        SELECT DISTINCT ON (ps.place_id, ps.source)
               ps.place_id, ps.source, ps.retrieved_at
        FROM place_sources ps
        WHERE ps.entity_type = $1
        ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
      )
      SELECT COUNT(DISTINCT p.id)::int AS total
      FROM latest_source
      JOIN ${table} p ON p.id = latest_source.place_id
      WHERE latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source ${sourceFreshnessCase} ELSE 180 END)
        AND lower(coalesce(p.status, '')) NOT LIKE 'closed%'
        AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($2::text[])" : ''}
    `, states.length ? [entityArg, states] : [entityArg])
    report.totals.stale_places = Number(stalePlaceTotal.rows[0]?.total || 0)

    const staleObservation = await client.query(`
      WITH latest_source AS (
        SELECT DISTINCT ON (ps.place_id, ps.source)
               ps.place_id, ps.source, ps.source_id, ps.retrieved_at
        FROM place_sources ps
        WHERE ps.entity_type = $1
        ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
      )
      SELECT
        COUNT(*) FILTER (
          WHERE latest_source.source = 'osm'
            AND $2::boolean
            AND regexp_replace(COALESCE(latest_source.source_id, ''), '^osm:', '', 'i') = ANY($3::text[])
        )::int AS observed,
        COUNT(*) FILTER (
          WHERE latest_source.source = 'osm'
            AND $2::boolean
            AND regexp_replace(COALESCE(latest_source.source_id, ''), '^osm:', '', 'i') <> ALL($3::text[])
        )::int AS unobserved,
        COUNT(*) FILTER (WHERE latest_source.source <> 'osm' OR NOT $2::boolean)::int AS unknown
      FROM latest_source
      JOIN ${table} p ON p.id = latest_source.place_id
      WHERE latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source ${sourceFreshnessCase} ELSE 180 END)
        AND lower(coalesce(p.status, '')) NOT LIKE 'closed%'
        AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($4::text[])" : ''}
    `, states.length
      ? [entityArg, latestInputs.files.length > 0, [...latestInputs.ids], states]
      : [entityArg, latestInputs.files.length > 0, [...latestInputs.ids]])
    report.totals.stale_observed_in_latest_input = Number(staleObservation.rows[0]?.observed || 0)
    report.totals.stale_unobserved_in_latest_input = Number(staleObservation.rows[0]?.unobserved || 0)
    report.totals.stale_observation_unknown = Number(staleObservation.rows[0]?.unknown || 0)

    const closedSignals = await client.query(`
      WITH latest_source AS (
        SELECT DISTINCT ON (ps.place_id, ps.source)
               ps.place_id, ps.source, ps.source_id, ps.retrieved_at,
               ps.data, ps.match_method
        FROM place_sources ps
        WHERE ps.entity_type = $1
        ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
      )
      SELECT p.id AS place_id, p.name, p.state, p.status,
             latest_source.source, latest_source.source_id,
             latest_source.retrieved_at, latest_source.match_method,
             latest_source.data->>'source_url' AS source_url
      FROM latest_source
      JOIN ${table} p ON p.id = latest_source.place_id
      WHERE lower(coalesce(p.status, '')) NOT LIKE 'closed%'
        AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        AND latest_source.data->>'is_closed' = 'true'
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($3::text[])" : ''}
      ORDER BY latest_source.retrieved_at DESC NULLS LAST
      LIMIT $2
    `, states.length ? [entityArg, limitArg, states] : [entityArg, limitArg])
    report.closed_signals = closedSignals.rows

    const closedSignalTotal = await client.query(`
      WITH latest_source AS (
        SELECT DISTINCT ON (ps.place_id, ps.source)
               ps.place_id, ps.source, ps.retrieved_at, ps.data
        FROM place_sources ps
        WHERE ps.entity_type = $1
        ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
      )
      SELECT COUNT(*)::int AS total
      FROM latest_source
      JOIN ${table} p ON p.id = latest_source.place_id
      WHERE lower(coalesce(p.status, '')) NOT LIKE 'closed%'
        AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        AND latest_source.data->>'is_closed' = 'true'
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($2::text[])" : ''}
    `, states.length ? [entityArg, states] : [entityArg])
    report.totals.closed_signals = Number(closedSignalTotal.rows[0]?.total || 0)

    const conflicts = await client.query(`
      WITH candidates AS (
        SELECT id, name, state, lat, lng,
               ROUND(lat::numeric, 4) AS lat_bucket,
               ROUND(lng::numeric, 4) AS lng_bucket,
               lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name
        FROM ${table}
        WHERE lat IS NOT NULL AND lng IS NOT NULL
          ${states.length ? "AND UPPER(COALESCE(state, '')) = ANY($2::text[])" : ''}
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
    `, states.length ? [limitArg, states] : [limitArg])
    report.same_location_conflicts = conflicts.rows

    const conflictTotal = await client.query(`
      WITH candidates AS (
        SELECT id, name, state, lat, lng,
               ROUND(lat::numeric, 4) AS lat_bucket,
               ROUND(lng::numeric, 4) AS lng_bucket,
               lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name
        FROM ${table}
        WHERE lat IS NOT NULL AND lng IS NOT NULL
          ${states.length ? "AND UPPER(COALESCE(state, '')) = ANY($1::text[])" : ''}
      )
      SELECT COUNT(*)::int AS total
      FROM candidates a
      JOIN candidates b ON b.id > a.id
        AND b.lat_bucket = a.lat_bucket
        AND b.lng_bucket = a.lng_bucket
        AND COALESCE(a.state, '') = COALESCE(b.state, '')
        AND ABS(a.lat - b.lat) < 0.00015
        AND ABS(a.lng - b.lng) < 0.00015
        AND a.normalized_name <> b.normalized_name
    `, states.length ? [states] : [])
    report.totals.same_location_conflicts = Number(conflictTotal.rows[0]?.total || 0)

    const chains = await client.query(`
      SELECT COALESCE(NULLIF(btrim(p.brand_wikidata), ''), NULLIF(btrim(p.operator_wikidata), ''),
                      NULLIF(btrim(p.brand), ''), NULLIF(btrim(p.operator), '')) AS chain_identity,
             COUNT(*)::int AS places,
             COUNT(*) FILTER (WHERE lower(coalesce(p.status, '')) LIKE 'closed%')::int AS closed_places
      FROM ${table} p
      WHERE COALESCE(NULLIF(btrim(p.brand_wikidata), ''), NULLIF(btrim(p.operator_wikidata), ''),
                     NULLIF(btrim(p.brand), ''), NULLIF(btrim(p.operator), '')) IS NOT NULL
        ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($2::text[])" : ''}
      GROUP BY 1
      HAVING COUNT(*) > 1
      ORDER BY places DESC, chain_identity
      LIMIT $1
    `, states.length ? [limitArg, states] : [limitArg])
    report.chain_coverage = chains.rows

    const chainTotal = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT COALESCE(NULLIF(btrim(p.brand_wikidata), ''), NULLIF(btrim(p.operator_wikidata), ''),
                        NULLIF(btrim(p.brand), ''), NULLIF(btrim(p.operator), '')) AS chain_identity
        FROM ${table} p
        WHERE COALESCE(NULLIF(btrim(p.brand_wikidata), ''), NULLIF(btrim(p.operator_wikidata), ''),
                       NULLIF(btrim(p.brand), ''), NULLIF(btrim(p.operator), '')) IS NOT NULL
          ${states.length ? "AND UPPER(COALESCE(p.state, '')) = ANY($1::text[])" : ''}
        GROUP BY 1
        HAVING COUNT(*) > 1
      ) grouped_chains
    `, states.length ? [states] : [])
    report.totals.chain_coverage_groups = Number(chainTotal.rows[0]?.total || 0)
  }

  report.counts = report.totals

  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`# Lifecycle Quality Report (${entityArg})`)
    console.log(`Generated: ${report.generated_at}`)
    console.log(`Scope: ${states.length ? states.join(', ') : 'all states'}`)
    console.log(`Replacements: ${report.replacements.length}`)
    console.log(`Likely replacements: ${report.totals.replacements} (showing ${report.replacements.length})`)
    console.log(`Stale evidence rows: ${report.totals.stale_evidence} (showing ${report.closed_or_stale.length})`)
    console.log(`  OSM still present in latest input: ${report.totals.stale_observed_in_latest_input}`)
    console.log(`  OSM absent from latest input: ${report.totals.stale_unobserved_in_latest_input}`)
    console.log(`  Observation status unknown: ${report.totals.stale_observation_unknown}`)
    console.log(`Closed source signals: ${report.totals.closed_signals} (showing ${report.closed_signals.length})`)
    console.log(`Same-location conflicts: ${report.totals.same_location_conflicts} (showing ${report.same_location_conflicts.length})`)
    console.log(`Chain coverage groups: ${report.totals.chain_coverage_groups} (showing ${report.chain_coverage.length})`)
  }
} finally {
  await client.end().catch(() => {})
}
