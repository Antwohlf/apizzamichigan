#!/usr/bin/env node
/**
 * Verify the source-input adapter contract.
 *
 * This is intentionally read-only. It checks that the generic source input
 * adapter exposes the expected source keys, that each key has the required
 * normalization metadata, and that the docs name the same adapters.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { SOURCE_CONFIGS } from './source-input-sample-report.mjs';

const EXPECTED_SOURCE_KEYS = [
  'osm',
  'fsq_os_places',
  'all_the_places',
  'overture_places',
  'wikidata',
  'government_open_data',
  'denue',
  'official_website',
];

const REQUIRED_ARRAY_FIELDS = [
  'sourceId',
  'lat',
  'lng',
  'category',
  'website',
  'phone',
];

const DOC_PATHS = [
  'docs/SOURCE_INPUTS.md',
  'docs/SOURCE_PROVENANCE_SCHEMA.md',
  'docs/DATA_SOURCES.md',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertSameSet(actual, expected, label) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  assert(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} mismatch. expected=${expectedSorted.join(',')} actual=${actualSorted.join(',')}`,
  );
}

function main() {
  const configuredKeys = Object.keys(SOURCE_CONFIGS);
  assertSameSet(configuredKeys, EXPECTED_SOURCE_KEYS, 'source adapter keys');

  for (const key of EXPECTED_SOURCE_KEYS) {
    const config = SOURCE_CONFIGS[key];
    assert(config.label, `${key} missing label`);
    assert(config.license, `${key} missing license`);
    assert(config.attribution, `${key} missing attribution`);
    for (const field of REQUIRED_ARRAY_FIELDS) {
      assert(Array.isArray(config[field]) && config[field].length, `${key} missing ${field} mapping`);
    }
  }

  const listOutput = execFileSync(process.execPath, ['scripts/ops/source-input-sample-report.mjs', '--list-sources'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const listedKeys = listOutput
    .trim()
    .split('\n')
    .map(line => line.split('\t')[0])
    .filter(Boolean);
  assertSameSet(listedKeys, EXPECTED_SOURCE_KEYS, '--list-sources output');

  for (const docPath of DOC_PATHS) {
    const text = readFileSync(docPath, 'utf8');
    for (const key of EXPECTED_SOURCE_KEYS) {
      assert(text.includes(key), `${docPath} does not mention ${key}`);
    }
  }

  console.log('# Source Input Adapter Verification');
  console.log('');
  console.log(`source_keys=${EXPECTED_SOURCE_KEYS.join(',')}`);
  console.log(`docs_checked=${DOC_PATHS.join(',')}`);
  console.log('status=ok');
}

main();
