#!/usr/bin/env node
/**
 * Check whether this machine is ready to run an FSQ OS Places sample.
 *
 * FSQ access is currently gated. This script does not download data; it checks
 * whether a local sample, Hugging Face token, or Places Portal token is
 * available and prints the exact commands/instructions for the next step.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PORTAL_INIT_SQL_EXAMPLE_MARKERS = [
  'Example FSQ Places Portal DuckDB setup file',
  'Paste the actual Portal setup SQL below',
  'Copy the DuckDB/Iceberg setup SQL from the Foursquare Places Portal',
];

function parseArgs(argv) {
  const args = {
    input: process.env.FSQ_OS_PLACES_SAMPLE || '',
    dataset: 'foursquare/fsq-os-places',
    config: 'places',
    split: 'train',
    query: 'pizza',
    country: process.env.FSQ_OS_PLACES_COUNTRY || 'US',
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
    else if (arg === '--country') args.country = argv[++i];
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
  --config <name>         Hugging Face config (default places)
  --split <name>          Dataset Viewer split (default train)
  --query <text>          Dataset Viewer search text (default pizza)
  --country <code>        Optional country filter for Parquet export
                          (default US; use empty string to disable)
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

function inspectPortalInitSql(path) {
  if (!existsSync(path)) {
    return {
      state: 'missing',
      ready: false,
      detail: 'Portal DuckDB setup SQL file is missing.',
    };
  }

  const text = readFileSync(path, 'utf8');
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      state: 'empty',
      ready: false,
      detail: 'Portal DuckDB setup SQL file exists but is empty.',
    };
  }

  if (PORTAL_INIT_SQL_EXAMPLE_MARKERS.some(marker => text.includes(marker))) {
    return {
      state: 'example_only',
      ready: false,
      detail: 'Portal DuckDB setup SQL file looks like the checked-in example, not the real Portal snippet.',
    };
  }

  const executableSqlPattern = /\b(ATTACH|CREATE|INSTALL|LOAD|SET|CALL|SELECT)\b/i;
  if (!executableSqlPattern.test(text)) {
    return {
      state: 'invalid',
      ready: false,
      detail: 'Portal DuckDB setup SQL file does not appear to contain executable DuckDB SQL.',
    };
  }

  return {
    state: 'present',
    ready: true,
    detail: 'Portal DuckDB setup SQL file is present and looks executable.',
  };
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

function hfParquetExportCommand(args) {
  const command = [
    'scripts/.fsq-venv/bin/python',
    'scripts/ops/export-fsq-hf-parquet-sample.py',
    '--dataset', args.dataset,
    '--config', args.config,
    '--split', args.split,
    '--query', args.query,
    '--limit', String(args.exportLength * args.exportPages),
    '--max-files', String(args.exportPages),
    '--output', args.input || args.output,
    '--entity', args.entity,
    '--review-output', args.reviewOutput,
    '--run-report',
  ];
  if (args.country) command.splice(10, 0, '--country', args.country);
  return command;
}

function portalExportCommand(args) {
  return [
    'scripts/.fsq-venv/bin/python',
    'scripts/ops/export-fsq-portal-duckdb-sample.py',
    '--init-sql-file', 'scripts/.fsq-portal-init.sql',
    '--places-table', process.env.FSQ_PLACES_TABLE || 'open_h3.places',
    '--categories-table', process.env.FSQ_CATEGORIES_TABLE || 'open_h3.categories',
    '--query', args.query,
    '--limit', String(args.exportLength * args.exportPages),
    '--output', args.input || args.output,
    '--entity', args.entity,
    '--review-output', args.reviewOutput,
    '--run-report',
  ];
}

function portalSetupCommand() {
  return [
    'sh',
    '-lc',
    'python3 -m venv scripts/.fsq-venv && scripts/.fsq-venv/bin/python -m pip install --upgrade pip duckdb pyiceberg pyarrow',
  ];
}

function validatePortalExportPath({ hasPortalToken, portalPythonDuckdbPresent, portalInitSqlReady }) {
  if (!hasPortalToken || !portalPythonDuckdbPresent || !portalInitSqlReady) {
    return {
      checked: false,
      ready: false,
      state: 'not_checked',
      detail: 'Portal token, Python DuckDB environment, and setup SQL are required before validation.',
    };
  }

  try {
    const raw = execFileSync('scripts/.fsq-venv/bin/python', [
      'scripts/ops/export-fsq-portal-duckdb-sample.py',
      '--init-sql-file', 'scripts/.fsq-portal-init.sql',
      '--places-table', process.env.FSQ_PLACES_TABLE || 'open_h3.places',
      '--categories-table', process.env.FSQ_CATEGORIES_TABLE || 'open_h3.categories',
      '--validate-only',
      '--json',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    const payload = JSON.parse(raw);
    return {
      checked: true,
      ready: Boolean(payload.ok),
      state: payload.state || (payload.ok ? 'ready' : 'invalid'),
      detail: payload.ok
        ? `Portal setup exposes places table ${payload.places_table}.`
        : `Portal setup does not expose places table ${payload.places_table}: ${payload.places_error || 'unknown error'}`,
      payload,
    };
  } catch (error) {
    let payload = null;
    try {
      payload = JSON.parse(String(error.stdout || '').trim());
    } catch {
      payload = null;
    }
    return {
      checked: true,
      ready: false,
      state: payload?.state || 'validation_failed',
      detail: payload?.places_error || String(error.stderr || error.stdout || error.message || error).trim(),
      payload,
    };
  }
}

function portalSetupSteps(payload = {}) {
  const portalSqlPresent = payload.portal_init_sql === 'present';
  const portalPythonPresent = payload.portal_python_duckdb === 'present';
  const portalConnectionChecked = Boolean(payload.portal_connection_checked);
  const portalConnectionReady = payload.portal_connection === 'ready';
  return [
    {
      id: 'copy_portal_sql',
      status: portalSqlPresent ? 'done' : 'needed',
      title: 'Save the Places Portal DuckDB/Iceberg setup SQL',
      detail: payload.portal_init_sql && !['missing', 'present'].includes(payload.portal_init_sql)
        ? `${payload.portal_init_sql_detail} Replace it with the real Portal-provided setup snippet in ${payload.portal_init_sql_path || 'scripts/.fsq-portal-init.sql'}; keep tokens out of git.`
        : `Copy the Portal-provided setup snippet into ${payload.portal_init_sql_path || 'scripts/.fsq-portal-init.sql'}; use ${payload.portal_init_sql_example_path || 'scripts/ops/fsq-portal-init.example.sql'} as the checklist and keep tokens out of git.`,
    },
    {
      id: 'create_python_duckdb_venv',
      status: payload.portal_python_duckdb === 'present' ? 'done' : 'needed',
      title: 'Create the ignored Python DuckDB environment',
      detail: 'Run the setup command once on the machine that will export the bounded FSQ sample.',
    },
    {
      id: 'validate_portal_tables',
      status: portalConnectionReady ? 'done' : (portalSqlPresent && portalPythonPresent && portalConnectionChecked ? 'needed' : 'blocked'),
      title: 'Expose queryable FSQ places/categories tables',
      detail: portalConnectionReady
        ? 'The Portal setup exposes a queryable places table for export.'
        : 'Create or fix places/categories views in scripts/.fsq-portal-init.sql using the actual Portal table names; the exporter validates SELECT * FROM places LIMIT 0 before running.',
    },
    {
      id: 'run_portal_export',
      status: payload.can_export_via_portal ? 'ready' : 'blocked',
      title: 'Export a bounded sample and run the read-only adapter report',
      detail: 'After the token, SQL setup, and Python environment are present, run the Places Portal export command.',
    },
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
  const sampleAdapterCommand = payload.adapter_command.map(part => (
    part === '<exported-fsq-sample.csv>' ? payload.output : part
  ));
  const adapter = formatCommand(sampleAdapterCommand);
  const hfExport = formatCommand(payload.hf_export_command);
  const hfParquetExport = formatCommand(payload.hf_parquet_export_command);
  const portalExport = formatCommand(payload.portal_export_command);
  const portalSetup = formatCommand(payload.portal_setup_command);
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
    '# This handoff chooses the safest available FSQ sample path for this machine.',
    '# It never writes canonical tables, place_sources, or Supabase directly.',
    '',
    `SAMPLE_PATH=${shellQuote(payload.output)}`,
    `PORTAL_INIT_SQL=${shellQuote(payload.portal_init_sql_path)}`,
    `PORTAL_INIT_SQL_EXAMPLE=${shellQuote(payload.portal_init_sql_example_path)}`,
    'PORTAL_PYTHON=scripts/.fsq-venv/bin/python',
    '',
    'HF_TOKEN="${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}"',
    'export HF_TOKEN',
    '',
    'if [ -f "${SAMPLE_PATH}" ]; then',
    '  echo "FSQ sample exists; running read-only adapter report."',
    `  ${adapter}`,
    '  exit 0',
    'fi',
    '',
    'if [ -n "${HF_TOKEN}" ]; then',
    '  if [ -x "${PORTAL_PYTHON}" ]; then',
    '    echo "Hugging Face token and Python/pyarrow environment present; exporting bounded FSQ Parquet sample and running read-only report."',
    `    ${hfParquetExport}`,
    '    exit 0',
    '  fi',
    '  echo "Hugging Face token present; exporting bounded FSQ sample and running read-only report."',
    `  ${hfExport}`,
    '  exit 0',
    'fi',
    '',
    'if [ -n "${FSQ_PLACES_TOKEN:-}" ]; then',
    '  if [ -x "${PORTAL_PYTHON}" ] && [ -f "${PORTAL_INIT_SQL}" ]; then',
    '    echo "Places Portal setup is present; exporting bounded FSQ sample and running read-only report."',
    `    ${portalExport}`,
    '    exit 0',
    '  fi',
    '  echo "FSQ_PLACES_TOKEN is present, but Places Portal setup is incomplete." >&2',
    '  echo "Use the checked-in setup checklist: ${PORTAL_INIT_SQL_EXAMPLE}" >&2',
    '  echo "Save the Portal DuckDB/Iceberg setup SQL to: ${PORTAL_INIT_SQL}" >&2',
    '  echo "Expected Python DuckDB venv: ${PORTAL_PYTHON}" >&2',
    '  echo "Create the ignored Python DuckDB venv with:" >&2',
    `  echo "  ${portalSetup}" >&2`,
    '  echo "Then rerun this handoff or run:" >&2',
    `  echo "  ${portalExport}" >&2`,
    '  exit 1',
    'fi',
    '',
    'echo "No FSQ sample or export token is available." >&2',
    'echo "Provide one of:" >&2',
    'echo "  1. Exported sample at ${SAMPLE_PATH}" >&2',
    'echo "  2. HF_TOKEN or HUGGINGFACE_HUB_TOKEN" >&2',
    'echo "  3. FSQ_PLACES_TOKEN plus ${PORTAL_INIT_SQL} and ${PORTAL_PYTHON}" >&2',
    'exit 1',
    '',
  ];
  writeFileSync(outputPath, `${lines.join('\n')}\n`, { mode: 0o755 });
  return args.handoffOutput;
}

function readinessPayload(args) {
  // Treat the configured default output as the current sample on subsequent
  // runs, so operators do not need to repeat --input after a successful export.
  if (!args.input && existsSync(resolve(process.cwd(), args.output))) args.input = args.output;
  const inputPath = args.input ? resolve(process.cwd(), args.input) : null;
  const tokens = tokenStatus();
  const missing = [];
  const inputExists = Boolean(inputPath && existsSync(inputPath));

  if (!inputPath) missing.push('exported FSQ sample file (--input or FSQ_OS_PLACES_SAMPLE)');
  else if (!inputExists) missing.push(`FSQ sample file not found: ${args.input}`);

  const hasPortalToken = tokens.some(token => token.name === 'FSQ_PLACES_TOKEN' && token.present);
  const hasHfToken = tokens.some(token => ['HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'].includes(token.name) && token.present);

  if (!inputExists && !hasPortalToken && !hasHfToken) {
    missing.push('exported FSQ sample file, Hugging Face token, or Places Portal token');
  }

  const duckdbPresent = commandExists('duckdb');
  const portalInitSqlPath = 'scripts/.fsq-portal-init.sql';
  const portalInitSqlExamplePath = 'scripts/ops/fsq-portal-init.example.sql';
  const portalInitSqlInspection = inspectPortalInitSql(resolve(process.cwd(), portalInitSqlPath));
  const portalInitSqlExamplePresent = existsSync(resolve(process.cwd(), portalInitSqlExamplePath));
  const portalPythonDuckdbPresent = existsSync(resolve(process.cwd(), 'scripts/.fsq-venv/bin/python'));
  const portalValidation = validatePortalExportPath({
    hasPortalToken,
    portalPythonDuckdbPresent,
    portalInitSqlReady: portalInitSqlInspection.ready,
  });
  const canExportViaPortal = hasPortalToken && portalPythonDuckdbPresent && portalInitSqlInspection.ready && portalValidation.ready;
  if (!inputExists && hasPortalToken && !portalPythonDuckdbPresent) {
    missing.push('Places Portal Python DuckDB venv: scripts/.fsq-venv/bin/python');
  }
  if (!inputExists && hasPortalToken && !portalInitSqlInspection.ready) {
    missing.push(`Places Portal DuckDB setup SQL: ${portalInitSqlPath} (${portalInitSqlInspection.state})`);
  }
  if (!inputExists && hasPortalToken && portalPythonDuckdbPresent && portalInitSqlInspection.ready && !portalValidation.ready) {
    missing.push(`Places Portal DuckDB setup SQL does not expose an exportable places table (${portalValidation.state})`);
  }
  const canExportViaHf = hasHfToken;
  const readyState = inputExists
    ? 'sample_ready'
    : canExportViaHf
      ? 'hf_export_ready'
      : hasPortalToken
        ? canExportViaPortal
          ? 'portal_export_ready'
          : 'portal_setup_needed'
        : 'blocked_missing_sample_or_token';
  const command = adapterCommand(args);
  const hfCommand = exportCommand(args);
  const hfParquetCommand = hfParquetExportCommand(args);
  const portalCommand = portalExportCommand(args);
  const portalSetup = portalSetupCommand();
  const recommendedAction = inputExists
    ? 'run_adapter_report'
    : canExportViaHf
      ? 'export_hf_sample_and_run_report'
      : hasPortalToken
        ? canExportViaPortal
          ? 'export_places_portal_sample_then_run_report'
          : 'save_places_portal_init_sql_then_export'
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
    country: args.country,
    output: args.input || args.output,
    duckdb_cli: duckdbPresent ? 'present' : 'missing',
    portal_python_duckdb: portalPythonDuckdbPresent ? 'present' : 'missing',
    portal_init_sql: portalInitSqlInspection.state,
    portal_init_sql_detail: portalInitSqlInspection.detail,
    portal_init_sql_path: portalInitSqlPath,
    portal_init_sql_example: portalInitSqlExamplePresent ? 'present' : 'missing',
    portal_init_sql_example_path: portalInitSqlExamplePath,
    portal_connection: portalValidation.state,
    portal_connection_detail: portalValidation.detail,
    portal_connection_checked: portalValidation.checked,
    portal_connection_payload: portalValidation.payload || null,
    portal_setup_command: portalSetup,
    duckdb_note: duckdbPresent
      ? 'available for future Iceberg/full-slice work'
      : portalPythonDuckdbPresent
        ? 'DuckDB CLI missing, but ignored Python DuckDB venv is available for Places Portal sample exports'
        : 'optional for Hugging Face sample export; required only for future Iceberg/full-slice work',
    tokens,
    can_export_via_hf: canExportViaHf,
    can_export_via_hf_parquet: hasHfToken && portalPythonDuckdbPresent,
    can_export_via_portal: canExportViaPortal,
    has_places_portal_token: hasPortalToken,
    missing,
    adapter_command: command,
    hf_export_command: hfCommand,
    hf_parquet_export_command: hfParquetCommand,
    portal_export_command: portalCommand,
    portal_setup_steps: portalSetupSteps({
      portal_init_sql: portalInitSqlInspection.state,
      portal_init_sql_path: portalInitSqlPath,
      portal_init_sql_example_path: portalInitSqlExamplePath,
      portal_python_duckdb: portalPythonDuckdbPresent ? 'present' : 'missing',
      portal_connection: portalValidation.state,
      portal_connection_checked: portalValidation.checked,
      can_export_via_portal: canExportViaPortal,
    }),
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
  console.log(`portal_python_duckdb=${payload.portal_python_duckdb}`);
  console.log(`portal_init_sql=${payload.portal_init_sql}`);
  console.log(`portal_init_sql_example=${payload.portal_init_sql_example}`);
  console.log(`portal_connection=${payload.portal_connection}`);
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
  console.log('');
  console.log('Hugging Face Parquet sample export command:');
  console.log(payload.hf_parquet_export_command.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
  console.log('');
  console.log('Places Portal DuckDB sample export command:');
  console.log(payload.portal_export_command.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
  console.log('');
  console.log('Places Portal setup command:');
  console.log(payload.portal_setup_command.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
  if (Array.isArray(payload.portal_setup_steps) && payload.portal_setup_steps.length) {
    console.log('');
    console.log('Places Portal setup checklist:');
    for (const step of payload.portal_setup_steps) {
      console.log(`- [${step.status}] ${step.title}: ${step.detail}`);
    }
  }
  if (payload.portal_connection_detail) {
    console.log('');
    console.log(`Places Portal connection check: ${payload.portal_connection_detail}`);
  }

  if (payload.missing.length) {
    console.log('');
    console.log('Missing prerequisites:');
    for (const item of payload.missing) console.log(`- ${item}`);
  } else if (!payload.input_exists && payload.can_export_via_hf) {
    console.log('');
    console.log('Ready to export a bounded Hugging Face sample with the command above.');
  } else if (!payload.input_exists && payload.can_export_via_portal) {
    console.log('');
    console.log('Ready to export a bounded Places Portal sample with the command above.');
  } else if (!payload.input_exists && payload.has_places_portal_token) {
    console.log('');
    console.log(`Places Portal token is present. Use ${payload.portal_init_sql_example_path} as a setup checklist, save the real Portal DuckDB setup SQL to ${payload.portal_init_sql_path}, then run the Places Portal export command above.`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const payload = readinessPayload(args);

  let handoffWritten = null;
  if (args.writeHandoff || (args.runOrHandoff && ['blocked_missing_sample_or_token', 'portal_setup_needed'].includes(payload.state))) {
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
    } else if (payload.can_export_via_portal) {
      execFileSync(payload.portal_export_command[0], payload.portal_export_command.slice(1), { stdio: 'inherit' });
    } else {
      console.log('');
      console.log(`FSQ sample is blocked until an exported sample file or export-ready token path exists. Handoff written: ${handoffWritten}`);
    }
  }
}

main();
