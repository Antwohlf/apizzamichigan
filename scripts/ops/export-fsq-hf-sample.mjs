#!/usr/bin/env node
/**
 * Export a small FSQ OS Places sample through the Hugging Face Dataset Viewer.
 *
 * This is intentionally small-slice tooling. It requires gated dataset access
 * and writes JSON rows that source-input-sample-report.mjs can consume.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_DATASET = 'foursquare/fsq-os-places';

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
    config: 'default',
    split: 'train',
    query: 'pizza',
    offset: 0,
    length: 100,
    output: 'data/source-samples/fsq-os-places-pizza-sample.json',
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
    else if (arg === '--output') args.output = argv[++i];
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
  if (!args.token) {
    throw new Error('Missing HF_TOKEN or HUGGINGFACE_HUB_TOKEN for gated FSQ OS Places access.');
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/export-fsq-hf-sample.mjs [options]

Options:
  --dataset <id>      Hugging Face dataset id
                      (default foursquare/fsq-os-places)
  --config <name>     Dataset Viewer config (default default)
  --split <name>      Dataset Viewer split (default train)
  --query <text>      Text search query; omit/empty to use /rows
                      (default pizza)
  --offset <n>        Row/search offset (default 0)
  --length <n>        Rows to export, max 100 (default 100)
  --output <file>     JSON output path
  --token <token>     HF token; default HF_TOKEN/HUGGINGFACE_HUB_TOKEN

After export, run:
  node scripts/ops/source-input-sample-report.mjs \\
    --source fsq_os_places \\
    --input <output-file> \\
    --entity pizza \\
    --review-output reports/source-review/fsq-os-places-review.json
`);
}

function datasetViewerUrl(args) {
  const endpoint = args.query ? 'search' : 'rows';
  const url = new URL(`https://datasets-server.huggingface.co/${endpoint}`);
  url.searchParams.set('dataset', args.dataset);
  url.searchParams.set('config', args.config);
  url.searchParams.set('split', args.split);
  url.searchParams.set('offset', String(args.offset));
  url.searchParams.set('length', String(args.length));
  if (args.query) url.searchParams.set('query', args.query);
  return url;
}

function normalizeRow(row) {
  return row?.row || row || {};
}

async function fetchJson(url, token) {
  const res = await fetch(url, {
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

  if (!res.ok) {
    const message = json?.error || json?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(`Dataset Viewer request failed: ${message}`);
  }

  return json;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = datasetViewerUrl(args);
  const payload = await fetchJson(url, args.token);
  const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeRow) : [];

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
  console.log(`Rows written: ${rows.length}`);
  console.log(`Output: ${args.output}`);
  console.log('');
  console.log('Next command:');
  console.log([
    process.execPath,
    'scripts/ops/source-input-sample-report.mjs',
    '--source', 'fsq_os_places',
    '--input', args.output,
    '--entity', 'pizza',
    '--review-output', 'reports/source-review/fsq-os-places-review.json',
  ].map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
}

main().catch(error => {
  console.error(`export-fsq-hf-sample failed: ${error.message || error}`);
  process.exit(1);
});
