#!/usr/bin/env node
/**
 * Check whether this machine is ready to run an FSQ OS Places sample.
 *
 * FSQ access is currently gated. This script does not download data; it checks
 * whether a local sample or Hugging Face token is available and prints the
 * exact commands for the next step.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function parseArgs(argv) {
  const args = {
    input: process.env.FSQ_OS_PLACES_SAMPLE || '',
    dataset: 'foursquare/fsq-os-places',
    config: 'default',
    split: 'train',
    query: 'pizza',
    entity: 'pizza',
    reviewOutput: 'reports/source-review/fsq-os-places-review.json',
    output: 'data/source-samples/fsq-os-places-pizza-sample.json',
    handoffOutput: 'reports/fsq-os-places-handoff.sh',
    exportLength: 100,
    exportPages: 1,
    writeHandoff: false,
    run: false,
    runOrHandoff: false,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--dataset') args.dataset = argv[++i];
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--split') args.split = argv[++i];
    else if (arg === '--query') args.query = argv[++i];
    else if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--review-output') args.reviewOutput = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--handoff-output') args.handoffOutput = argv[++i];
    else if (arg === '--export-length') args.exportLength = parseInt(argv[++i], 10);
    else if (arg === '--export-pages') args.exportPages = parseInt(argv[++i], 10);
    else if (arg === '--write-handoff') args.writeHandoff = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--run-or-handoff') args.runOrHandoff = true;
    else if (arg === '--json') args.json = true;
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
  if (!args.handoffOutput) throw new Error('Missing --handoff-output');
  if (!['pizza', 'taco'].includes(args.entity)) throw new Error('Invalid --entity');
  if (!Number.isFinite(args.exportLength) || args.exportLength < 1 || args.exportLength > 100) {
    throw new Error('Invalid --export-length');
  }
  if (!Number.isFinite(args.exportPages) || args.exportPages < 1 || args.exportPages > 20) {
    throw new Error('Invalid --export-pages');
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/fsq-sample-preflight.mjs [options]

Options:
  --input <file>          Exported FSQ JSON/CSV/NDJSON sample
                          (or FSQ_OS_PLACES_SAMPLE env var)
  --dataset <id>          Hugging Face dataset id
                          (default foursquare/fsq-os-places)
  --config <name>         Dataset Viewer config (default default)
  --split <name>          Dataset Viewer split (default train)
  --query <text>          Dataset Viewer search text (default pizza)
  --entity <pizza|taco>   Entity to compare against (default pizza)
  --review-output <file>  Review JSON output path
  --output <file>         Output file for generated HF export command
  --handoff-output <file> Shell handoff file to write with --write-handoff
                          (default reports/fsq-os-places-handoff.sh)
  --export-length <n>     HF Dataset Viewer page size, max 100 (default 100)
  --export-pages <n>      HF Dataset Viewer page count, max 20 (default 1)
  --write-handoff         Persist the next export/report commands to a shell file
  --run                   Run source-input-sample-report when input exists
  --run-or-handoff        Run the next available step, or write a handoff script
  --json                  Emit machine-readable readiness JSON
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

function tokenStatus() {
  const env = mergedEnv();
  const names = ['FSQ_PLACES_TOKEN', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'];
  return names.map(name => ({ name, present: Boolean(env[name]) }));
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

function exportCommand(args) {
  return [
    process.execPath,
    'scripts/ops/export-fsq-hf-sample.mjs',
    '--dataset', args.dataset,
    '--config', args.config,
    '--split', args.split,
    '--query', args.query,
    '--length', String(args.exportLength),
    '--pages', String(args.exportPages),
    '--output', args.input || args.output,
    '--entity', args.entity,
    '--review-output', args.reviewOutput,
    '--run-report',
  ];
}

function shellQuote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function formatCommand(command) {
  return command.map(shellQuote).join(' ');
}

function writeHandoffFile(payload, args) {
  const outputPath = resolve(process.cwd(), args.handoffOutput);
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  const tokenNames = payload.tokens.map(token => token.name).join(' or ');
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Generated by scripts/ops/fsq-sample-preflight.mjs.',
    '# This file intentionally does not contain a token value.',
    `# State at generation: ${payload.state}`,
    `# Dataset: ${payload.dataset}`,
    `# Query: ${payload.query}`,
    '',
    'FSQ_PLACES_TOKEN="${FSQ_PLACES_TOKEN:-${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}}"',
    'export FSQ_PLACES_TOKEN',
    'if [ -z "${FSQ_PLACES_TOKEN}" ]; then',
    `  echo "Set ${tokenNames} before running this handoff." >&2`,
    '  exit 1',
    'fi',
    '',
    '# Export a bounded FSQ OS Places sample and run the read-only adapter report.',
    formatCommand(payload.hf_export_command),
    '',
    '# If a sample already exists, run only the adapter report with:',
    `# ${formatCommand(payload.adapter_command)}`,
    '',
  ];
  writeFileSync(outputPath, `${lines.join('\n')}\n`, { mode: 0o755 });
  return args.handoffOutput;
}

function readinessPayload(args) {
  const inputPath = args.input ? resolve(process.cwd(), args.input) : null;
  const tokens = tokenStatus();
  const missing = [];
  const inputExists = Boolean(inputPath && existsSync(inputPath));

  if (!inputPath) missing.push('exported FSQ sample file (--input or FSQ_OS_PLACES_SAMPLE)');
  else if (!inputExists) missing.push(`FSQ sample file not found: ${args.input}`);

  if (!inputExists && !tokens.some(token => token.present)) {
    missing.push('FSQ/Hugging Face access token env var (FSQ_PLACES_TOKEN, HF_TOKEN, or HUGGINGFACE_HUB_TOKEN)');
  }

  const duckdbPresent = commandExists('duckdb');
  const canExportViaHf = tokens.some(token => token.present);
  const readyState = inputExists ? 'sample_ready' : canExportViaHf ? 'hf_export_ready' : 'blocked_missing_sample_or_token';
  const command = adapterCommand(args);
  const hfCommand = exportCommand(args);
  const recommendedAction = inputExists
    ? 'run_adapter_report'
    : canExportViaHf
      ? 'export_hf_sample_and_run_report'
      : 'write_handoff_and_set_token_or_sample';

  return {
    state: readyState,
    recommended_action: recommendedAction,
    input: args.input || null,
    input_exists: inputExists,
    input_path: inputPath,
    dataset: args.dataset,
    config: args.config,
    split: args.split,
    query: args.query,
    output: args.input || args.output,
    duckdb_cli: duckdbPresent ? 'present' : 'missing',
    duckdb_note: duckdbPresent
      ? 'available for future Iceberg/full-slice work'
      : 'optional for Hugging Face sample export; required only for future Iceberg/full-slice work',
    tokens,
    can_export_via_hf: canExportViaHf,
    missing,
    adapter_command: command,
    hf_export_command: hfCommand,
    handoff_output: args.handoffOutput,
  };
}

function printText(payload) {
  const tokenLabel = token => `${token.name}=${token.present ? 'present' : 'missing'}`;

  console.log('# FSQ OS Places Sample Preflight');
  console.log('');
  console.log(`state=${payload.state}`);
  console.log(`recommended_action=${payload.recommended_action}`);
  console.log(`duckdb_cli=${payload.duckdb_cli}`);
  console.log(`duckdb_note=${payload.duckdb_note}`);
  for (const token of payload.tokens) {
    console.log(tokenLabel(token));
  }
  console.log(`input=${payload.input || '(missing)'}`);
  console.log(`dataset=${payload.dataset}`);
  console.log(`config=${payload.config}`);
  console.log(`split=${payload.split}`);
  console.log(`query=${payload.query}`);
  console.log(`output=${payload.output}`);
  console.log(`handoff_output=${payload.handoff_output}`);
  console.log('');
  console.log('Adapter command:');
  console.log(payload.adapter_command.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
  console.log('');
  console.log('Hugging Face sample export command:');
  console.log(payload.hf_export_command.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));

  if (payload.missing.length) {
    console.log('');
    console.log('Missing prerequisites:');
    for (const item of payload.missing) console.log(`- ${item}`);
  } else if (!payload.input_exists && payload.can_export_via_hf) {
    console.log('');
    console.log('Ready to export a bounded Hugging Face sample with the command above.');
  }
}

function main() {
  const args = parseArgs(process.argv);
  const payload = readinessPayload(args);

  let handoffWritten = null;
  if (args.writeHandoff || (args.runOrHandoff && payload.state === 'blocked_missing_sample_or_token')) {
    handoffWritten = writeHandoffFile(payload, args);
    payload.handoff_written = handoffWritten;
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printText(payload);
    if (handoffWritten) {
      console.log('');
      console.log(`Wrote handoff: ${handoffWritten}`);
    }
  }

  if (args.run) {
    if (payload.missing.some(item => item.includes('sample'))) {
      throw new Error('Cannot run without an exported FSQ sample file.');
    }
    execFileSync(payload.adapter_command[0], payload.adapter_command.slice(1), { stdio: 'inherit' });
  }

  if (args.runOrHandoff) {
    if (payload.input_exists) {
      execFileSync(payload.adapter_command[0], payload.adapter_command.slice(1), { stdio: 'inherit' });
    } else if (payload.can_export_via_hf) {
      execFileSync(payload.hf_export_command[0], payload.hf_export_command.slice(1), { stdio: 'inherit' });
    } else {
      console.log('');
      console.log(`FSQ sample is blocked until a sample file or token exists. Handoff written: ${handoffWritten}`);
    }
  }
}

main();
