#!/usr/bin/env node

/** Read-only source quality, review-risk, and canonical duplicate report. */

import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const json = process.argv.includes('--json');
const entity = process.argv.includes('--entity')
  ? process.argv[process.argv.indexOf('--entity') + 1]
  : 'pizza';
const duplicateLimit = Math.min(1000, Math.max(1, Number.parseInt(
  process.argv.includes('--duplicate-limit')
    ? process.argv[process.argv.indexOf('--duplicate-limit') + 1]
    : '25', 10,
)));
const duplicateRateLimit = Math.max(0, Number.parseFloat(
  process.argv.includes('--duplicate-rate-limit')
    ? process.argv[process.argv.indexOf('--duplicate-rate-limit') + 1]
    : '1',
));
const tables = { pizza: 'pizza_places', taco: 'taco_places' };
if (!tables[entity]) throw new Error('Invalid --entity. Use pizza or taco.');

function envFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
    .map(line => { const [key, ...rest] = line.split('='); return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')]; }));
}
const env = { ...envFile(resolve(process.cwd(), '.env')), ...envFile(resolve(process.cwd(), '.env.local')), ...process.env };
const client = new pg.Client({
  host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
  port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
  database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
  user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
  password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
});

function table(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [`| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${keys.map(key => String(row[key] ?? '')).join(' | ')} |`)].join('\n');
}

try {
  await client.connect();
  const canonical = await client.query(`
    WITH normalized AS MATERIALIZED (
      SELECT id, name, state, lat, lng,
             regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') AS name_key
      FROM ${tables[entity]}
      WHERE name IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
    ), duplicate_keys AS (
      SELECT name_key FROM normalized GROUP BY name_key HAVING COUNT(*) BETWEEN 2 AND 25
    ), pairs AS (
      SELECT a.id AS left_id, b.id AS right_id, a.name, a.state,
             ROUND((111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2)))::numeric, 1) AS distance_m
      FROM normalized a JOIN duplicate_keys dk ON dk.name_key = a.name_key
      JOIN normalized b ON a.name_key = b.name_key AND a.id < b.id
      WHERE abs(a.lat - b.lat) <= 0.003
        AND abs(a.lng - b.lng) <= 0.003
        AND (111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2))) <= 250
    )
    SELECT COUNT(*)::int AS likely_duplicate_pairs,
           COUNT(DISTINCT left_id)::int AS affected_left_rows,
           COUNT(DISTINCT right_id)::int AS affected_right_rows,
           COALESCE(MIN(distance_m), 0) AS closest_distance_m
    FROM pairs
  `);
  const canonicalTotal = await client.query(`SELECT COUNT(*)::int AS total FROM ${tables[entity]}`);
  const duplicateStats = canonical.rows[0];
  const canonicalTotalRows = Number(canonicalTotal.rows[0].total || 0);
  const affectedRows = Number(duplicateStats.affected_left_rows || 0) + Number(duplicateStats.affected_right_rows || 0);
  duplicateStats.canonical_total = canonicalTotalRows;
  duplicateStats.affected_row_rate_percent = canonicalTotalRows
    ? Number(((affectedRows / canonicalTotalRows) * 100).toFixed(3))
    : 0;
  duplicateStats.pairs_per_1000_rows = canonicalTotalRows
    ? Number(((Number(duplicateStats.likely_duplicate_pairs || 0) / canonicalTotalRows) * 1000).toFixed(3))
    : 0;
  duplicateStats.rate_status = duplicateStats.affected_row_rate_percent > duplicateRateLimit ? 'over_limit' : 'within_limit';
  const duplicateSamples = await client.query(`
    WITH normalized AS MATERIALIZED (
      SELECT id, name, state, lat, lng, regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') AS name_key
      FROM ${tables[entity]} WHERE name IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
    ), duplicate_keys AS (
      SELECT name_key FROM normalized GROUP BY name_key HAVING COUNT(*) BETWEEN 2 AND 25
    )
    SELECT a.id AS left_id, b.id AS right_id, a.name, a.state,
      ROUND((111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2)))::numeric, 1) AS distance_m
    FROM normalized a JOIN duplicate_keys dk ON dk.name_key = a.name_key
      JOIN normalized b ON a.name_key = b.name_key AND a.id < b.id
    WHERE abs(a.lat - b.lat) <= 0.003 AND abs(a.lng - b.lng) <= 0.003
      AND (111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2))) <= 250
    ORDER BY distance_m, a.id LIMIT $1
  `, [duplicateLimit]);
  const evidence = await client.query(`
    SELECT source, COUNT(*)::int AS rows,
      COUNT(*) FILTER (WHERE match_confidence IS NULL)::int AS missing_confidence,
      COUNT(*) FILTER (WHERE match_confidence < 0.85)::int AS below_085,
      COUNT(DISTINCT place_id)::int AS canonical_places
    FROM place_sources WHERE entity_type = $1 GROUP BY source ORDER BY source
  `, [entity]);
  const reviewExists = await client.query(`SELECT to_regclass('public.source_review_queue') IS NOT NULL AS exists`);
  const review = reviewExists.rows[0].exists ? await client.query(`
    SELECT source, review_kind, status, COUNT(*)::int AS rows,
      COUNT(*) FILTER (WHERE nearest_place_id IS NOT NULL)::int AS linked_nearby
    FROM source_review_queue WHERE entity_type = $1
    GROUP BY source, review_kind, status ORDER BY source, review_kind, status
  `, [entity]) : { rows: [] };
  const acceptedDuplicateCoordinate = reviewExists.rows[0].exists ? await client.query(`
    WITH accepted AS (
      SELECT id, source, source_name,
        regexp_replace(lower(coalesce(source_name, '')), '[^a-z0-9]+', '', 'g') AS name_key,
        COALESCE(NULLIF(source_data->>'lat', ''), NULLIF(source_data->>'latitude', ''))::double precision AS lat,
        COALESCE(NULLIF(source_data->>'lng', ''), NULLIF(source_data->>'lon', ''), NULLIF(source_data->>'longitude', ''))::double precision AS lng
      FROM source_review_queue
      WHERE entity_type = $1 AND review_kind = 'likely_new' AND status = 'accepted'
        AND COALESCE(NULLIF(source_data->>'lat', ''), NULLIF(source_data->>'latitude', '')) IS NOT NULL
        AND COALESCE(NULLIF(source_data->>'lng', ''), NULLIF(source_data->>'lon', ''), NULLIF(source_data->>'longitude', '')) IS NOT NULL
    ), pairs AS (
      SELECT a.id AS left_id, b.id AS right_id, a.source,
        a.source_name AS left_name, b.source_name AS right_name,
        a.name_key = b.name_key AS same_name,
        ROUND((111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2)))::numeric, 2) AS distance_m
      FROM accepted a JOIN accepted b ON a.source = b.source AND a.id < b.id
      WHERE abs(a.lat - b.lat) <= 0.003 AND abs(a.lng - b.lng) <= 0.003
        AND (111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2))) <= 150
    )
    SELECT COUNT(*)::int AS pairs, COUNT(DISTINCT left_id)::int AS affected_rows,
      COUNT(*) FILTER (WHERE same_name)::int AS identical_name_pairs,
      COUNT(*) FILTER (WHERE NOT same_name)::int AS conflicting_name_pairs,
      COUNT(DISTINCT left_id) FILTER (WHERE NOT same_name)::int AS conflicting_affected_rows,
      COALESCE(MIN(distance_m), 0) AS closest_distance_m
    FROM pairs
  `, [entity]) : { rows: [{ pairs: 0, affected_rows: 0, closest_distance_m: 0 }] };
  const acceptedDuplicateSamples = reviewExists.rows[0].exists ? await client.query(`
    WITH accepted AS (
      SELECT id, source, source_name,
        regexp_replace(lower(coalesce(source_name, '')), '[^a-z0-9]+', '', 'g') AS name_key,
        COALESCE(NULLIF(source_data->>'lat', ''), NULLIF(source_data->>'latitude', ''))::double precision AS lat,
        COALESCE(NULLIF(source_data->>'lng', ''), NULLIF(source_data->>'lon', ''), NULLIF(source_data->>'longitude', ''))::double precision AS lng
      FROM source_review_queue
      WHERE entity_type = $1 AND review_kind = 'likely_new' AND status = 'accepted'
        AND COALESCE(NULLIF(source_data->>'lat', ''), NULLIF(source_data->>'latitude', '')) IS NOT NULL
        AND COALESCE(NULLIF(source_data->>'lng', ''), NULLIF(source_data->>'lon', ''), NULLIF(source_data->>'longitude', '')) IS NOT NULL
    )
    SELECT a.id AS left_id, b.id AS right_id, a.source,
      a.source_name AS left_name, b.source_name AS right_name,
      a.name_key = b.name_key AS same_name,
      ROUND((111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2)))::numeric, 2) AS distance_m
    FROM accepted a JOIN accepted b ON a.source = b.source AND a.id < b.id
    WHERE abs(a.lat - b.lat) <= 0.003 AND abs(a.lng - b.lng) <= 0.003
      AND (111320 * sqrt(power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2))) <= 150
    ORDER BY distance_m, a.id LIMIT 25
  `, [entity]) : { rows: [] };
  const report = { entity, checked_at: new Date().toISOString(), duplicate_rate_limit_percent: duplicateRateLimit, canonical: duplicateStats, duplicate_samples: duplicateSamples.rows, evidence: evidence.rows, review_queue: review.rows, accepted_duplicate_coordinates: { ...acceptedDuplicateCoordinate.rows[0], samples: acceptedDuplicateSamples.rows } };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`# Source Quality Report (${entity})`);
    console.log(`Checked at: ${report.checked_at}`);
    console.log('');
    console.log('## Likely Canonical Duplicate Risk');
    console.log(`Duplicate rate limit: ${duplicateRateLimit}%`);
    console.log(table([duplicateStats]));
    console.log('');
    console.log('## Evidence Quality');
    console.log(table(evidence.rows));
    console.log('');
    console.log('## Review Queue Risk');
    console.log(table(review.rows));
    console.log('');
    console.log('## Accepted Review Rows Blocked by Same-Source Coordinates');
    console.log(table([acceptedDuplicateCoordinate.rows[0]]));
    console.log(table(acceptedDuplicateSamples.rows));
    console.log('');
    console.log('## Duplicate Samples');
    console.log(table(duplicateSamples.rows));
  }
} finally {
  await client.end().catch(() => {});
}
