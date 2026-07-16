#!/usr/bin/env node
/**
 * Verify ATP coverage report batch-planning behavior without requiring
 * a reachable local Postgres instance.
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runReport(fixture, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'apizza-atp-plan-'));
  const fixturePath = join(dir, 'db-state.json');
  const reviewDir = join(dir, 'empty-source-review');
  mkdirSync(reviewDir);
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
  try {
    const output = execFileSync(process.execPath, [
      'scripts/ops/atp-batch-coverage-report.mjs',
      '--db-state-fixture',
      fixturePath,
      '--review-dir',
      reviewDir,
      '--json',
      ...extraArgs,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const cleanPlan = runReport({
    sourceRows: [
      { spider: 'little_caesars_us', source_rows: 10, linked_places: 10 },
    ],
    reviewRows: [],
  }, ['--max-spiders', '3']);

  assert(cleanPlan.next_batch.blocked_by_review === false, 'clean plan should not be review-blocked');
  assert(cleanPlan.next_batch.selected_spiders.length === 3, 'clean plan should select max-spiders candidates');
  assert(cleanPlan.next_batch.selected_spiders.join(',') === 'pizza_hut_us,dominos_pizza_us,papa_johns', 'clean plan should preserve manifest order within original-chain candidates');
  assert(cleanPlan.next_batch.preflight_command.includes('--preflight-only'), 'clean plan must include a preflight command');
  assert(cleanPlan.next_batch.dry_run_command.includes('--import-review-queue'), 'clean plan must include review queue handoff');
  assert(!cleanPlan.next_batch.dry_run_command.includes('--apply'), 'planner dry-run command must not apply source evidence');

  const blockedPlan = runReport({
    sourceRows: [
      { spider: 'little_caesars_us', source_rows: 10, linked_places: 10 },
    ],
    reviewRows: [
      {
        spider: 'pizza_hut_us',
        review_kind: 'ambiguous',
        status: 'pending',
        rows: 17,
      },
      {
        spider: 'dominos_pizza_us',
        review_kind: 'likely_new',
        status: 'pending',
        rows: 130,
      },
    ],
  }, ['--max-spiders', '2']);

  assert(blockedPlan.next_batch.blocked_by_review === true, 'pending review work should block source expansion guidance');
  assert(blockedPlan.next_batch.review_work_rows === 2, 'blocked plan should count pending review rows');
  assert(blockedPlan.next_batch.review_work_preview[0].spider === 'pizza_hut_us', 'ambiguous review work should sort ahead of likely-new review');
  assert(blockedPlan.rows.find(row => row.spider === 'pizza_hut_us').next_action === 'review_ambiguous_links', 'ambiguous row should recommend review');
  assert(blockedPlan.rows.find(row => row.spider === 'dominos_pizza_us').next_action === 'review_likely_new_candidates', 'likely-new row should recommend review');

  console.log('# ATP Batch Planning Verification');
  console.log('');
  console.log(`clean_selected=${cleanPlan.next_batch.selected_spiders.join(',')}`);
  console.log(`blocked_review_rows=${blockedPlan.next_batch.review_work_rows}`);
  console.log('status=ok');
}

main();
