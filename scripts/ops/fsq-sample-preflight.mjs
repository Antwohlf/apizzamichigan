#!/usr/bin/env node
/**
 * Check whether this machine is ready to run an FSQ OS Places sample.
 *
 * FSQ access is currently gated. This script does not download data; it
 * verifies the local prerequisites and prints the exact source-adapter command
 * to run once an exported sample exists.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

function parseArgs(argv) {
  const args = {
    input: process.env.FSQ_OS_PLACES_SAMPLE || '',
    entity: 'pizza',
    reviewOutput: 'reports/source-review/fsq-os-places-review.json',
    run: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--review-output') args.reviewOutput = argv[++i];
    else if (arg === '--run') args.run = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['pizza', 'taco'].includes(args.entity)) throw new Error('Invalid --entity');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/fsq-sample-preflight.mjs [options]

Options:
  --input <file>          Exported FSQ JSON/CSV/NDJSON sample
                          (or FSQ_OS_PLACES_SAMPLE env var)
  --entity <pizza|taco>   Entity to compare against (default pizza)
  --review-output <file>  Review JSON output path
  --run                   Run source-input-sample-report when input exists
`);
}

function commandExists(command) {
  try {
    execFileSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tokenStatus() {
  const names = ['FSQ_PLACES_TOKEN', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'];
  return names.map(name => ({ name, present: Boolean(process.env[name]) }));
}

function adapterCommand(args) {
  return [
    process.execPath,
    'scripts/ops/source-input-sample-report.mjs',
    '--source', 'fsq_os_places',
    '--input', args.input || '<exported-fsq-sample.csv>',
    '--entity', args.entity,
    '--max-distance-m', '100',
    '--limit', '5000',
    '--sample', '25',
    '--review-output', args.reviewOutput,
  ];
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = args.input ? resolve(process.cwd(), args.input) : null;
  const tokens = tokenStatus();
  const missing = [];

  if (!inputPath) missing.push('exported FSQ sample file (--input or FSQ_OS_PLACES_SAMPLE)');
  else if (!existsSync(inputPath)) missing.push(`FSQ sample file not found: ${args.input}`);

  if (!tokens.some(token => token.present)) {
    missing.push('FSQ/Hugging Face access token env var (FSQ_PLACES_TOKEN, HF_TOKEN, or HUGGINGFACE_HUB_TOKEN)');
  }

  const duckdbPresent = commandExists('duckdb');
  const command = adapterCommand(args);

  console.log('# FSQ OS Places Sample Preflight');
  console.log('');
  console.log(`duckdb_cli=${duckdbPresent ? 'present' : 'missing'}`);
  for (const token of tokens) {
    console.log(`${token.name}=${token.present ? 'present' : 'missing'}`);
  }
  console.log(`input=${args.input || '(missing)'}`);
  console.log('');
  console.log('Adapter command:');
  console.log(command.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
  console.log('');
  console.log('Hugging Face sample export command:');
  console.log([
    process.execPath,
    'scripts/ops/export-fsq-hf-sample.mjs',
    '--query', 'pizza',
    '--length', '100',
    '--output', args.input || 'data/source-samples/fsq-os-places-pizza-sample.json',
  ].map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));

  if (missing.length) {
    console.log('');
    console.log('Missing prerequisites:');
    for (const item of missing) console.log(`- ${item}`);
  }

  if (args.run) {
    if (missing.some(item => item.includes('sample'))) {
      throw new Error('Cannot run without an exported FSQ sample file.');
    }
    execFileSync(command[0], command.slice(1), { stdio: 'inherit' });
  }
}

main();
