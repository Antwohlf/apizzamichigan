#!/usr/bin/env node
/**
 * Export reviewed source_review_queue decisions to CSV.
 *
 * This is a handoff artifact for manual/import tooling. It never creates
 * canonical places, writes place_sources, or syncs to Supabase.
 */

import pg from 'pg';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const STATUS_OPTIONS = new Set(['pending', 'accepted', 'linked', 'rejected', 'ignored', 'all']);
const KIND_OPTIONS = new Set(['ambiguous', 'likely_new', 'all']);

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    status: 'accepted',
    kind: 'all',
    source: null,
    reportFile: null,
    output: 'reports/source-reviewed-candidates.csv',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--status') args.status = argv[++i];
    else if (arg === '--kind') args.kind = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['pizza', 'taco'].includes(args.entity)) throw new Error('Invalid --entity');
  if (!STATUS_OPTIONS.has(args.status)) throw new Error('Invalid --status');
  if (!KIND_OPTIONS.has(args.kind)) throw new Error('Invalid --kind');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/export-reviewed-source-candidates.mjs [options]

Options:
  --entity <pizza|taco>         Entity type (default pizza)
  --status <status|all>         Review/decision status to export
                                (default accepted)
  --kind <ambiguous|likely_new|all>
                                Review kind filter (default all)
  --source <key>                Optional source filter
  --report-file <file>          Optional report file filter
  --output <file>               CSV output path
                                (default reports/source-reviewed-candidates.csv)

This exports source_review_queue rows only. Pending exports are manual review
handoffs; reviewed exports are decision handoffs. It does not create places,
link place_sources, mutate canonical tables, or sync to Supabase.
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

function csvCell(value) {
  const text = value == null ? '' : String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
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

function rowToExport(row) {
  const sourceData = row.source_data || {};
  const sourceLat = sourceData.lat ?? sourceData.latitude ?? null;
  const sourceLng = sourceData.lng ?? sourceData.lon ?? sourceData.longitude ?? null;
  const missingSourceCoordinates = sourceLat == null || sourceLng == null;
  return {
    id: row.id,
    entity_type: row.entity_type,
    review_kind: row.review_kind,
    status: row.status,
    decision: row.decision,
    import_readiness: row.status === 'pending'
      ? 'pending_review'
      : row.status === 'accepted' && row.review_kind === 'likely_new' && missingSourceCoordinates
        ? 'missing_source_coordinates'
        : 'ready_for_handoff',
    canonical_place_id: row.canonical_place_id,
    source: row.source,
    source_id: row.source_id,
    source_name: row.source_name,
    source_url: row.source_url,
    source_lat: sourceLat,
    source_lng: sourceLng,
    source_category: sourceData.category,
    source_address: sourceData.address || sourceData['addr:full'],
    source_locality: sourceData.locality,
    source_region: sourceData.region,
    source_postcode: sourceData.postcode,
    source_country: sourceData.country,
    source_website: sourceData.website || sourceData['contact:website'],
    source_phone: sourceData.phone || sourceData['contact:phone'],
    nearest_place_id: row.nearest_place_id,
    nearest_google_place_id: row.nearest_google_place_id,
    nearest_place_name: row.nearest_place_name,
    nearest_distance_m: row.nearest_distance_m,
    nearest_name_score: row.nearest_name_score,
    review_reason: row.review_reason,
    reviewer_notes: row.reviewer_notes,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    report_file: row.report_file,
  };
}

async function fetchRows(client, args) {
  const filters = ['entity_type = $1'];
  const values = [args.entity];

  if (args.status === 'all') {
    filters.push(`status <> 'pending'`);
  } else {
    values.push(args.status);
    filters.push(`status = $${values.length}`);
  }
  if (args.kind !== 'all') {
    values.push(args.kind);
    filters.push(`review_kind = $${values.length}`);
  }
  if (args.source) {
    values.push(args.source);
    filters.push(`source = $${values.length}`);
  }
  if (args.reportFile) {
    values.push(args.reportFile);
    filters.push(`report_file = $${values.length}`);
  }

  const result = await client.query(`
    SELECT
      id,
      entity_type,
      review_kind,
      source,
      source_id,
      source_name,
      source_url,
      source_data,
      nearest_place_id,
      nearest_google_place_id,
      nearest_place_name,
      nearest_distance_m,
      nearest_name_score,
      review_reason,
      status,
      decision,
      canonical_place_id,
      reviewer_notes,
      reviewed_at,
      reviewed_by,
      report_file
    FROM source_review_queue
    WHERE ${filters.join(' AND ')}
    ORDER BY reviewed_at NULLS LAST, report_file, review_kind, source_name, id
  `, values);

  return result.rows.map(rowToExport);
}

function writeCsv(rows, output) {
  const headers = [
    'id',
    'entity_type',
    'review_kind',
    'status',
    'decision',
    'import_readiness',
    'canonical_place_id',
    'source',
    'source_id',
    'source_name',
    'source_url',
    'source_lat',
    'source_lng',
    'source_category',
    'source_address',
    'source_locality',
    'source_region',
    'source_postcode',
    'source_country',
    'source_website',
    'source_phone',
    'nearest_place_id',
    'nearest_google_place_id',
    'nearest_place_name',
    'nearest_distance_m',
    'nearest_name_score',
    'review_reason',
    'reviewer_notes',
    'reviewed_at',
    'reviewed_by',
    'report_file',
  ];
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(',')),
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
    const rows = await fetchRows(client, args);
    writeCsv(rows, args.output);
    const readinessCounts = rows.reduce((acc, row) => {
      acc[row.import_readiness] = (acc[row.import_readiness] || 0) + 1;
      return acc;
    }, {});

    console.log('# Reviewed Source Candidate Export');
    console.log('');
    console.log(`Entity: ${args.entity}`);
    console.log(`Status: ${args.status}`);
    console.log(`Kind: ${args.kind}`);
    console.log(`Rows exported: ${rows.length}`);
    console.log(`Output: ${args.output}`);
    console.log(`Readiness: ${Object.entries(readinessCounts).map(([key, count]) => `${key}=${count}`).join(', ') || 'none'}`);
    console.log('');
    console.log('No canonical places, place_sources rows, or Supabase records were written.');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`export-reviewed-source-candidates failed: ${error.message || error}`);
  process.exit(1);
});
