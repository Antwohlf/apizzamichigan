#!/usr/bin/env node
/**
 * Download and process selected All the Places spider outputs.
 *
 * This wraps source-input-sample-report so ATP runs are repeatable and keep
 * review JSON artifacts for ambiguous/new rows.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { basename, join, resolve } from 'path';

const DEFAULT_BASE_URL = 'https://data.alltheplaces.xyz/runs/latest/output';
const DEFAULT_SPIDERS = [
  'little_caesars_us',
  'pizza_hut_us',
  'dominos_pizza_us',
  'papa_johns',
  'marcos',
  'papa_murphys',
  'mod_pizza',
  'california_pizza_kitchen',
  'foxs_pizza',
  'monicals_pizza_us',
  'mr_gattis_pizza_us',
  'and_pizza',
  'grimaldis_pizzeria',
];

function parseArgs(argv) {
  const args = {
    spiders: [],
    entity: 'pizza',
    outputDir: 'reports/source-review',
    downloadDir: '/tmp',
    baseUrl: DEFAULT_BASE_URL,
    apply: false,
    sample: 3,
    limit: 20000,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spider') args.spiders.push(argv[++i]);
    else if (arg === '--spiders') args.spiders.push(...argv[++i].split(',').map(item => item.trim()).filter(Boolean));
    else if (arg === '--default-spiders') args.spiders.push(...DEFAULT_SPIDERS);
    else if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--download-dir') args.downloadDir = argv[++i];
    else if (arg === '--base-url') args.baseUrl = argv[++i].replace(/\/$/, '');
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--sample') args.sample = parseInt(argv[++i], 10);
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.spiders.length) throw new Error('Pass --spider <name>, --spiders <a,b>, or --default-spiders');
  if (!['pizza', 'taco'].includes(args.entity)) throw new Error('Invalid --entity');
  if (!Number.isFinite(args.sample) || args.sample < 0) throw new Error('Invalid --sample');
  if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error('Invalid --limit');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/import-atp-spiders.mjs [options]

Options:
  --spider <name>       Add one ATP spider name
  --spiders <a,b,c>     Add comma-separated spider names
  --default-spiders     Use the current APizza pizza spider shortlist
  --entity <pizza|taco> Canonical entity to compare against (default pizza)
  --output-dir <dir>    Review JSON directory (default reports/source-review)
  --download-dir <dir>  GeoJSON download directory (default /tmp)
  --base-url <url>      ATP output base URL (default latest run output)
  --apply               Write accepted matches to place_sources
  --sample <n>          Printed sample rows per bucket (default 3)
  --limit <n>           Max rows per spider (default 20000)

Without --apply, this only downloads inputs and writes review JSON.
`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: options.timeout || 120000,
    ...options,
  }).trim();
}

function featureCount(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed.features) ? parsed.features.length : 0;
}

function main() {
  const args = parseArgs(process.argv);
  mkdirSync(resolve(process.cwd(), args.outputDir), { recursive: true });
  mkdirSync(args.downloadDir, { recursive: true });

  const rows = [];
  for (const spider of args.spiders) {
    const fileName = `${spider}.geojson`;
    const outputPath = join(args.downloadDir, fileName);
    const reviewPath = join(args.outputDir, `${spider}-review.json`);
    const url = `${args.baseUrl}/${fileName}`;

    console.log(`## ${spider}`);
    console.log(`Downloading ${url}`);
    run('curl', ['-L', '-s', url, '-o', outputPath]);

    if (!existsSync(outputPath)) throw new Error(`Download failed: ${outputPath}`);
    const features = featureCount(outputPath);
    console.log(`features=${features}`);

    const reportArgs = [
      'scripts/ops/source-input-sample-report.mjs',
      '--source', 'all_the_places',
      '--input', outputPath,
      '--entity', args.entity,
      '--limit', String(args.limit),
      '--sample', String(args.sample),
      '--review-output', reviewPath,
    ];
    if (args.apply) reportArgs.push('--apply');

    run(process.execPath, reportArgs, { timeout: 180000 });

    const report = JSON.parse(readFileSync(resolve(process.cwd(), reviewPath), 'utf8'));
    rows.push({
      spider,
      input: report.counts.inputRowsInspected,
      matched: report.counts.matchedExistingPlaces,
      ambiguous: report.counts.ambiguousReviewCandidates,
      likely_new: report.counts.likelyNewUnmatchedCandidates,
      accepted: report.counts.acceptedForPlaceSourcesImport,
      mode: args.apply ? 'apply' : 'dry-run',
      review_file: basename(reviewPath),
    });
  }

  console.log('');
  console.log('# ATP Spider Import Summary');
  console.log('| spider | input | matched | ambiguous | likely_new | accepted | mode | review_file |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    console.log(`| ${row.spider} | ${row.input} | ${row.matched} | ${row.ambiguous} | ${row.likely_new} | ${row.accepted} | ${row.mode} | ${row.review_file} |`);
  }
}

main();
