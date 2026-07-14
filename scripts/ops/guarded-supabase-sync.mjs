#!/usr/bin/env node
/**
 * Guarded local Postgres -> Supabase sync runner.
 *
 * Runs health, QA, readiness, dry-run, bounded write, and post-checks in
 * sequence. Write sync requires --apply; without it the script stops after
 * the dry-run.
 */

import { execFileSync } from 'child_process';

const NODE = process.execPath;

function parseArgs(argv) {
  const out = {
    hours: 6,
    batch: 50,
    maxBatches: 1,
    checkpoint: 'scripts/.supabase-sync-checkpoint.json',
    sample: 10,
    apply: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hours') out.hours = parseFloat(argv[++i]);
    else if (arg === '--batch') out.batch = parseInt(argv[++i], 10);
    else if (arg === '--max-batches') out.maxBatches = parseInt(argv[++i], 10);
    else if (arg === '--checkpoint') out.checkpoint = argv[++i];
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10);
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/guarded-supabase-sync.mjs [options]

Options:
  --hours <n>        Recent enrichment window (default 6)
  --batch <n>        Batch size (default 50)
  --max-batches <n>  Maximum write batches (default 1)
  --checkpoint <p>   Checkpoint path (default scripts/.supabase-sync-checkpoint.json)
  --sample <n>       Readiness sample size (default 10)
  --apply            Perform the bounded write after all gates pass
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(out.hours) || out.hours <= 0) throw new Error('Invalid --hours');
  if (!Number.isFinite(out.batch) || out.batch <= 0) throw new Error('Invalid --batch');
  if (!Number.isFinite(out.maxBatches) || out.maxBatches <= 0) throw new Error('Invalid --max-batches');
  if (!Number.isFinite(out.sample) || out.sample <= 0) throw new Error('Invalid --sample');
  return out;
}

function run(command, args, { json = false } = {}) {
  const stdout = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  }).trim();

  if (!json) return stdout;
  return JSON.parse(stdout);
}

function step(title) {
  console.log('');
  console.log(`## ${title}`);
}

function assertState(label, actual, allowed = ['OK']) {
  if (!allowed.includes(actual)) {
    throw new Error(`${label} gate failed: ${actual}`);
  }
}

function syncArgs(options, { dryRun = false } = {}) {
  const args = [
    'scripts/sync-local-to-supabase.mjs',
    '--changed-since-hours', String(options.hours),
    '--only-classified',
    '--checkpoint', options.checkpoint,
    '--batch', String(options.batch),
    '--max-batches', String(options.maxBatches),
  ];
  if (dryRun) args.push('--dry-run');
  return args;
}

async function main() {
  const options = parseArgs(process.argv);
  const startedAt = new Date().toISOString();

  console.log('# Guarded Supabase Sync');
  console.log('');
  console.log(`Started: ${startedAt}`);
  console.log(`Mode: ${options.apply ? 'apply' : 'dry-run only'}`);
  console.log(`Window: last ${options.hours}h`);
  console.log(`Batch: ${options.batch}, max_batches=${options.maxBatches}`);
  console.log(`Checkpoint: ${options.checkpoint}`);

  step('Health Gate');
  const health = run(NODE, ['scripts/ops/classifier-health-report.mjs', '--json'], { json: true });
  console.log(`state=${health.health.state}, completed_last_window=${health.queue?.recent?.completed ?? 'n/a'}, failed_last_window=${health.queue?.recent?.failed ?? 'n/a'}`);
  assertState('health', health.health.state);

  step('QA Gate');
  const qa = run(NODE, [
    'scripts/ops/classification-qa-report.mjs',
    '--hours', String(options.hours),
    '--limit', '500',
    '--sample', String(options.sample),
    '--json',
  ], { json: true });
  console.log(`state=${qa.state}, hard_issues=${qa.issueCount}, soft_warnings=${qa.warningCount}, inspected=${qa.totals.inspected}`);
  assertState('classification QA', qa.state);

  step('Readiness Gate');
  const readiness = run(NODE, [
    'scripts/ops/supabase-sync-readiness-report.mjs',
    '--changed-since-hours', String(options.hours),
    '--only-classified',
    '--checkpoint', options.checkpoint,
    '--batch', String(options.batch),
    '--sample', String(options.sample),
    '--json',
  ], { json: true });
  console.log(`state=${readiness.state}, would_update=${readiness.totals.wouldUpdate}, missing=${readiness.totals.missingSupabaseRows}, protected_conflicts=${readiness.totals.protectedFieldConflicts}`);
  assertState('readiness', readiness.state);
  if (readiness.totals.missingSupabaseRows > 0) throw new Error('readiness gate failed: missing Supabase rows');
  if (readiness.totals.protectedFieldConflicts > 0) throw new Error('readiness gate failed: protected field conflicts');
  if (readiness.totals.wouldUpdate === 0) {
    console.log('No rows to update; stopping cleanly.');
    return;
  }

  step('Dry Run');
  const dryRunOutput = run(NODE, syncArgs(options, { dryRun: true }));
  console.log(dryRunOutput);

  if (!options.apply) {
    console.log('');
    console.log('Dry-run mode complete. Re-run with --apply to write.');
    return;
  }

  step('Write');
  const writeOutput = run(NODE, syncArgs(options));
  console.log(writeOutput);

  step('Post Health Gate');
  const postHealth = run(NODE, ['scripts/ops/classifier-health-report.mjs', '--json'], { json: true });
  console.log(`state=${postHealth.health.state}, completed_last_window=${postHealth.queue?.recent?.completed ?? 'n/a'}, failed_last_window=${postHealth.queue?.recent?.failed ?? 'n/a'}`);
  assertState('post health', postHealth.health.state);

  step('Post QA Gate');
  const postQa = run(NODE, [
    'scripts/ops/classification-qa-report.mjs',
    '--hours', String(options.hours),
    '--limit', '500',
    '--sample', String(options.sample),
    '--json',
  ], { json: true });
  console.log(`state=${postQa.state}, hard_issues=${postQa.issueCount}, soft_warnings=${postQa.warningCount}, inspected=${postQa.totals.inspected}`);
  assertState('post classification QA', postQa.state);

  console.log('');
  console.log(`Completed: ${new Date().toISOString()}`);
}

main().catch(error => {
  console.error(`guarded-supabase-sync failed: ${error.message || error}`);
  process.exit(1);
});
