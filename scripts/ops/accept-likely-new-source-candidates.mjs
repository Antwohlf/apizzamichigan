#!/usr/bin/env node
/**
 * Mark pending likely-new source review rows as accepted import candidates.
 *
 * Default mode is read-only. With --apply, this only updates
 * source_review_queue rows from pending -> accepted. It never creates canonical
 * places, writes place_sources, promotes fields, or syncs Supabase.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY_TYPES = new Set(['pizza', 'taco']);

const SIGNAL_COUNT_SQL = `(
  CASE WHEN NULLIF(source_data->>'address', '') IS NOT NULL OR NULLIF(source_data->>'addr:full', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN NULLIF(source_data->>'website', '') IS NOT NULL OR NULLIF(source_data->>'contact:website', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN NULLIF(source_data->>'phone', '') IS NOT NULL OR NULLIF(source_data->>'contact:phone', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN (
    (NULLIF(source_data->>'lat', '') IS NOT NULL OR NULLIF(source_data->>'latitude', '') IS NOT NULL) AND
    (NULLIF(source_data->>'lng', '') IS NOT NULL OR NULLIF(source_data->>'lon', '') IS NOT NULL OR NULLIF(source_data->>'longitude', '') IS NOT NULL)
  ) THEN 1 ELSE 0 END
)`;

const READINESS_SQL = `(
  CASE
    WHEN review_kind <> 'likely_new' THEN 'link_review'
    WHEN COALESCE(NULLIF(source_name, ''), NULLIF(source_data->>'name', '')) IS NULL
      OR NULLIF(source_id, '') IS NULL
      OR NOT (
        (NULLIF(source_data->>'lat', '') IS NOT NULL OR NULLIF(source_data->>'latitude', '') IS NOT NULL) AND
        (NULLIF(source_data->>'lng', '') IS NOT NULL OR NULLIF(source_data->>'lon', '') IS NOT NULL OR NULLIF(source_data->>'longitude', '') IS NOT NULL)
      )
      THEN 'missing_required_data'
    WHEN nearest_distance_m IS NOT NULL AND nearest_distance_m <= 150
      THEN 'nearby_canonical_review'
    ELSE 'candidate_ready'
  END
)`;

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    source: null,
    reportFile: null,
    state: null,
    minSignals: 3,
    limit: 100,
    apply: false,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--state') args.state = argv[++i];
    else if (arg === '--min-signals') args.minSignals = parseInt(argv[++i], 10);
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ENTITY_TYPES.has(args.entity)) throw new Error('Invalid --entity. Use pizza or taco.');
  if (!Number.isFinite(args.minSignals) || args.minSignals < 0 || args.minSignals > 4) throw new Error('Invalid --min-signals. Use 0-4.');
  if (!Number.isFinite(args.limit) || args.limit <= 0 || args.limit > 1000) throw new Error('Invalid --limit. Use 1-1000.');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/accept-likely-new-source-candidates.mjs [options]

Options:
  --entity <pizza|taco>      Entity type (default pizza)
  --source <key>             Optional source filter
  --report-file <file>       Optional review report filter
  --state <code>             Optional source state/region/country filter
  --min-signals <n>          Minimum evidence signals 0-4 (default 3)
  --limit <n>                Candidate limit, max 1000 (default 100)
  --apply                    Mark candidates accepted
  --json                     Emit JSON instead of Markdown

Default mode is read-only. Apply mode only changes pending likely-new rows to
accepted so they can be preflighted later by
preflight-reviewed-new-place-import.mjs. It never imports places or writes
Supabase.
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

async function tableExists(client, tableName) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
  `, [tableName]);
  return Boolean(result.rows[0]?.exists);
}

async function fetchCandidates(client, args) {
  const values = [args.entity, args.minSignals];
  const filters = [
    'entity_type = $1',
    "review_kind = 'likely_new'",
    "status = 'pending'",
    `${READINESS_SQL} = 'candidate_ready'`,
    `${SIGNAL_COUNT_SQL} >= $2`,
  ];

  if (args.source) {
    values.push(args.source);
    filters.push(`source = $${values.length}`);
  }
  if (args.reportFile) {
    values.push(args.reportFile);
    filters.push(`report_file = $${values.length}`);
  }
  if (args.state) {
    values.push(String(args.state).trim().toUpperCase());
    filters.push(`UPPER(COALESCE(source_data->>'region', source_data->>'state', source_data->>'country', '')) = $${values.length}`);
  }

  values.push(args.limit);
  const result = await client.query(`
    SELECT
      id,
      source,
      source_id,
      source_name,
      source_data->>'address' AS source_address,
      source_data->>'website' AS source_website,
      source_data->>'phone' AS source_phone,
      report_file,
      nearest_distance_m,
      ${SIGNAL_COUNT_SQL}::int AS source_signal_count,
      ${READINESS_SQL} AS review_readiness
    FROM source_review_queue
    WHERE ${filters.join('\n      AND ')}
    ORDER BY
      ${SIGNAL_COUNT_SQL} DESC,
      nearest_distance_m DESC NULLS LAST,
      source_name NULLS LAST,
      id
    LIMIT $${values.length}
  `, values);
  return result.rows;
}

async function applyCandidates(client, candidates, args) {
  if (!candidates.length) return { accepted: 0 };

  const ids = candidates.map(row => row.id);
  const result = await client.query(`
    UPDATE source_review_queue
    SET
      status = 'accepted',
      decision = 'accepted',
      reviewer_notes = COALESCE(reviewer_notes, $2),
      reviewed_at = NOW(),
      reviewed_by = 'ops:accept-likely-new-source-candidates',
      updated_at = NOW()
    WHERE id = ANY($1::bigint[])
      AND entity_type = $3
      AND review_kind = 'likely_new'
      AND status = 'pending'
    RETURNING id
  `, [
    ids,
    `Accepted as likely-new import candidate via dry-run-gated ops tool with min_signals=${args.minSignals}.`,
    args.entity,
  ]);

  return { accepted: result.rowCount };
}

async function pendingStatusCounts(client, args) {
  const values = [args.entity];
  const filters = ['entity_type = $1', "review_kind = 'likely_new'"];
  if (args.source) {
    values.push(args.source);
    filters.push(`source = $${values.length}`);
  }
  if (args.reportFile) {
    values.push(args.reportFile);
    filters.push(`report_file = $${values.length}`);
  }
  if (args.state) {
    values.push(String(args.state).trim().toUpperCase());
    filters.push(`UPPER(COALESCE(source_data->>'region', source_data->>'state', source_data->>'country', '')) = $${values.length}`);
  }
  const result = await client.query(`
    SELECT status, COUNT(*)::int AS count
    FROM source_review_queue
    WHERE ${filters.join(' AND ')}
    GROUP BY status
    ORDER BY status
  `, values);
  return result.rows;
}

function outputReport({ args, candidates, applyResult, statusCounts }) {
  const payload = {
    generated_at: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    entity: args.entity,
    source: args.source || 'all',
    report_file: args.reportFile || 'all',
    state: args.state || 'all',
    min_signals: args.minSignals,
    limit: args.limit,
    candidates: candidates.length,
    accepted: applyResult.accepted,
    status_counts: statusCounts,
    rows: candidates,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# Accept Likely-New Source Candidates ${args.apply ? 'Apply' : 'Dry Run'}`);
  console.log('');
  console.log(`Mode: ${payload.mode}`);
  console.log(`Entity: ${payload.entity}`);
  console.log(`Source: ${payload.source}`);
  console.log(`Report file: ${payload.report_file}`);
  console.log(`State: ${payload.state}`);
  console.log(`Minimum source signals: ${payload.min_signals}/4`);
  console.log(`Candidates: ${payload.candidates}`);
  console.log(`Rows accepted: ${payload.accepted}`);
  console.log('');
  console.log('## Likely-New Status Counts');
  console.log(table(['status', 'count'], statusCounts));
  console.log('');
  console.log('## Candidate Sample');
  console.log(table(
    ['id', 'report_file', 'source_name', 'source_signal_count', 'nearest_distance_m', 'source_address', 'source_website', 'source_phone'],
    candidates.slice(0, 50)
  ));
  if (!args.apply && candidates.length) {
    console.log('');
    console.log('Re-run with `--apply` to mark this bounded candidate class as accepted for later import preflight.');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const client = new pg.Client(dbConfig());
  await client.connect();

  try {
    if (!(await tableExists(client, 'source_review_queue'))) {
      throw new Error('source_review_queue table does not exist.');
    }
    const beforeCounts = await pendingStatusCounts(client, args);
    const candidates = await fetchCandidates(client, args);
    const applyResult = args.apply ? await applyCandidates(client, candidates, args) : { accepted: 0 };
    const statusCounts = args.apply ? await pendingStatusCounts(client, args) : beforeCounts;
    outputReport({ args, candidates, applyResult, statusCounts });
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`accept-likely-new-source-candidates failed: ${error.message || error}`);
  process.exit(1);
});
