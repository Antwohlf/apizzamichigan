#!/usr/bin/env node
/**
 * Move obvious cross-brand ambiguous source rows into likely-new review.
 *
 * Default mode is read-only. With --apply, this only changes pending
 * source_review_queue rows from ambiguous -> likely_new. It never creates
 * canonical places, writes place_sources, promotes fields, or syncs Supabase.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY_TYPES = new Set(['pizza', 'taco']);

const BRAND_CONFLICT_RULES = [
  {
    id: 'dominos',
    source: 'all_the_places',
    reportFile: 'dominos_pizza_us-review.json',
    sourceBrand: "Domino's",
    nearestNamePattern: "Domino|Domoino|Domiono",
  },
  {
    id: 'pizza_hut',
    source: 'all_the_places',
    reportFile: 'pizza_hut_us-review.json',
    sourceBrand: 'Pizza Hut',
    nearestNamePattern: 'Pizza Hut',
  },
  {
    id: 'papa_johns',
    source: 'all_the_places',
    reportFile: 'papa_johns-review.json',
    sourceBrand: "Papa John's",
    nearestNamePattern: "Papa John|Papa Jones",
  },
  {
    id: 'little_caesars',
    source: 'all_the_places',
    reportFile: 'little_caesars_us-review.json',
    sourceBrand: 'Little Caesars',
    nearestNamePattern: "Little C(aesars?|aesers?|easars?|easers?|esars?|esar|aesar)",
  },
  {
    id: 'marcos',
    source: 'all_the_places',
    reportFile: 'marcos-review.json',
    sourceBrand: "Marco's",
    nearestNamePattern: 'Marco',
  },
  {
    id: 'papa_murphys',
    source: 'all_the_places',
    reportFile: 'papa_murphys-review.json',
    sourceBrand: "Papa Murphy's",
    nearestNamePattern: 'Papa Murph',
  },
  {
    id: 'and_pizza',
    source: 'all_the_places',
    reportFile: 'and_pizza-review.json',
    sourceBrand: '&pizza',
    nearestNamePattern: '& ?pizza',
  },
  {
    id: 'foxs_pizza',
    source: 'all_the_places',
    reportFile: 'foxs_pizza-review.json',
    sourceBrand: "Fox's Pizza",
    nearestNamePattern: 'Fox',
  },
  {
    id: 'round_table_pizza',
    source: 'all_the_places',
    reportFile: 'round_table_pizza-review.json',
    sourceBrand: 'Round Table Pizza',
    nearestNamePattern: 'Round Table',
  },
  {
    id: 'mod_pizza',
    source: 'all_the_places',
    reportFile: 'mod_pizza-review.json',
    sourceBrand: 'MOD Pizza',
    nearestNamePattern: 'MOD Pizza',
  },
  {
    id: 'mountain_mikes',
    source: 'all_the_places',
    reportFile: 'mountain_mikes_us-review.json',
    sourceBrand: "Mountain Mike's",
    nearestNamePattern: 'Mountain Mike',
  },
  {
    id: 'vocelli',
    source: 'all_the_places',
    reportFile: 'vocelli_pizza_us-review.json',
    sourceBrand: 'Vocelli Pizza',
    nearestNamePattern: 'Vocelli',
  },
];

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    source: null,
    reportFile: null,
    maxDistanceM: 25,
    maxNameScore: 0.9,
    ids: [],
    limit: 100,
    apply: false,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--max-distance-m') args.maxDistanceM = parseFloat(argv[++i]);
    else if (arg === '--max-name-score') args.maxNameScore = parseFloat(argv[++i]);
    else if (arg === '--ids') args.ids = parseIds(argv[++i]);
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
  if (!Number.isFinite(args.maxDistanceM) || args.maxDistanceM <= 0) throw new Error('Invalid --max-distance-m.');
  if (!Number.isFinite(args.maxNameScore) || args.maxNameScore < 0 || args.maxNameScore > 1) {
    throw new Error('Invalid --max-name-score. Use a number from 0 to 1.');
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0 || args.limit > 1000) {
    throw new Error('Invalid --limit. Use 1-1000.');
  }

  return args;
}

function parseIds(value) {
  const ids = String(value || '')
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(Number.isFinite);
  if (!ids.length) throw new Error('Invalid --ids. Use a comma-separated list of numeric source_review_queue ids.');
  return [...new Set(ids)];
}

function printHelp() {
  console.log(`Usage: node scripts/ops/reclassify-ambiguous-source-candidates.mjs [options]

Options:
  --entity <pizza|taco>      Entity type (default pizza)
  --source <key>             Optional source filter
  --report-file <file>       Optional review report filter
  --max-distance-m <n>       Maximum nearest distance in meters (default 25)
  --max-name-score <n>       Maximum nearest name score, 0-1 (default 0.9)
  --ids <ids>                Exact reviewed source_review_queue ids to reclassify
  --limit <n>                Candidate limit, max 1000 (default 100)
  --apply                    Reclassify the dry-run candidate class
  --json                     Emit JSON instead of Markdown

Default mode is read-only. Apply mode only changes pending ambiguous rows to
pending likely-new rows when a known source report proves one chain and the
nearest canonical place name does not match that chain. It never imports
places, writes place_sources, promotes fields, or syncs Supabase.
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

function brandConflictSql(values) {
  const eligibility = [];
  const sourceBrands = [];

  for (const rule of BRAND_CONFLICT_RULES) {
    const sourceParam = values.push(rule.source);
    const reportParam = values.push(rule.reportFile);
    const nearestPatternParam = values.push(rule.nearestNamePattern);
    const condition = `(
      srq.source = $${sourceParam}
      AND srq.report_file = $${reportParam}
      AND srq.nearest_place_name !~* $${nearestPatternParam}
    )`;
    eligibility.push(condition);
    sourceBrands.push(`WHEN ${condition} THEN '${rule.sourceBrand.replace(/'/g, "''")}'`);
  }

  return { eligibility, sourceBrands };
}

async function fetchCandidates(client, args) {
  const values = [args.entity, args.maxDistanceM, args.maxNameScore];
  const filters = [
    'srq.entity_type = $1',
    "srq.review_kind = 'ambiguous'",
    "srq.status = 'pending'",
    'srq.nearest_place_id IS NOT NULL',
    'ps.id IS NULL',
    'likely_new_duplicate.id IS NULL',
  ];

  let brandConflict = { eligibility: [], sourceBrands: [] };
  if (args.ids.length) {
    values.push(args.ids);
    filters.push(`srq.id = ANY($${values.length}::bigint[])`);
    filters.push('$2::numeric IS NOT NULL');
    filters.push('$3::numeric IS NOT NULL');
  } else {
    filters.push('srq.nearest_distance_m <= $2');
    filters.push('COALESCE(srq.nearest_name_score, 0) < $3');
    brandConflict = brandConflictSql(values);
    filters.push(`(${brandConflict.eligibility.join('\n      OR ')})`);
  }

  if (args.source) {
    values.push(args.source);
    filters.push(`srq.source = $${values.length}`);
  }
  if (args.reportFile) {
    values.push(args.reportFile);
    filters.push(`srq.report_file = $${values.length}`);
  }

  values.push(args.limit);
  const result = await client.query(`
    SELECT
      srq.id,
      srq.entity_type,
      srq.source,
      srq.source_id,
      srq.source_name,
      srq.report_file,
      srq.nearest_place_id,
      srq.nearest_place_name,
      srq.nearest_distance_m,
      srq.nearest_name_score,
      srq.review_reason,
      CASE
        WHEN ${args.ids.length ? 'TRUE' : 'FALSE'}
          THEN 'exact reviewed ids'
        ${brandConflict.sourceBrands.join('\n        ')}
        ELSE 'known source report'
      END AS source_brand
    FROM source_review_queue srq
    LEFT JOIN place_sources ps
      ON ps.entity_type = srq.entity_type
     AND ps.source = srq.source
     AND ps.source_id = srq.source_id
    LEFT JOIN source_review_queue likely_new_duplicate
      ON likely_new_duplicate.entity_type = srq.entity_type
     AND likely_new_duplicate.source = srq.source
     AND likely_new_duplicate.source_id = srq.source_id
     AND likely_new_duplicate.review_kind = 'likely_new'
     AND likely_new_duplicate.id <> srq.id
    WHERE ${filters.join('\n      AND ')}
    ORDER BY
      srq.report_file,
      srq.nearest_distance_m ASC,
      srq.id ASC
    LIMIT $${values.length}
  `, values);
  return result.rows;
}

async function applyCandidates(client, candidates, args) {
  if (!candidates.length) return { reclassified: 0 };

  const ids = candidates.map(row => row.id);
  const reviewerNotes = args.ids.length
    ? `Reclassified from ambiguous to likely-new by exact reviewed source_review_queue ids: ${args.ids.join(',')}.`
    : `Reclassified from ambiguous to likely-new because a known source report proved a different chain than the nearest canonical place within ${args.maxDistanceM}m.`;
  const result = await client.query(`
    UPDATE source_review_queue
    SET
      review_kind = 'likely_new',
      decision = NULL,
      canonical_place_id = NULL,
      reviewer_notes = COALESCE(
        reviewer_notes,
        $2
      ),
      reviewed_at = NULL,
      reviewed_by = 'ops:reclassify-ambiguous-source-candidates',
      updated_at = NOW()
    WHERE id = ANY($1::bigint[])
      AND entity_type = $3
      AND review_kind = 'ambiguous'
      AND status = 'pending'
    RETURNING id
  `, [
    ids,
    reviewerNotes,
    args.entity,
  ]);
  return { reclassified: result.rowCount };
}

function outputReport({ args, candidates, applyResult }) {
  const payload = {
    generated_at: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    entity: args.entity,
    source: args.source,
    report_file: args.reportFile,
    max_distance_m: args.maxDistanceM,
    max_name_score: args.maxNameScore,
    ids: args.ids,
    limit: args.limit,
    candidates: candidates.length,
    reclassified: applyResult.reclassified,
    rows: candidates,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# Reclassify Ambiguous Source Candidates ${args.apply ? 'Apply' : 'Dry Run'}`);
  console.log('');
  console.log(`Mode: ${payload.mode}`);
  console.log(`Entity: ${args.entity}`);
  console.log(`Source: ${args.source || 'all'}`);
  console.log(`Report file: ${args.reportFile || 'all known brand-conflict reports'}`);
  console.log(`Thresholds: nearest_name_score < ${args.maxNameScore}, distance <= ${args.maxDistanceM}m`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Rows reclassified: ${applyResult.reclassified}`);
  console.log('');
  console.log(table([
    'id',
    'source_brand',
    'source_name',
    'nearest_place_id',
    'nearest_place_name',
    'nearest_distance_m',
    'nearest_name_score',
    'report_file',
  ], candidates.slice(0, 50)));
  if (!args.apply && candidates.length) {
    console.log('');
    console.log('Re-run with `--apply` to move exactly this candidate class into pending likely-new review.');
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
    if (!(await tableExists(client, 'place_sources'))) {
      throw new Error('place_sources table does not exist.');
    }

    const candidates = await fetchCandidates(client, args);
    const applyResult = args.apply
      ? await applyCandidates(client, candidates, args)
      : { reclassified: 0 };
    outputReport({ args, candidates, applyResult });
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`reclassify-ambiguous-source-candidates failed: ${error.message || error}`);
  process.exit(1);
});
