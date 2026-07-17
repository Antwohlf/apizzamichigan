#!/usr/bin/env node
/**
 * Verify the FSQ sample-first workflow without requiring gated credentials.
 *
 * This does not contact Hugging Face or write to Postgres. It proves the
 * checked-in fixture is accepted as a local sample and that preflight produces
 * the adapter command operators should run for a real FSQ slice.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const FIXTURE = 'data/source-samples/fixtures/fsq-os-places-pizza-fixture.json';
const PORTAL_EXPORTER = 'scripts/ops/export-fsq-portal-duckdb-sample.py';
const HF_PARQUET_EXPORTER = 'scripts/ops/export-fsq-hf-parquet-sample.py';
const PORTAL_INIT_EXAMPLE = 'scripts/ops/fsq-portal-init.example.sql';
const PORTAL_INIT_TARGET = 'scripts/.fsq-portal-init.sql';
const SERVER = readFileSync('server/index.js', 'utf8');
const ADMIN_PANEL = readFileSync('src/admin/AdminSourceProvenancePanel.js', 'utf8');
const GITIGNORE = readFileSync('.gitignore', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  assert(existsSync(FIXTURE), `Missing FSQ fixture: ${FIXTURE}`);
  assert(existsSync(PORTAL_EXPORTER), `Missing FSQ Portal exporter: ${PORTAL_EXPORTER}`);
  assert(existsSync(HF_PARQUET_EXPORTER), `Missing FSQ Hugging Face Parquet exporter: ${HF_PARQUET_EXPORTER}`);
  assert(existsSync(PORTAL_INIT_EXAMPLE), `Missing FSQ Portal init example: ${PORTAL_INIT_EXAMPLE}`);
  assert(GITIGNORE.includes('/scripts/.fsq-portal-init.sql'), 'Real FSQ Portal init SQL must stay ignored');
  assert(GITIGNORE.includes('/data/source-samples/.hf-fsq-cache/'), 'HF Parquet cache must stay ignored');

  const portalInitExample = readFileSync(PORTAL_INIT_EXAMPLE, 'utf8');
  const portalExporter = readFileSync(PORTAL_EXPORTER, 'utf8');
  const hfParquetExporter = readFileSync(HF_PARQUET_EXPORTER, 'utf8');
  assert(portalInitExample.includes('scripts/.fsq-portal-init.sql'), 'Portal init example should point to the ignored target file');
  assert(portalInitExample.includes('${FSQ_PLACES_TOKEN}'), 'Portal init example should document supported token placeholders');
  assert(portalInitExample.includes('CREATE OR REPLACE VIEW places'), 'Portal init example should document expected places alias');
  assert(portalInitExample.includes('CREATE OR REPLACE VIEW categories'), 'Portal init example should document expected categories alias');
  assert(portalExporter.includes('--validate-only'), 'Portal exporter should support table-visibility validation');
  assert(portalExporter.includes('validate_table_visibility'), 'Portal exporter should validate queryable places/categories aliases');
  assert(hfParquetExporter.includes('datasets-server.huggingface.co/parquet'), 'HF Parquet exporter should use authenticated parquet metadata');
  assert(hfParquetExporter.includes('pyarrow.parquet'), 'HF Parquet exporter should read parquet shards locally');

  const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert(Array.isArray(rows), 'FSQ fixture must be a JSON array');
  assert(rows.length >= 3, 'FSQ fixture should include active and closed examples');

  const activeRows = rows.filter(row => !row.date_closed);
  const closedRows = rows.filter(row => row.date_closed);
  assert(activeRows.length >= 2, 'FSQ fixture should include at least two active rows');
  assert(closedRows.length >= 1, 'FSQ fixture should include one closed row');

  for (const row of rows) {
    assert(row.fsq_place_id, 'FSQ fixture row missing fsq_place_id');
    assert(row.name, `FSQ fixture row ${row.fsq_place_id} missing name`);
    assert(Number.isFinite(Number(row.latitude)), `FSQ fixture row ${row.fsq_place_id} missing latitude`);
    assert(Number.isFinite(Number(row.longitude)), `FSQ fixture row ${row.fsq_place_id} missing longitude`);
    assert(row.fsq_category_labels || row.category || row.categories, `FSQ fixture row ${row.fsq_place_id} missing category evidence`);
  }

  const output = execFileSync(process.execPath, [
    'scripts/ops/fsq-sample-preflight.mjs',
    '--input', FIXTURE,
    '--entity', 'pizza',
    '--review-output', 'reports/source-review/fsq-fixture-review.json',
    '--json',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const payload = JSON.parse(output);
  assert(payload.state === 'sample_ready', `Expected sample_ready, got ${payload.state}`);
  assert(payload.recommended_action === 'run_adapter_report', `Expected run_adapter_report, got ${payload.recommended_action}`);
  assert(payload.input_exists === true, 'Preflight should see the local FSQ fixture');
  assert(Array.isArray(payload.adapter_command), 'Preflight missing adapter command');
  assert(payload.adapter_command.includes('scripts/ops/source-input-sample-report.mjs'), 'Adapter command should call source-input-sample-report');
  assert(payload.adapter_command.includes('--source'), 'Adapter command missing --source flag');
  assert(payload.adapter_command.includes('fsq_os_places'), 'Adapter command should use fsq_os_places');
  assert(payload.adapter_command.includes(FIXTURE), 'Adapter command should reference the FSQ fixture');
  assert(!payload.missing.length, `Preflight should not report missing prerequisites for a fixture: ${payload.missing.join('; ')}`);

  // The live checkout may already contain a successful sample export. Use a
  // nonexistent temporary output for token-only cases so those assertions
  // exercise the Portal/HF branches instead of silently taking sample_ready.
  const noSampleOutput = join(tmpdir(), `apizza-fsq-verifier-${process.pid}.json`);

  const portalOutput = execFileSync(process.execPath, [
    'scripts/ops/fsq-sample-preflight.mjs',
    '--output', noSampleOutput,
    '--json',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FSQ_OS_PLACES_SAMPLE: '',
      FSQ_PLACES_TOKEN: 'present-for-contract-test',
      HF_TOKEN: '',
      HUGGINGFACE_HUB_TOKEN: '',
    },
  });
  const portalPayload = JSON.parse(portalOutput);
  assert(portalPayload.state === 'portal_setup_needed', `Expected portal_setup_needed, got ${portalPayload.state}`);
  assert(portalPayload.recommended_action === 'save_places_portal_init_sql_then_export', `Unexpected portal-token action: ${portalPayload.recommended_action}`);
  assert(portalPayload.can_export_via_hf === false, 'Places Portal token should not enable Hugging Face export');
  assert(portalPayload.can_export_via_portal === false, 'Places Portal export should require setup SQL and the Python DuckDB venv');
  assert(portalPayload.has_places_portal_token === true, 'Places Portal token should be reported separately');
  assert(['missing', 'empty', 'example_only', 'invalid', 'present'].includes(portalPayload.portal_init_sql), `Unexpected Portal SQL state: ${portalPayload.portal_init_sql}`);
  assert(['not_checked', 'validation_failed', 'invalid', 'ready'].includes(portalPayload.portal_connection), `Unexpected Portal connection state: ${portalPayload.portal_connection}`);
  assert(typeof portalPayload.portal_connection_checked === 'boolean', 'Portal-token preflight should expose whether connection validation ran');
  assert(Array.isArray(portalPayload.portal_export_command), 'Portal-token preflight should include a Portal export command');
  assert(portalPayload.portal_export_command.includes(PORTAL_EXPORTER), 'Portal export command should call the DuckDB helper');
  assert(portalPayload.portal_export_command.includes('scripts/.fsq-portal-init.sql'), 'Portal export command should reference the ignored init SQL file');
  assert(portalPayload.portal_init_sql_example === 'present', 'Portal preflight should report the checked-in init SQL example');
  assert(portalPayload.portal_init_sql_example_path === PORTAL_INIT_EXAMPLE, 'Portal preflight should expose the init SQL example path');
  assert(Array.isArray(portalPayload.portal_setup_command), 'Portal-token preflight should include a Portal setup command');
  assert(portalPayload.portal_setup_command.includes('sh'), 'Portal setup command should be shell executable');
  assert(portalPayload.portal_setup_command.some(part => String(part).includes('python3 -m venv scripts/.fsq-venv')), 'Portal setup command should create the ignored venv');
  assert(Array.isArray(portalPayload.portal_setup_steps), 'Portal-token preflight should include setup checklist steps');
  assert(portalPayload.portal_setup_steps.some(step => step.id === 'copy_portal_sql' && ['needed', 'done'].includes(step.status)), 'Portal setup checklist should expose ignored Portal SQL status');
  assert(portalPayload.portal_setup_steps.some(step => step.id === 'create_python_duckdb_venv' && ['needed', 'done'].includes(step.status)), 'Portal setup checklist should expose the ignored Python DuckDB venv state');
  assert(portalPayload.portal_setup_steps.some(step => step.id === 'validate_portal_tables'), 'Portal setup checklist should include queryable places/categories table validation');
  assert(portalPayload.portal_setup_steps.some(step => step.id === 'run_portal_export'), 'Portal setup checklist should include the export readiness step');
  assert(!JSON.stringify(portalPayload).includes('present-for-contract-test'), 'Preflight output must not echo token values');

  const hfOutput = execFileSync(process.execPath, [
    'scripts/ops/fsq-sample-preflight.mjs',
    '--output', noSampleOutput,
    '--json',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FSQ_OS_PLACES_SAMPLE: '',
      FSQ_PLACES_TOKEN: '',
      HF_TOKEN: 'present-for-contract-test',
      HUGGINGFACE_HUB_TOKEN: '',
    },
  });
  const hfPayload = JSON.parse(hfOutput);
  assert(hfPayload.state === 'hf_export_ready', `Expected hf_export_ready, got ${hfPayload.state}`);
  assert(hfPayload.recommended_action === 'export_hf_sample_and_run_report', `Unexpected HF-token action: ${hfPayload.recommended_action}`);
  assert(Array.isArray(hfPayload.hf_parquet_export_command), 'HF preflight should include a Parquet export command');
  assert(hfPayload.hf_parquet_export_command.includes(HF_PARQUET_EXPORTER), 'HF Parquet command should call the Parquet exporter');
  assert(hfPayload.hf_parquet_export_command.includes('--country'), 'HF Parquet command should include bounded country filtering');
  assert(!JSON.stringify(hfPayload).includes('present-for-contract-test'), 'HF preflight output must not echo token values');

  if (!existsSync(PORTAL_INIT_TARGET)) {
    try {
      writeFileSync(PORTAL_INIT_TARGET, portalInitExample);
      const examplePortalOutput = execFileSync(process.execPath, [
        'scripts/ops/fsq-sample-preflight.mjs',
        '--json',
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FSQ_OS_PLACES_SAMPLE: '',
          FSQ_PLACES_TOKEN: 'present-for-contract-test',
          HF_TOKEN: '',
          HUGGINGFACE_HUB_TOKEN: '',
        },
      });
      const examplePortalPayload = JSON.parse(examplePortalOutput);
      assert(examplePortalPayload.state === 'portal_setup_needed', 'Example-only Portal SQL must not unlock portal_export_ready');
      assert(examplePortalPayload.portal_init_sql === 'example_only', `Expected example_only Portal SQL status, got ${examplePortalPayload.portal_init_sql}`);
      assert(examplePortalPayload.portal_connection === 'not_checked', 'Example-only Portal SQL should not run connection validation');
      assert(examplePortalPayload.portal_init_sql_detail.includes('checked-in example'), 'Example-only Portal SQL should explain the invalid setup file');
      assert(examplePortalPayload.can_export_via_portal === false, 'Example-only Portal SQL should block Portal export');
      assert(examplePortalPayload.missing.some(item => item.includes('example_only')), 'Missing prerequisites should name the example-only Portal SQL state');
    } finally {
      unlinkSync(PORTAL_INIT_TARGET);
    }
  }

  const handoffDir = mkdtempSync(join(tmpdir(), 'apizza-fsq-handoff-'));
  try {
    const handoffPath = join(handoffDir, 'fsq-handoff.sh');
    const handoffOutput = execFileSync(process.execPath, [
      'scripts/ops/fsq-sample-preflight.mjs',
      '--output', noSampleOutput,
      '--write-handoff',
      '--handoff-output', handoffPath,
      '--json',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FSQ_OS_PLACES_SAMPLE: '',
        FSQ_PLACES_TOKEN: 'present-for-contract-test',
        HF_TOKEN: '',
        HUGGINGFACE_HUB_TOKEN: '',
      },
    });
    const handoffPayload = JSON.parse(handoffOutput);
    const handoff = readFileSync(handoffPath, 'utf8');
    assert(handoffPayload.handoff_written === handoffPath, 'Preflight should report the written handoff path');
    assert(handoff.includes('FSQ_PLACES_TOKEN is present, but Places Portal setup is incomplete.'), 'Handoff should explain incomplete Places Portal setup');
    assert(handoff.includes('PORTAL_INIT_SQL_EXAMPLE=scripts/ops/fsq-portal-init.example.sql'), 'Handoff should define the Portal init SQL example path');
    assert(handoff.includes('Use the checked-in setup checklist: ${PORTAL_INIT_SQL_EXAMPLE}'), 'Handoff should point operators to the setup checklist');
    assert(handoff.includes('Save the Portal DuckDB/Iceberg setup SQL to: ${PORTAL_INIT_SQL}'), 'Handoff should name the Portal SQL next step');
    assert(handoff.includes('Create the ignored Python DuckDB venv with:'), 'Handoff should include the Portal setup command label');
    assert(handoff.includes('python3 -m venv scripts/.fsq-venv'), 'Handoff should include the exact venv setup command');
    assert(handoff.includes('HF_TOKEN="${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}"'), 'Handoff should still support HF token fallback');
    assert(handoff.includes(HF_PARQUET_EXPORTER), 'Handoff should prefer the HF Parquet exporter when Python is available');
    assert(handoff.includes(PORTAL_EXPORTER), 'Handoff should include the Portal export command');
    assert(handoff.includes(`--input ${noSampleOutput}`), 'Handoff sample branch should run the adapter against the concrete configured output path');
    assert(!handoff.includes('<exported-fsq-sample.csv>'), 'Handoff must not contain the placeholder sample path');
    assert(!handoff.includes('present-for-contract-test'), 'Handoff must not persist token values');
  } finally {
    rmSync(handoffDir, { recursive: true, force: true });
  }

  assert(SERVER.includes('readFsqSampleReadiness'), 'admin server should expose FSQ sample readiness');
  assert(SERVER.includes('FSQ_OS_PLACES_SAMPLE'), 'FSQ readiness should check FSQ_OS_PLACES_SAMPLE');
  assert(SERVER.includes('FSQ_PLACES_TOKEN'), 'FSQ readiness should check FSQ_PLACES_TOKEN');
  assert(SERVER.includes('HUGGINGFACE_HUB_TOKEN'), 'FSQ readiness should check Hugging Face token fallback');
  assert(SERVER.includes('portal_setup_needed'), 'FSQ readiness should distinguish incomplete Places Portal setup from Hugging Face tokens');
  assert(SERVER.includes('portal_export_ready'), 'FSQ readiness should expose a Places Portal export-ready state');
  assert(SERVER.includes('portalExportCommand'), 'FSQ readiness should expose the Portal export command');
  assert(SERVER.includes('portalSetupCommand'), 'FSQ readiness should expose the Portal setup command');
  assert(SERVER.includes('portalSetupSteps'), 'FSQ readiness should expose the Portal setup checklist');
  assert(SERVER.includes('blocked_missing_sample_or_token'), 'FSQ readiness should report blocked state explicitly');
  assert(SERVER.includes('fsqSample'), 'source provenance payload should include FSQ sample readiness');
  assert(ADMIN_PANEL.includes('FSQ OS Places Sample'), 'admin panel should show FSQ sample readiness');
  assert(ADMIN_PANEL.includes('Places Portal export'), 'admin panel should show the Portal export command');
  assert(ADMIN_PANEL.includes('Places Portal setup checklist'), 'admin panel should show the Portal setup checklist');
  assert(ADMIN_PANEL.includes('Places Portal setup command'), 'admin panel should show the Portal setup command');
  assert(ADMIN_PANEL.includes('portal SQL:'), 'admin panel should show Portal init SQL readiness');
  assert(ADMIN_PANEL.includes('Real FSQ import remains sample-first.'), 'admin panel should keep FSQ sample-first boundary visible');
  assert(ADMIN_PANEL.includes('it does not download FSQ data or write source evidence'), 'admin panel should state FSQ readiness is read-only');

  console.log('# FSQ Sample Workflow Verification');
  console.log('');
  console.log(`fixture=${FIXTURE}`);
  console.log(`fixture_rows=${rows.length}`);
  console.log(`active_fixture_rows=${activeRows.length}`);
  console.log(`closed_fixture_rows=${closedRows.length}`);
  console.log(`preflight_state=${payload.state}`);
  console.log(`recommended_action=${payload.recommended_action}`);
  console.log('status=ok');
}

main();
