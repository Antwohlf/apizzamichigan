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
const READINESS_OPTIONS = new Set(['', 'all', 'link_review', 'candidate_ready', 'nearby_canonical_review', 'duplicate_accepted_source_coordinate', 'missing_required_data']);
const SCOPE_OPTIONS = new Set(['', 'chain', 'independent']);
const SOURCE_REVIEW_READINESS_SQL = `(
  CASE
    WHEN srq.review_kind <> 'likely_new' THEN 'link_review'
    WHEN COALESCE(NULLIF(srq.source_name, ''), NULLIF(srq.source_data->>'name', '')) IS NULL
      OR NULLIF(srq.source_id, '') IS NULL
      OR NOT (
        (NULLIF(srq.source_data->>'lat', '') IS NOT NULL OR NULLIF(srq.source_data->>'latitude', '') IS NOT NULL) AND
        (NULLIF(srq.source_data->>'lng', '') IS NOT NULL OR NULLIF(srq.source_data->>'lon', '') IS NOT NULL OR NULLIF(srq.source_data->>'longitude', '') IS NOT NULL)
      )
      THEN 'missing_required_data'
    WHEN srq.nearest_place_id IS NOT NULL AND srq.nearest_distance_m IS NOT NULL AND srq.nearest_distance_m <= 150 THEN 'nearby_canonical_review'
    WHEN srq.status = 'accepted' AND EXISTS (
      SELECT 1
      FROM source_review_queue peer
      WHERE peer.entity_type = srq.entity_type
        AND peer.source = srq.source
        AND peer.review_kind = 'likely_new'
        AND peer.status = 'accepted'
        AND peer.id <> srq.id
        AND NULLIF(peer.source_data->>'lat', '') IS NOT NULL
        AND NULLIF(peer.source_data->>'lng', '') IS NOT NULL
        AND NULLIF(srq.source_data->>'lat', '') IS NOT NULL
        AND NULLIF(srq.source_data->>'lng', '') IS NOT NULL
        AND (111320 * sqrt(
          power(NULLIF(peer.source_data->>'lat', '')::double precision - NULLIF(srq.source_data->>'lat', '')::double precision, 2)
          + power((NULLIF(peer.source_data->>'lng', '')::double precision - NULLIF(srq.source_data->>'lng', '')::double precision)
            * cos(radians(NULLIF(srq.source_data->>'lat', '')::double precision)), 2)
        )) <= 150
    ) THEN 'duplicate_accepted_source_coordinate'
    ELSE 'candidate_ready'
  END
)`;

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    status: 'accepted',
    kind: 'all',
    readiness: '',
    source: null,
    reportFile: null,
    search: '',
    scope: '',
    state: '',
    ids: [],
    output: 'reports/source-reviewed-candidates.csv',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--status') args.status = argv[++i];
    else if (arg === '--kind') args.kind = argv[++i];
    else if (arg === '--readiness') args.readiness = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--search') args.search = String(argv[++i] || '').trim().slice(0, 120);
    else if (arg === '--scope') args.scope = argv[++i];
    else if (arg === '--state') args.state = String(argv[++i] || '').trim().slice(0, 40);
    else if (arg === '--ids') args.ids = parseIds(argv[++i]);
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
  if (!READINESS_OPTIONS.has(args.readiness)) throw new Error('Invalid --readiness');
  if (!SCOPE_OPTIONS.has(args.scope)) throw new Error('Invalid --scope');
  return args;
}

function parseIds(value) {
  const ids = String(value || '')
    .split(',')
    .map(item => Number.parseInt(item.trim(), 10))
    .filter(id => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

function printHelp() {
  console.log(`Usage: node scripts/ops/export-reviewed-source-candidates.mjs [options]

Options:
  --entity <pizza|taco>         Entity type (default pizza)
  --status <status|all>         Review/decision status to export
                                (default accepted)
  --kind <ambiguous|likely_new|all>
                                Review kind filter (default all)
  --readiness <state>            Optional pending-review readiness filter:
                                link_review, candidate_ready,
                                nearby_canonical_review, duplicate_accepted_source_coordinate,
                                missing_required_data
  --source <key>                Optional source filter
  --report-file <file>          Optional report file filter
  --search <text>               Optional text filter matching the admin queue
                                search fields
  --scope <chain|independent>  Optional feed scope filter
  --state <code>               Optional source/canonical state or region filter
  --ids <id,id>                 Optional exact source_review_queue id list
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

function redactSensitiveUrl(value) {
  if (!value || typeof value !== 'string') return value || '';
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/(api[_-]?key|access[_-]?token|token|secret|password|signature|auth)/i.test(key)) {
        url.searchParams.set(key, 'REDACTED');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
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
      ? row.review_readiness || 'pending_review'
      : row.status === 'accepted' && row.review_kind === 'likely_new' && missingSourceCoordinates
        ? 'missing_source_coordinates'
        : 'ready_for_handoff',
    canonical_place_id: row.canonical_place_id,
    source: row.source,
    source_id: row.source_id,
    source_name: row.source_name,
    source_url: redactSensitiveUrl(row.source_url),
    source_lat: sourceLat,
    source_lng: sourceLng,
    source_category: sourceData.category,
    source_address: sourceData.address || sourceData['addr:full'],
    source_locality: sourceData.locality,
    source_region: sourceData.region,
    source_postcode: sourceData.postcode,
    source_country: sourceData.country,
    source_website: redactSensitiveUrl(sourceData.website || sourceData['contact:website']),
    source_phone: sourceData.phone || sourceData['contact:phone'],
    nearest_place_id: row.nearest_place_id,
    nearest_google_place_id: row.nearest_google_place_id,
    nearest_place_name: row.nearest_place_name,
    nearest_state: row.nearest_state,
    decision_state: row.decision_state,
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
  const tableName = args.entity === 'taco' ? 'taco_places' : 'pizza_places';
  const filters = ['srq.entity_type = $1'];
  const values = [args.entity];

  if (args.status === 'all') {
    filters.push(`srq.status <> 'pending'`);
  } else {
    values.push(args.status);
    filters.push(`srq.status = $${values.length}`);
  }
  if (args.kind !== 'all') {
    values.push(args.kind);
    filters.push(`srq.review_kind = $${values.length}`);
  }
  if (args.source) {
    values.push(args.source);
    filters.push(`srq.source = $${values.length}`);
  }
  if (args.readiness && args.readiness !== 'all') {
    values.push(args.readiness);
    filters.push(`${SOURCE_REVIEW_READINESS_SQL} = $${values.length}`);
  }
  if (args.scope === 'chain') filters.push("srq.source = 'all_the_places'");
  if (args.scope === 'independent') filters.push("srq.source IN ('osm', 'fsq_os_places', 'overture_places')");
  if (args.state) {
    values.push(args.state.toLowerCase());
    filters.push(`(
      lower(COALESCE(srq.source_data->>'region', '')) = $${values.length}
      OR lower(COALESCE(srq.source_data->>'state', '')) = $${values.length}
      OR lower(COALESCE(srq.source_data->>'country', '')) = $${values.length}
      OR lower(COALESCE(nearest.state, '')) = $${values.length}
      OR lower(COALESCE(decision_place.state, '')) = $${values.length}
    )`);
  }
  if (args.reportFile) {
    values.push(args.reportFile);
    filters.push(`srq.report_file = $${values.length}`);
  }
  if (args.ids.length) {
    values.push(args.ids);
    filters.push(`srq.id = ANY($${values.length}::bigint[])`);
  }
  if (args.search) {
    values.push(`%${args.search.toLowerCase()}%`);
    filters.push(`(
      lower(COALESCE(srq.source_name, '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_id, '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_url, '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_data->>'address', '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_data->>'addr:full', '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_data->>'website', '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_data->>'phone', '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_data->>'locality', '')) LIKE $${values.length}
      OR lower(COALESCE(srq.source_data->>'region', '')) LIKE $${values.length}
      OR lower(COALESCE(srq.nearest_place_name, '')) LIKE $${values.length}
      OR lower(COALESCE(srq.nearest_google_place_id, '')) LIKE $${values.length}
      OR lower(COALESCE(nearest.address, '')) LIKE $${values.length}
      OR lower(COALESCE(nearest.website_url, '')) LIKE $${values.length}
      OR lower(COALESCE(nearest.phone, '')) LIKE $${values.length}
      OR lower(COALESCE(decision_place.name, '')) LIKE $${values.length}
      OR lower(COALESCE(decision_place.address, '')) LIKE $${values.length}
      OR lower(COALESCE(decision_place.google_place_id, '')) LIKE $${values.length}
      OR lower(COALESCE(srq.review_reason, '')) LIKE $${values.length}
      OR lower(COALESCE(srq.report_file, '')) LIKE $${values.length}
    )`);
  }

  const result = await client.query(`
    SELECT
      srq.id,
      srq.entity_type,
      srq.review_kind,
      srq.source,
      srq.source_id,
      srq.source_name,
      srq.source_url,
      srq.source_data,
      srq.nearest_place_id,
      srq.nearest_google_place_id,
      srq.nearest_place_name,
      nearest.state AS nearest_state,
      decision_place.state AS decision_state,
      srq.nearest_distance_m,
      srq.nearest_name_score,
      srq.review_reason,
      srq.status,
      srq.decision,
      ${SOURCE_REVIEW_READINESS_SQL} AS review_readiness,
      srq.canonical_place_id,
      srq.reviewer_notes,
      srq.reviewed_at,
      srq.reviewed_by,
      srq.report_file
    FROM source_review_queue srq
    LEFT JOIN ${tableName} nearest ON nearest.id = srq.nearest_place_id
    LEFT JOIN ${tableName} decision_place ON decision_place.id = srq.canonical_place_id
    WHERE ${filters.join(' AND ')}
    ORDER BY srq.reviewed_at NULLS LAST, srq.report_file, srq.review_kind, srq.source_name, srq.id
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
    'nearest_state',
    'decision_state',
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
    console.log(`Readiness filter: ${args.readiness || 'all'}`);
    console.log(`Search filter: ${args.search || 'none'}`);
    console.log(`IDs: ${args.ids.length ? args.ids.join(',') : 'all'}`);
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
