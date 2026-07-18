#!/usr/bin/env node
/**
 * Export a small FSQ OS Places sample through the Hugging Face Dataset Viewer.
 *
 * This is intentionally small-slice tooling. It requires gated dataset access
 * and writes JSON rows that source-input-sample-report.mjs can consume.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const DEFAULT_DATASET = 'foursquare/fsq-os-places';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.FSQ_REQUEST_TIMEOUT_MS || '', 10) || 30000;
const DATASET_LOADING_RETRIES = Number.parseInt(process.env.FSQ_LOADING_RETRIES || '', 10) || 3;

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

function mergedEnv() {
  return {
    ...loadEnvFile(resolve(process.cwd(), '.env')),
    ...loadEnvFile(resolve(process.cwd(), '.env.local')),
    ...process.env,
  };
}

function parseArgs(argv) {
  const env = mergedEnv();
  const args = {
    dataset: DEFAULT_DATASET,
    config: 'places',
    split: 'train',
    query: 'pizza',
    offset: 0,
    length: 100,
    pages: 1,
    output: 'data/source-samples/fsq-os-places-pizza-sample.json',
    entity: 'pizza',
    reviewOutput: 'reports/source-review/fsq-os-places-review.json',
    runReport: false,
    token: env.HF_TOKEN || env.HUGGINGFACE_HUB_TOKEN || '',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dataset') args.dataset = argv[++i];
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--split') args.split = argv[++i];
    else if (arg === '--query') args.query = argv[++i];
    else if (arg === '--offset') args.offset = parseInt(argv[++i], 10);
    else if (arg === '--length') args.length = parseInt(argv[++i], 10);
    else if (arg === '--pages') args.pages = parseInt(argv[++i], 10);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--review-output') args.reviewOutput = argv[++i];
    else if (arg === '--run-report') args.runReport = true;
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.dataset) throw new Error('Missing --dataset');
  if (!args.config) throw new Error('Missing --config');
  if (!args.split) throw new Error('Missing --split');
  if (!args.output) throw new Error('Missing --output');
  if (!Number.isFinite(args.offset) || args.offset < 0) throw new Error('Invalid --offset');
  if (!Number.isFinite(args.length) || args.length < 1 || args.length > 100) {
    throw new Error('Invalid --length. Hugging Face Dataset Viewer allows 1-100 rows per request.');
  }
  if (!Number.isFinite(args.pages) || args.pages < 1 || args.pages > 20) {
    throw new Error('Invalid --pages. Use 1-20 pages to keep this a bounded sample export.');
  }
  if (!['pizza', 'taco'].includes(args.entity)) throw new Error('Invalid --entity');
  if (!args.token) {
    throw new Error('Missing HF_TOKEN or HUGGINGFACE_HUB_TOKEN for gated Hugging Face FSQ OS Places access. FSQ_PLACES_TOKEN is for the Places Portal/Iceberg path.');
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/export-fsq-hf-sample.mjs [options]

Options:
  --dataset <id>      Hugging Face dataset id
                      (default foursquare/fsq-os-places)
  --config <name>     Dataset Viewer config (default places)
  --split <name>      Dataset Viewer split (default train)
  --query <text>      Text search query; omit/empty to use /rows
                      (default pizza)
  --offset <n>        Row/search offset (default 0)
  --length <n>        Rows to export, max 100 (default 100)
  --pages <n>         Number of Dataset Viewer pages to fetch, max 20
                      (default 1)
  --output <file>     JSON output path
  --entity <pizza|taco>
                      Entity for the optional adapter report (default pizza)
  --review-output <file>
                      Review JSON path for --run-report
  --run-report        After export, run source-input-sample-report
  --token <token>     Hugging Face token; default HF_TOKEN/HUGGINGFACE_HUB_TOKEN

After export, run:
  node scripts/ops/source-input-sample-report.mjs \\
    --source fsq_os_places \\
    --input <output-file> \\
    --entity <pizza|taco> \\
    --review-output reports/source-review/fsq-os-places-review.json
`);
}

function datasetViewerUrl(args, offset = args.offset) {
  const endpoint = args.query ? 'search' : 'rows';
  const url = new URL(`https://datasets-server.huggingface.co/${endpoint}`);
  url.searchParams.set('dataset', args.dataset);
  url.searchParams.set('config', args.config);
  url.searchParams.set('split', args.split);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', String(args.length));
  if (args.query) url.searchParams.set('query', args.query);
  return url;
}

function normalizeRow(row) {
  return row?.row || row || {};
}

async function fetchJson(url, token) {
  for (let attempt = 0; attempt <= DATASET_LOADING_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Keep the raw text for a useful error below.
      }

      if (res.ok) return json;

      const message = json?.error || json?.message || text || `${res.status} ${res.statusText}`;
      const loading = /dataset index is loading|dataset is loading/i.test(message);
      if (!loading || attempt >= DATASET_LOADING_RETRIES) {
        throw new Error(`Dataset Viewer request failed: ${message}`);
      }
      const backoffMs = Math.min(5000 * (2 ** attempt), 30000);
      console.error(`Dataset Viewer index is loading; retrying in ${backoffMs}ms (${attempt + 1}/${DATASET_LOADING_RETRIES})`);
      await new Promise(resolveDelay => setTimeout(resolveDelay, backoffMs));
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Dataset Viewer request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const rows = [];

  for (let page = 0; page < args.pages; page++) {
    const offset = args.offset + (page * args.length);
    const url = datasetViewerUrl(args, offset);
    const payload = await fetchJson(url, args.token);
    const pageRows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeRow) : [];
    rows.push(...pageRows);

    if (pageRows.length < args.length) {
      break;
    }
  }

  if (!rows.length) {
    throw new Error('Dataset Viewer returned no rows. Check config/split/query or token access.');
  }

  const outputPath = resolve(process.cwd(), args.output);
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);

  console.log('# FSQ Hugging Face Sample Export');
  console.log('');
  console.log(`Dataset: ${args.dataset}`);
  console.log(`Config: ${args.config}`);
  console.log(`Split: ${args.split}`);
  console.log(`Query: ${args.query || '(none)'}`);
  console.log(`Offset: ${args.offset}`);
  console.log(`Page size: ${args.length}`);
  console.log(`Pages requested: ${args.pages}`);
  console.log(`Rows written: ${rows.length}`);
  console.log(`Output: ${args.output}`);
  console.log('');
  console.log('Next command:');
  const nextCommand = [
    process.execPath,
    'scripts/ops/source-input-sample-report.mjs',
    '--source', 'fsq_os_places',
    '--input', args.output,
    '--entity', args.entity,
    '--max-distance-m', '100',
    '--limit', '5000',
    '--sample', '25',
    '--review-output', args.reviewOutput,
  ];
  console.log(nextCommand.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));

  if (args.runReport) {
    console.log('');
    console.log('Running source adapter report...');
    execFileSync(nextCommand[0], nextCommand.slice(1), { stdio: 'inherit' });
  }
}

main().catch(error => {
  console.error(`export-fsq-hf-sample failed: ${error.message || error}`);
  process.exit(1);
});
