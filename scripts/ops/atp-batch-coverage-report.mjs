#!/usr/bin/env node
/**
 * Read-only coverage report for APizza All the Places spider batches.
 *
 * Joins the curated ATP manifest, local place_sources rows, review artifacts,
 * and durable source_review_queue counts so operators can tell whether a spider
 * was skipped, accepted into provenance, or routed entirely to review.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const DEFAULT_MANIFEST_PATH = 'config/atp-pizza-spiders.json';
const DEFAULT_REVIEW_DIR = 'reports/source-review';

function parseArgs(argv) {
  const args = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    reviewDir: DEFAULT_REVIEW_DIR,
    entity: 'pizza',
    source: 'all_the_places',
    dbStateFixture: '',
    maxSpiders: 5,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifestPath = argv[++i];
    else if (arg === '--review-dir') args.reviewDir = argv[++i];
    else if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--db-state-fixture') args.dbStateFixture = argv[++i];
    else if (arg === '--max-spiders') args.maxSpiders = parseInt(argv[++i], 10);
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/atp-batch-coverage-report.mjs [options]

Options:
  --manifest <file>    ATP spider manifest (default config/atp-pizza-spiders.json)
  --review-dir <dir>   Review artifact directory (default reports/source-review)
  --entity <name>      Entity type in place_sources/source_review_queue (default pizza)
  --source <name>      Source key (default all_the_places)
  --db-state-fixture <file>
                       Use a JSON fixture with sourceRows/reviewRows instead of Postgres
  --max-spiders <n>    Max spiders in the suggested next batch (default 5)
  --json               Emit JSON instead of Markdown

Read-only. Does not download ATP files, mutate Postgres, or sync Supabase.
`);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
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

function loadManifest(path) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
}

function loadReviewArtifact(reviewDir, spider) {
  const path = resolve(process.cwd(), join(reviewDir, `${spider}-review.json`));
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return {
    path,
    mode: data.mode || '',
    counts: data.counts || {},
    generated_at: data.generated_at || '',
  };
}

async function queryOptional(client, sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch (error) {
    if (error?.code === '42P01') return { rows: [] };
    throw error;
  }
}

async function loadDbState(args) {
  if (args.dbStateFixture) {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), args.dbStateFixture), 'utf8'));
    return {
      sourceRows: fixture.sourceRows || [],
      reviewRows: fixture.reviewRows || [],
    };
  }

  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    const sourceRows = await queryOptional(client, `
      SELECT
        COALESCE(data->>'spider', '(missing)') AS spider,
        COUNT(*)::int AS source_rows,
        COUNT(DISTINCT place_id)::int AS linked_places
      FROM place_sources
      WHERE entity_type = $1
        AND source = $2
      GROUP BY COALESCE(data->>'spider', '(missing)')
    `, [args.entity, args.source]);

    const reviewRows = await queryOptional(client, `
      SELECT
        REPLACE(report_file, '-review.json', '') AS spider,
        review_kind,
        status,
        COUNT(*)::int AS rows
      FROM source_review_queue
      WHERE entity_type = $1
        AND source = $2
        AND report_file IS NOT NULL
      GROUP BY REPLACE(report_file, '-review.json', ''), review_kind, status
    `, [args.entity, args.source]);

    return {
      sourceRows: sourceRows.rows,
      reviewRows: reviewRows.rows,
    };
  } finally {
    await client.end();
  }
}

function indexDbState(dbState) {
  const sourceBySpider = new Map(dbState.sourceRows.map(row => [row.spider, row]));
  const reviewBySpider = new Map();
  for (const row of dbState.reviewRows) {
    if (!reviewBySpider.has(row.spider)) reviewBySpider.set(row.spider, {});
    const key = `${row.review_kind}_${row.status}`;
    reviewBySpider.get(row.spider)[key] = row.rows;
  }
  return { sourceBySpider, reviewBySpider };
}

function rowStatus({ manifestRow, sourceRows, review, artifact }) {
  if (!manifestRow.import_enabled) return 'disabled';
  if ((sourceRows?.source_rows || 0) > 0) return 'accepted_evidence';
  const pendingReview = (review?.ambiguous_pending || 0) + (review?.likely_new_pending || 0);
  if (pendingReview > 0) return 'review_only';
  if (artifact) return 'ran_no_accepts';
  return 'not_run';
}

function nextAction({ manifestRow, status, review, sourceRows, artifact }) {
  const ambiguousPending = review?.ambiguous_pending || 0;
  const likelyNewPending = review?.likely_new_pending || 0;
  const sourceCount = sourceRows?.source_rows || 0;

  if (!manifestRow.import_enabled) {
    return manifestRow.status === 'false_positive_non_pizza'
      ? 'keep_disabled_false_positive'
      : 'find_or_build_source_adapter';
  }
  if (ambiguousPending > 0) return 'review_ambiguous_links';
  if (likelyNewPending > 0) return 'review_likely_new_candidates';
  if (sourceCount > 0) return 'monitor_evidence';
  if (status === 'ran_no_accepts') return 'inspect_zero_match_artifact';
  if (artifact) return 'inspect_artifact';
  return 'run_source_batch';
}

function reviewPriority({ manifestRow, status, review }) {
  if (!manifestRow.import_enabled) return 0;
  const ambiguousPending = review?.ambiguous_pending || 0;
  const likelyNewPending = review?.likely_new_pending || 0;
  if (ambiguousPending > 0) return 1000000 + ambiguousPending;
  if (likelyNewPending > 0) return likelyNewPending;
  if (status === 'not_run') return 500;
  if (status === 'ran_no_accepts') return 100;
  return 0;
}

function shellQuote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function reviewReportFile(row) {
  return `${row.spider}-review.json`;
}

function reviewExportPath(row) {
  const kind = row.next_action === 'review_ambiguous_links' ? 'ambiguous' : 'likely_new';
  const readiness = row.next_action === 'review_ambiguous_links' ? 'link_review' : 'candidate_ready';
  return `reports/source-review-${row.spider}-${kind}-${readiness}-pending.csv`;
}

function reviewExportCommand(row, { entity, source }) {
  const kind = row.next_action === 'review_ambiguous_links' ? 'ambiguous' : 'likely_new';
  const readiness = row.next_action === 'review_ambiguous_links' ? 'link_review' : 'candidate_ready';
  return [
    'node',
    'scripts/ops/export-reviewed-source-candidates.mjs',
    '--entity',
    entity,
    '--status',
    'pending',
    '--kind',
    kind,
    '--readiness',
    readiness,
    '--source',
    source,
    '--report-file',
    reviewReportFile(row),
    '--output',
    reviewExportPath(row),
  ].map(shellQuote).join(' ');
}

function reviewDryRunCommand(row, { entity, source }) {
  const reportFile = reviewReportFile(row);
  if (row.next_action === 'review_ambiguous_links') {
    return [
      'node',
      'scripts/ops/auto-link-source-review-queue.mjs',
      '--entity',
      entity,
      '--source',
      source,
      '--report-file',
      reportFile,
      '--limit',
      '25',
    ].map(shellQuote).join(' ');
  }

  if (row.next_action === 'review_likely_new_candidates') {
    return [
      'node',
      'scripts/ops/accept-likely-new-source-candidates.mjs',
      '--entity',
      entity,
      '--source',
      source,
      '--report-file',
      reportFile,
      '--min-signals',
      '3',
      '--limit',
      '25',
    ].map(shellQuote).join(' ');
  }

  return '';
}

function withReviewCommands(row, args) {
  return {
    ...row,
    report_file: reviewReportFile(row),
    review_export_command: reviewExportCommand(row, args),
    review_dry_run_command: reviewDryRunCommand(row, args),
  };
}

function buildRows({ manifest, reviewDir, dbState }) {
  const { sourceBySpider, reviewBySpider } = indexDbState(dbState);
  return (manifest.spiders || []).map((manifestRow, manifestIndex) => {
    const spider = manifestRow.spider;
    const sourceRows = sourceBySpider.get(spider) || {};
    const review = reviewBySpider.get(spider) || {};
    const artifact = loadReviewArtifact(reviewDir, spider);
    const counts = artifact?.counts || {};
    const status = rowStatus({ manifestRow, sourceRows, review, artifact });
    return {
      spider,
      manifest_index: manifestIndex,
      group: manifestRow.group || '',
      manifest_status: manifestRow.status || '',
      import_enabled: Boolean(manifestRow.import_enabled),
      status,
      place_sources_rows: sourceRows.source_rows || 0,
      linked_places: sourceRows.linked_places || 0,
      artifact_mode: artifact?.mode || '',
      artifact_input_rows: counts.inputRowsInspected || 0,
      artifact_matched: counts.matchedExistingPlaces || 0,
      artifact_ambiguous: counts.ambiguousReviewCandidates || 0,
      artifact_likely_new: counts.likelyNewUnmatchedCandidates || 0,
      queue_ambiguous_pending: review.ambiguous_pending || 0,
      queue_likely_new_pending: review.likely_new_pending || 0,
      review_priority: reviewPriority({ manifestRow, status, review }),
      next_action: nextAction({ manifestRow, status, review, sourceRows, artifact }),
      note: manifestRow.note || manifestRow.brand || '',
    };
  });
}

function buildNextBatchPlan(rows, maxSpiders, args) {
  const reviewWork = rows
    .filter(row => ['review_ambiguous_links', 'review_likely_new_candidates'].includes(row.next_action))
    .slice()
    .sort((a, b) => b.review_priority - a.review_priority || a.spider.localeCompare(b.spider));

  const candidates = rows
    .filter(row => row.import_enabled)
    .filter(row => row.next_action === 'run_source_batch')
    .slice()
    .sort((a, b) => {
      const groupRank = groupPriority(a.group) - groupPriority(b.group);
      if (groupRank !== 0) return groupRank;
      return a.manifest_index - b.manifest_index;
    });

  const selected = candidates.slice(0, maxSpiders);
  const spiders = selected.map(row => row.spider);

  return {
    max_spiders: maxSpiders,
    blocked_by_review: reviewWork.length > 0,
    review_work_rows: reviewWork.length,
    review_work_preview: reviewWork.slice(0, 8).map(row => withReviewCommands({
      spider: row.spider,
      next_action: row.next_action,
      review_priority: row.review_priority,
      queue_ambiguous_pending: row.queue_ambiguous_pending,
      queue_likely_new_pending: row.queue_likely_new_pending,
    }, args)),
    candidate_spiders: candidates.length,
    selected_spiders: spiders,
    preflight_command: spiders.length
      ? `node scripts/ops/import-atp-spiders.mjs --spiders ${spiders.join(',')} --preflight-only`
      : '',
    dry_run_command: spiders.length
      ? `node scripts/ops/import-atp-spiders.mjs --spiders ${spiders.join(',')} --import-review-queue`
      : '',
  };
}

function groupPriority(group) {
  if (group === 'original_chain') return 0;
  if (group === 'regional_chain') return 1;
  return 2;
}

function table(headers, rows) {
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`),
  ].join('\n');
}

function printMarkdown(payload) {
  console.log('# ATP Batch Coverage Report');
  console.log('');
  console.log(`Generated: ${payload.generated_at}`);
  console.log(`Entity: ${payload.entity}`);
  console.log(`Source: ${payload.source}`);
  console.log(`Manifest: ${payload.manifest_path}`);
  console.log('');
  console.log('## Summary');
  console.log(table(['status', 'rows'], Object.entries(payload.summary).map(([status, rows]) => ({ status, rows }))));
  console.log('');
  console.log('## Spiders');
  console.log(table([
    'spider',
    'group',
    'manifest_status',
    'import_enabled',
    'status',
    'next_action',
    'review_priority',
    'place_sources_rows',
    'linked_places',
    'artifact_input_rows',
    'artifact_matched',
    'artifact_ambiguous',
    'artifact_likely_new',
    'queue_ambiguous_pending',
    'queue_likely_new_pending',
    'note',
  ], payload.rows));
  console.log('');
  console.log('## Next Review Work');
  console.log(table([
    'spider',
    'group',
    'next_action',
    'review_priority',
    'queue_ambiguous_pending',
    'queue_likely_new_pending',
    'review_export_command',
    'review_dry_run_command',
  ], payload.next_review_work));
  console.log('');
  console.log('## Suggested Next ATP Batch');
  if (!payload.next_batch.selected_spiders.length) {
    console.log('_No import-enabled not-run spiders are currently available for a new batch._');
  } else {
    console.log(table([
      'blocked_by_review',
      'review_work_rows',
      'candidate_spiders',
      'selected_spiders',
    ], [{
      blocked_by_review: payload.next_batch.blocked_by_review ? 'yes' : 'no',
      review_work_rows: payload.next_batch.review_work_rows,
      candidate_spiders: payload.next_batch.candidate_spiders,
      selected_spiders: payload.next_batch.selected_spiders.join(','),
    }]));
    console.log('');
    if (payload.next_batch.blocked_by_review) {
      console.log('Review work is pending. Prefer resolving the top review rows before adding more source rows.');
      console.log('');
    }
    console.log('Preflight:');
    console.log('');
    console.log(`\`${payload.next_batch.preflight_command}\``);
    console.log('');
    console.log('Dry run with review queue handoff:');
    console.log('');
    console.log(`\`${payload.next_batch.dry_run_command}\``);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!Number.isFinite(args.maxSpiders) || args.maxSpiders <= 0) {
    throw new Error('--max-spiders must be a positive number');
  }
  const manifest = loadManifest(args.manifestPath);
  const dbState = await loadDbState(args);
  const rows = buildRows({ manifest, reviewDir: args.reviewDir, dbState });
  const summary = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const nextReviewWork = rows
    .filter(row => ['review_ambiguous_links', 'review_likely_new_candidates'].includes(row.next_action))
    .slice()
    .sort((a, b) => b.review_priority - a.review_priority || a.spider.localeCompare(b.spider))
    .slice(0, 12)
    .map(row => withReviewCommands(row, { entity: args.entity, source: args.source }));
  const payload = {
    generated_at: new Date().toISOString(),
    entity: args.entity,
    source: args.source,
    manifest_path: args.manifestPath,
    review_dir: args.reviewDir,
    summary,
    next_review_work: nextReviewWork,
    next_batch: buildNextBatchPlan(rows, args.maxSpiders, { entity: args.entity, source: args.source }),
    rows,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printMarkdown(payload);
}

main().catch(error => {
  console.error(`atp-batch-coverage-report failed: ${error.message || error}`);
  process.exit(1);
});
