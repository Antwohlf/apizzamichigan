#!/usr/bin/env node
/**
 * Verify the curated APizza All the Places spider manifest.
 *
 * This is intentionally offline. The live ATP run can still change, so current
 * availability is checked by discover-atp-spiders --audit-manifest. This script
 * guards our local manifest contract: known good spiders are enabled, known gaps
 * are disabled, and the importer lists exactly import-enabled rows.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const MANIFEST_PATH = 'config/atp-pizza-spiders.json';
const IMPORTER = 'scripts/ops/import-atp-spiders.mjs';

const REQUIRED_ENABLED = [
  'little_caesars_us',
  'pizza_hut_us',
  'dominos_pizza_us',
  'papa_johns',
  'marcos',
  'papa_murphys',
  'mod_pizza',
  'california_pizza_kitchen',
];

const REQUIRED_REGIONAL_ENABLED = [
  'round_table_pizza',
  'simple_simons_pizza_us',
  'pizza_ranch_us',
  'vocelli_pizza_us',
  'sals_pizza_us',
  'flippin_pizza_us',
  'mountain_mikes_us',
  'bc_pizza',
  'larosas',
];

const REQUIRED_DISABLED_GAPS = [
  'hungry_howies',
  'jet',
  'blaze_pizza',
  'lou_malnatis_pizzeria_us',
  'godfathers_pizza',
  'old_chicago_us',
];

const DISABLED_GAP_STATUSES = [
  'missing_from_atp_stats',
  'false_positive_non_pizza',
  'empty_in_atp_stats',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadManifest() {
  return JSON.parse(readFileSync(resolve(process.cwd(), MANIFEST_PATH), 'utf8'));
}

function rowBySpider(manifest) {
  const map = new Map();
  for (const row of manifest.spiders || []) {
    assert(row.spider, 'Every manifest row must have a spider name.');
    assert(!map.has(row.spider), `Duplicate ATP spider manifest row: ${row.spider}`);
    map.set(row.spider, row);
  }
  return map;
}

function assertEnabled(map, spider, group = null) {
  const row = map.get(spider);
  assert(row, `Missing required ATP spider: ${spider}`);
  assert(row.import_enabled === true, `${row.spider} must be import_enabled.`);
  if (group) assert(row.group === group, `${row.spider} must be in group ${group}.`);
  assert(!['missing_from_atp_stats', 'false_positive_non_pizza'].includes(row.status), `${row.spider} has invalid enabled status: ${row.status}`);
}

function assertDisabledGap(map, spider) {
  const row = map.get(spider);
  assert(row, `Missing required disabled ATP gap row: ${spider}`);
  assert(row.group === 'gap', `${spider} must be in gap group.`);
  assert(row.import_enabled === false, `${spider} must remain disabled.`);
  assert(DISABLED_GAP_STATUSES.includes(row.status), `${spider} must document why it is disabled.`);
  assert(row.note || row.brand, `${spider} must explain the gap/false-positive reason.`);
}

function importerManifestList() {
  return execFileSync(process.execPath, [IMPORTER, '--list-manifest'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertImporterRejectsMissingManifest() {
  try {
    execFileSync(process.execPath, [IMPORTER, '--manifest', '/tmp/apizza-missing-atp-manifest.json', '--list-manifest'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = String(error.stderr || error.stdout || error.message || error);
    assert(message.includes('ATP spider manifest not found'), `Missing manifest error was not explicit: ${message}`);
    return;
  }
  throw new Error('Importer should reject a missing ATP spider manifest.');
}

function main() {
  const manifest = loadManifest();
  assert(manifest.entity === 'pizza', 'ATP manifest entity must be pizza.');
  assert(manifest.source === 'all_the_places', 'ATP manifest source must be all_the_places.');
  assert(Array.isArray(manifest.spiders) && manifest.spiders.length > 0, 'ATP manifest must contain spiders.');

  const map = rowBySpider(manifest);
  for (const spider of REQUIRED_ENABLED) assertEnabled(map, spider, 'original_chain');
  for (const spider of REQUIRED_REGIONAL_ENABLED) assertEnabled(map, spider, 'regional_chain');
  for (const spider of REQUIRED_DISABLED_GAPS) assertDisabledGap(map, spider);

  const enabledRows = [...map.values()].filter(row => row.import_enabled);
  const disabledRows = [...map.values()].filter(row => !row.import_enabled);
  assert(enabledRows.length >= REQUIRED_ENABLED.length + REQUIRED_REGIONAL_ENABLED.length, 'Enabled ATP spider count is unexpectedly low.');
  assert(disabledRows.length >= REQUIRED_DISABLED_GAPS.length, 'Disabled ATP gap count is unexpectedly low.');

  const listOutput = importerManifestList();
  assert(listOutput.includes('| original_chain |'), 'Importer manifest listing must include original_chain group.');
  assert(listOutput.includes('| regional_chain |'), 'Importer manifest listing must include regional_chain group.');
  assert(listOutput.includes('| gap | 0 |'), 'Importer manifest listing must show gap group with zero import-enabled rows.');
  for (const spider of REQUIRED_DISABLED_GAPS) {
    assert(listOutput.includes(`| ${spider} | gap |`), `Importer manifest listing must include disabled gap ${spider}.`);
  }
  assertImporterRejectsMissingManifest();

  console.log('# ATP Spider Manifest Verification');
  console.log('');
  console.log(`manifest=${MANIFEST_PATH}`);
  console.log(`enabled_spiders=${enabledRows.length}`);
  console.log(`disabled_spiders=${disabledRows.length}`);
  console.log(`required_original_chain=${REQUIRED_ENABLED.join(',')}`);
  console.log(`required_regional_chain=${REQUIRED_REGIONAL_ENABLED.join(',')}`);
  console.log(`required_disabled_gaps=${REQUIRED_DISABLED_GAPS.join(',')}`);
  console.log('status=ok');
}

main();
