#!/usr/bin/env node
/**
 * Orchestrate a bounded reviewed-new source batch using the existing guarded
 * tools. Default mode is dry-run and writes nothing.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import pg from 'pg';
import Database from 'better-sqlite3';

const NODE = process.execPath;

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    source: 'all_the_places',
    reportFile: null,
    state: null,
    minSignals: 4,
    acceptLimit: 10,
    importLimit: 5,
    nearbyRadiusM: 150,
    priorityBoost: 100000,
    classifierTimeoutMs: 10 * 60 * 1000,
    apply: false,
    runScrape: false,
    waitClassify: false,
    publish: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--state') args.state = argv[++i];
    else if (arg === '--min-signals') args.minSignals = parseInt(argv[++i], 10);
    else if (arg === '--accept-limit') args.acceptLimit = parseInt(argv[++i], 10);
    else if (arg === '--import-limit') args.importLimit = parseInt(argv[++i], 10);
    else if (arg === '--nearby-radius-m') args.nearbyRadiusM = parseFloat(argv[++i]);
    else if (arg === '--priority-boost') args.priorityBoost = parseInt(argv[++i], 10);
    else if (arg === '--classifier-timeout-ms') args.classifierTimeoutMs = parseInt(argv[++i], 10);
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--run-scrape') args.runScrape = true;
    else if (arg === '--wait-classify') args.waitClassify = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['pizza', 'taco'].includes(args.entity)) throw new Error('Invalid --entity. Use pizza or taco.');
  if (!args.reportFile) throw new Error('--report-file is required.');
  if (!Number.isFinite(args.minSignals) || args.minSignals < 0 || args.minSignals > 4) throw new Error('Invalid --min-signals.');
  if (!Number.isFinite(args.acceptLimit) || args.acceptLimit <= 0 || args.acceptLimit > 1000) throw new Error('Invalid --accept-limit.');
  if (!Number.isFinite(args.importLimit) || args.importLimit <= 0 || args.importLimit > args.acceptLimit) throw new Error('Invalid --import-limit.');
  if (!Number.isFinite(args.nearbyRadiusM) || args.nearbyRadiusM <= 0) throw new Error('Invalid --nearby-radius-m.');
  if (!Number.isFinite(args.priorityBoost) || args.priorityBoost < 0) throw new Error('Invalid --priority-boost.');
  if (!Number.isFinite(args.classifierTimeoutMs) || args.classifierTimeoutMs <= 0) throw new Error('Invalid --classifier-timeout-ms.');
  if (args.publish && (!args.apply || !args.runScrape || !args.waitClassify)) {
    throw new Error('--publish requires --apply --run-scrape --wait-classify.');
  }
  if (args.runScrape && !args.apply) throw new Error('--run-scrape requires --apply.');
  if (args.waitClassify && !args.runScrape) throw new Error('--wait-classify requires --run-scrape.');

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/process-reviewed-new-batch.mjs [options]

Options:
  --entity <pizza|taco>          Entity type (default pizza)
  --source <key>                 Source key (default all_the_places)
  --report-file <file>           Required source review report file
  --state <code>                 Optional source state/region/country filter
  --min-signals <n>              Minimum evidence signals 0-4 (default 4)
  --accept-limit <n>             Likely-new rows to accept/preflight (default 10)
  --import-limit <n>             Candidate-ready rows to import (default 5)
  --nearby-radius-m <n>          Duplicate radius (default 150)
  --priority-boost <n>           Queue priority boost (default 100000)
  --classifier-timeout-ms <n>    Wait timeout for classify handoff (default 600000)
  --apply                        Accept/import local reviewed-new rows
  --run-scrape                   Enqueue and run a bounded foreground scrape
  --wait-classify                Wait for launchd classifier to complete handoff
  --publish                      Guarded exact-ID Supabase insert after classify

Default mode is dry-run. Publish is exact-ID only and uses
guarded-supabase-sync.mjs --insert-missing-reviewed-new.
`);
}

function runNode(args, { json = false, timeout = 120000 } = {}) {
  const stdout = execFileSync(NODE, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
  return json ? JSON.parse(stdout) : stdout;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
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

function baseAcceptArgs(args) {
  const out = [
    'scripts/ops/accept-likely-new-source-candidates.mjs',
    '--entity', args.entity,
    '--source', args.source,
    '--report-file', args.reportFile,
    '--min-signals', String(args.minSignals),
    '--limit', String(args.acceptLimit),
    '--json',
  ];
  if (args.state) out.push('--state', args.state);
  return out;
}

function preflightArgs(args, ids, { apply = false } = {}) {
  const out = [
    'scripts/ops/preflight-reviewed-new-place-import.mjs',
    '--entity', args.entity,
    '--ids', ids.join(','),
    '--nearby-radius-m', String(args.nearbyRadiusM),
    '--ready-limit', String(args.importLimit),
    '--json',
  ];
  if (apply) out.push('--apply');
  return out;
}

async function fetchPlaces(placeIds) {
  if (!placeIds.length) return [];
  const table = 'pizza_places';
  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, google_place_id, name, state, website_url, style, price_range, style_confidence, last_enriched_at
       FROM ${table}
       WHERE id = ANY($1::int[])
       ORDER BY id`,
      [placeIds],
    );
    return rows;
  } finally {
    await client.end();
  }
}

function queueDb() {
  const dbPath = process.env.QUEUE_DB_PATH || join(process.cwd(), 'scripts/.job-queue.db');
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function classifyStatuses(osmIds) {
  if (!osmIds.length) return [];
  const db = queueDb();
  try {
    return db.prepare(`
      SELECT id, osm_id, status, worker_id, attempts, started_at, completed_at, last_error
      FROM jobs
      WHERE job_type='classify'
        AND osm_id IN (${osmIds.map(() => '?').join(',')})
      ORDER BY osm_id, id
    `).all(...osmIds);
  } finally {
    db.close();
  }
}

async function waitForClassify(placeIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const places = await fetchPlaces(placeIds);
    const osmIds = places.map(row => row.google_place_id).filter(Boolean);
    const statuses = classifyStatuses(osmIds);
    const completed = new Set(statuses.filter(row => row.status === 'completed').map(row => row.osm_id));
    if (osmIds.length && osmIds.every(id => completed.has(id))) return { places, statuses };
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const places = await fetchPlaces(placeIds);
  const statuses = classifyStatuses(places.map(row => row.google_place_id).filter(Boolean));
  throw new Error(`Timed out waiting for classify jobs: ${JSON.stringify(statuses)}`);
}

function printStep(title) {
  console.log('');
  console.log(`## ${title}`);
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('# Process Reviewed-New Batch');
  console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
  console.log(`Report: ${args.reportFile}`);
  console.log(`Accept limit: ${args.acceptLimit}; import limit: ${args.importLimit}; min signals: ${args.minSignals}`);

  printStep('Accept Preview');
  const acceptPreview = runNode(baseAcceptArgs(args), { json: true });
  const reviewIds = acceptPreview.rows.map(row => row.id);
  console.log(`candidate_review_ids=${reviewIds.join(',') || 'none'}`);
  console.log(`candidates=${acceptPreview.candidates}, would_accept=${reviewIds.length}`);
  if (!reviewIds.length) return;

  if (!args.apply) {
    console.log('');
    console.log('Dry-run complete. Import preflight runs after --apply marks these exact rows accepted.');
    return;
  }

  printStep('Accept Apply');
  const acceptApply = runNode([...baseAcceptArgs(args), '--apply'], { json: true });
  console.log(`accepted=${acceptApply.accepted}`);

  printStep('Import Preflight');
  const preflightPreview = runNode(preflightArgs(args, reviewIds), { json: true });
  console.log(`readiness=${JSON.stringify(preflightPreview.readinessCounts || {})}`);
  const readyCount = preflightPreview.readinessCounts?.candidate_ready || 0;
  console.log(`candidate_ready=${readyCount}`);

  printStep('Import Apply');
  const importApply = runNode(preflightArgs(args, reviewIds, { apply: true }), { json: true });
  const imported = importApply.applyResult?.imported || [];
  const placeIds = imported.map(row => row.place_id);
  console.log(`imported_place_ids=${placeIds.join(',') || 'none'}`);
  if (!placeIds.length) return;

  printStep('Verify Import');
  console.log(runNode([
    'scripts/ops/verify-reviewed-new-imports.mjs',
    '--entity', args.entity,
    '--ids', placeIds.join(','),
  ]));

  const minPlaceId = Math.min(...placeIds);
  const maxPlaceId = Math.max(...placeIds);
  printStep('Enqueue Scrape');
  console.log(runNode([
    'scripts/enrichment/populate-scrape-from-db.mjs',
    '--type', args.entity,
    '--id-prefix', `${args.source}:`,
    '--min-place-id', String(minPlaceId),
    '--max-place-id', String(maxPlaceId),
    '--priority-boost', String(args.priorityBoost),
    '--limit', String(placeIds.length),
  ]));

  if (args.runScrape) {
    printStep('Run Scrape');
    console.log(runNode([
      'scripts/enrichment/agents/web-scraper.mjs',
      '--worker-id', `scraper-reviewed-new-${Date.now()}`,
      '--max-jobs', String(placeIds.length),
    ], { timeout: Math.max(120000, placeIds.length * 60000) }));
  }

  if (args.waitClassify) {
    printStep('Wait Classify');
    const { places } = await waitForClassify(placeIds, args.classifierTimeoutMs);
    for (const place of places) {
      console.log(`${place.id} ${place.name} ${place.style || ''} ${place.price_range || ''} ${place.style_confidence || ''}`);
    }
  }

  if (args.publish) {
    printStep('Guarded Publish');
    console.log(runNode([
      'scripts/ops/guarded-supabase-sync.mjs',
      '--ids', placeIds.join(','),
      '--batch', String(placeIds.length),
      '--max-batches', '1',
      '--insert-missing-reviewed-new',
      '--apply',
    ], { timeout: 240000 }));
  }
}

main().catch(error => {
  console.error(`process-reviewed-new-batch failed: ${error.message || error}`);
  process.exit(1);
});
