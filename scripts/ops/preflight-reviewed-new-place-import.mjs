#!/usr/bin/env node
/**
 * Read-only preflight for accepted likely-new source review rows.
 *
 * This produces a candidate import report only. It never writes canonical
 * places, place_sources, source_review_queue, or Supabase.
 */

import pg from 'pg';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
};

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    source: null,
    limit: 100,
    nearbyRadiusM: 150,
    output: null,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (arg === '--nearby-radius-m') args.nearbyRadiusM = parseFloat(argv[++i]);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ENTITY_TABLES[args.entity]) throw new Error('Invalid --entity. Use pizza or taco.');
  if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error('Invalid --limit');
  if (!Number.isFinite(args.nearbyRadiusM) || args.nearbyRadiusM <= 0) throw new Error('Invalid --nearby-radius-m');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/preflight-reviewed-new-place-import.mjs [options]

Options:
  --entity <pizza|taco>       Entity type (default pizza)
  --source <key>              Optional source filter
  --limit <n>                 Candidate row limit (default 100)
  --nearby-radius-m <n>       Duplicate warning radius in meters (default 150)
  --output <file>             Optional CSV output path
  --json                      Emit JSON instead of Markdown

This is read-only. It inspects accepted likely_new source_review_queue rows and
reports whether they have enough data for a future canonical import review.
`);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const txt = readFileSync(path, 'utf8');
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

function dbConfig() {
  const env = {
    ...loadEnvFile(resolve(process.cwd(), '.env')),
    ...loadEnvFile(resolve(process.cwd(), '.env.local')),
    ...process.env,
  };

  return {
    host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
    port: parseInt(env.LOCAL_DB_PORT || env.PGPORT || '5432', 10),
    database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
  };
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function csvCell(value) {
  const text = value == null ? '' : String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceCoordinate(row, keys) {
  for (const key of keys) {
    const value = toNumber(row.source_data?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function sourceAddress(row) {
  return row.source_data?.address || row.source_data?.['addr:full'] || null;
}

function candidatePayload(row) {
  const lat = sourceCoordinate(row, ['lat', 'latitude']);
  const lng = sourceCoordinate(row, ['lng', 'lon', 'longitude']);
  const sourceKey = String(row.source || '').trim();
  const sourceId = String(row.source_id || '').trim();
  return {
    name: row.source_name || row.source_data?.name || null,
    lat,
    lng,
    address: sourceAddress(row),
    google_place_id: sourceKey && sourceId ? `${sourceKey}:${sourceId}` : null,
    state: row.source_data?.region || row.source_data?.state || row.source_data?.country || null,
    status: 'unvisited',
    address_source: row.source || null,
    website_url: row.source_data?.website || row.source_data?.['contact:website'] || null,
    phone: row.source_data?.phone || row.source_data?.['contact:phone'] || null,
    enrichment_status: 'pending',
  };
}

async function sourceReviewQueueExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'source_review_queue'
    ) AS exists
  `);
  return Boolean(result.rows[0]?.exists);
}

async function fetchReviewRows(client, args) {
  const filters = [
    `entity_type = $1`,
    `review_kind = 'likely_new'`,
    `status = 'accepted'`,
  ];
  const values = [args.entity];

  if (args.source) {
    values.push(args.source);
    filters.push(`source = $${values.length}`);
  }

  values.push(args.limit);
  const result = await client.query(`
    SELECT
      id,
      entity_type,
      source,
      source_id,
      source_name,
      source_url,
      source_data,
      reviewer_notes,
      reviewed_at,
      reviewed_by,
      report_file
    FROM source_review_queue
    WHERE ${filters.join(' AND ')}
    ORDER BY reviewed_at NULLS LAST, source_name NULLS LAST, id
    LIMIT $${values.length}
  `, values);

  return result.rows;
}

async function findNearby(client, tableName, payload, radiusM) {
  if (payload.lat === null || payload.lng === null) return [];
  const result = await client.query(`
    SELECT
      id,
      name,
      state,
      google_place_id,
      ROUND((
        6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(($1 - lat) / 2)), 2) +
          COS(RADIANS(lat)) * COS(RADIANS($1)) *
          POWER(SIN(RADIANS(($2 - lng) / 2)), 2)
        ))
      )::numeric, 2) AS distance_m
    FROM ${tableName}
    WHERE lat BETWEEN $1 - ($3 / 111320.0) AND $1 + ($3 / 111320.0)
      AND lng BETWEEN $2 - ($3 / (111320.0 * GREATEST(COS(RADIANS($1)), 0.01)))
                  AND $2 + ($3 / (111320.0 * GREATEST(COS(RADIANS($1)), 0.01)))
      AND (
        6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(($1 - lat) / 2)), 2) +
          COS(RADIANS(lat)) * COS(RADIANS($1)) *
          POWER(SIN(RADIANS(($2 - lng) / 2)), 2)
        ))
      ) <= $3
    ORDER BY distance_m ASC
    LIMIT 3
  `, [payload.lat, payload.lng, radiusM]);
  return result.rows;
}

async function googlePlaceIdExists(client, tableName, googlePlaceId) {
  if (!googlePlaceId) return false;
  const result = await client.query(`SELECT id FROM ${tableName} WHERE google_place_id = $1 LIMIT 1`, [googlePlaceId]);
  return Boolean(result.rows[0]);
}

function readiness(payload, duplicateBySourceId, nearbyRows) {
  const missing = [];
  if (!payload.name) missing.push('name');
  if (payload.lat === null) missing.push('lat');
  if (payload.lng === null) missing.push('lng');
  if (!payload.google_place_id) missing.push('source_id');
  if (missing.length) return `missing_${missing.join('_')}`;
  if (duplicateBySourceId) return 'duplicate_source_id';
  if (nearbyRows.length) return 'nearby_canonical_review';
  return 'candidate_ready';
}

async function buildReport(client, args) {
  const tableName = ENTITY_TABLES[args.entity];
  const rows = await fetchReviewRows(client, args);
  const candidates = [];

  for (const row of rows) {
    const payload = candidatePayload(row);
    const duplicateBySourceId = await googlePlaceIdExists(client, tableName, payload.google_place_id);
    const nearbyRows = await findNearby(client, tableName, payload, args.nearbyRadiusM);
    candidates.push({
      review_id: row.id,
      entity_type: row.entity_type,
      source: row.source,
      source_id: row.source_id,
      source_name: row.source_name,
      proposed_google_place_id: payload.google_place_id,
      proposed_name: payload.name,
      proposed_lat: payload.lat,
      proposed_lng: payload.lng,
      proposed_address: payload.address,
      proposed_state: payload.state,
      proposed_website_url: payload.website_url,
      proposed_phone: payload.phone,
      readiness: readiness(payload, duplicateBySourceId, nearbyRows),
      nearby_count: nearbyRows.length,
      nearest_place_id: nearbyRows[0]?.id || null,
      nearest_place_name: nearbyRows[0]?.name || null,
      nearest_distance_m: nearbyRows[0]?.distance_m || null,
      reviewed_at: row.reviewed_at,
      report_file: row.report_file,
    });
  }

  const readinessCounts = candidates.reduce((acc, row) => {
    acc[row.readiness] = (acc[row.readiness] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    entity: args.entity,
    source: args.source || 'all',
    tableName,
    nearbyRadiusM: args.nearbyRadiusM,
    rowsInspected: rows.length,
    readinessCounts,
    candidates,
  };
}

function writeCsv(report, output) {
  const headers = [
    'review_id',
    'entity_type',
    'source',
    'source_id',
    'source_name',
    'proposed_google_place_id',
    'proposed_name',
    'proposed_lat',
    'proposed_lng',
    'proposed_address',
    'proposed_state',
    'proposed_website_url',
    'proposed_phone',
    'readiness',
    'nearby_count',
    'nearest_place_id',
    'nearest_place_name',
    'nearest_distance_m',
    'reviewed_at',
    'report_file',
  ];
  const csv = [
    headers.join(','),
    ...report.candidates.map(row => headers.map(header => csvCell(row[header])).join(',')),
  ].join('\n');
  const outputPath = resolve(process.cwd(), output);
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, `${csv}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const client = new pg.Client(dbConfig());
  await client.connect();

  try {
    if (!(await sourceReviewQueueExists(client))) {
      throw new Error('source_review_queue table does not exist.');
    }

    const report = await buildReport(client, args);
    if (args.output) writeCsv(report, args.output);

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log('# Reviewed New Place Import Preflight');
    console.log('');
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`Entity: ${report.entity}`);
    console.log(`Source: ${report.source}`);
    console.log(`Canonical table: ${report.tableName}`);
    console.log(`Nearby duplicate radius: ${report.nearbyRadiusM}m`);
    console.log(`Accepted likely-new rows inspected: ${report.rowsInspected}`);
    if (args.output) console.log(`CSV output: ${args.output}`);
    console.log('');
    console.log('## Readiness Counts');
    console.log(table(
      ['readiness', 'count'],
      Object.entries(report.readinessCounts).map(([readiness, count]) => ({ readiness, count }))
    ));
    console.log('');
    console.log('## Candidate Samples');
    console.log(table(
      ['review_id', 'source', 'source_name', 'proposed_lat', 'proposed_lng', 'readiness', 'nearest_place_name', 'nearest_distance_m'],
      report.candidates.slice(0, 25)
    ));
    console.log('');
    console.log('No canonical places, place_sources rows, source_review_queue rows, or Supabase records were written.');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`preflight-reviewed-new-place-import failed: ${error.message || error}`);
  process.exit(1);
});
