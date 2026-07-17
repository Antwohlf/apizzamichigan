#!/usr/bin/env node
/**
 * Verify the reviewed-new source backlog report with an offline fixture.
 */

import assert from 'assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const fixtureRows = {
  reviewRows: [
    {
      entity_type: 'pizza',
      source: 'all_the_places',
      source_id: 'strong-1',
      source_name: 'Strong Pizza',
      report_file: 'strong_pizza-review.json',
      review_kind: 'likely_new',
      status: 'pending',
      nearest_distance_m: 900,
      source_data: {
        name: 'Strong Pizza',
        address: '1 Main St',
        website: 'https://strong.example',
        phone: '+15555550100',
        lat: 42.1,
        lng: -83.1,
      },
    },
    {
      entity_type: 'pizza',
      source: 'all_the_places',
      source_id: 'nearby-1',
      source_name: 'Nearby Pizza',
      report_file: 'nearby_pizza-review.json',
      review_kind: 'likely_new',
      status: 'pending',
      nearest_distance_m: 25,
      source_data: {
        name: 'Nearby Pizza',
        address: '2 Main St',
        website: 'https://nearby.example',
        phone: '+15555550101',
        latitude: 42.2,
        longitude: -83.2,
      },
    },
    {
      entity_type: 'pizza',
      source: 'all_the_places',
      source_id: 'weak-1',
      source_name: 'Weak Pizza',
      report_file: 'weak_pizza-review.json',
      review_kind: 'likely_new',
      status: 'pending',
      nearest_distance_m: 800,
      source_data: {
        name: 'Weak Pizza',
        address: '3 Main St',
        lat: 42.3,
        lng: -83.3,
      },
    },
    {
      entity_type: 'pizza',
      source: 'all_the_places',
      source_id: 'done-1',
      source_name: 'Done Pizza',
      report_file: 'strong_pizza-review.json',
      review_kind: 'likely_new',
      status: 'linked',
      nearest_distance_m: 800,
      source_data: {
        name: 'Done Pizza',
        address: '4 Main St',
        website: 'https://done.example',
        phone: '+15555550102',
        lat: 42.4,
        lng: -83.4,
      },
    },
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'apizza-reviewed-new-backlog-'));
try {
  const fixturePath = join(dir, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify(fixtureRows), 'utf8');

  const result = spawnSync(process.execPath, [
    'scripts/ops/reviewed-new-source-backlog-report.mjs',
    '--db-state-fixture', fixturePath,
    '--json',
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.totals.pending, 3);
  assert.equal(payload.totals.linked, 1);
  assert.equal(payload.totals.strong_ready_pending, 1);
  assert.equal(payload.totals.nearby_pending, 1);
  assert.equal(payload.suggested_next.length, 1);
  assert.equal(payload.suggested_next[0].report_file, 'strong_pizza-review.json');
  assert.match(payload.suggested_next[0].dry_run_command, /accept-likely-new-source-candidates\.mjs/);

  console.log('# Reviewed-New Backlog Report Verification');
  console.log('');
  console.log('strong_ready_pending=1');
  console.log('nearby_pending=1');
  console.log('status=ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
