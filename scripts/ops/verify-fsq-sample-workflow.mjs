#!/usr/bin/env node
/**
 * Verify the FSQ sample-first workflow without requiring gated credentials.
 *
 * This does not contact Hugging Face or write to Postgres. It proves the
 * checked-in fixture is accepted as a local sample and that preflight produces
 * the adapter command operators should run for a real FSQ slice.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

const FIXTURE = 'data/source-samples/fixtures/fsq-os-places-pizza-fixture.json';
const SERVER = readFileSync('server/index.js', 'utf8');
const ADMIN_PANEL = readFileSync('src/admin/AdminSourceProvenancePanel.js', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  assert(existsSync(FIXTURE), `Missing FSQ fixture: ${FIXTURE}`);

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

  assert(SERVER.includes('readFsqSampleReadiness'), 'admin server should expose FSQ sample readiness');
  assert(SERVER.includes('FSQ_OS_PLACES_SAMPLE'), 'FSQ readiness should check FSQ_OS_PLACES_SAMPLE');
  assert(SERVER.includes('FSQ_PLACES_TOKEN'), 'FSQ readiness should check FSQ_PLACES_TOKEN');
  assert(SERVER.includes('HUGGINGFACE_HUB_TOKEN'), 'FSQ readiness should check Hugging Face token fallback');
  assert(SERVER.includes('blocked_missing_sample_or_token'), 'FSQ readiness should report blocked state explicitly');
  assert(SERVER.includes('fsqSample'), 'source provenance payload should include FSQ sample readiness');
  assert(ADMIN_PANEL.includes('FSQ OS Places Sample'), 'admin panel should show FSQ sample readiness');
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
