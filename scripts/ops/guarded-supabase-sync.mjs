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
    ids: [],
    hours: 6,
    batch: 50,
    maxBatches: 1,
    checkpoint: 'scripts/.supabase-sync-checkpoint.json',
    sample: 10,
    insertMissingReviewedNew: false,
    apply: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hours') out.hours = parseFloat(argv[++i]);
    else if (arg === '--ids') out.ids = parseIds(argv[++i]);
    else if (arg === '--batch') out.batch = parseInt(argv[++i], 10);
    else if (arg === '--max-batches') out.maxBatches = parseInt(argv[++i], 10);
    else if (arg === '--checkpoint') out.checkpoint = argv[++i];
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10);
    else if (arg === '--insert-missing-reviewed-new') out.insertMissingReviewedNew = true;
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/guarded-supabase-sync.mjs [options]

Options:
  --hours <n>        Recent enrichment window (default 6)
  --ids <a,b,c>      Sync only these local pizza_places ids
  --batch <n>        Batch size (default 50)
  --max-batches <n>  Maximum write batches (default 1)
  --checkpoint <p>   Checkpoint path (default scripts/.supabase-sync-checkpoint.json)
  --sample <n>       Readiness sample size (default 10)
  --insert-missing-reviewed-new
                      With --ids, insert missing rows only when local
                      place_sources proves reviewed_new_import
  --apply            Perform the bounded write after all gates pass
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(out.hours) || out.hours <= 0) throw new Error('Invalid --hours');
  if (out.ids.length && out.checkpoint !== 'scripts/.supabase-sync-checkpoint.json') {
    throw new Error('--ids cannot be combined with --checkpoint');
  }
  if (!Number.isFinite(out.batch) || out.batch <= 0) throw new Error('Invalid --batch');
  if (!Number.isFinite(out.maxBatches) || out.maxBatches <= 0) throw new Error('Invalid --max-batches');
  if (!Number.isFinite(out.sample) || out.sample <= 0) throw new Error('Invalid --sample');
  return out;
}

function parseIds(value) {
  const ids = String(value || '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) throw new Error('Invalid --ids');
  return [...new Set(ids)];
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
    '--batch', String(options.batch),
    '--max-batches', String(options.maxBatches),
  ];
  if (options.ids.length) {
    args.push('--ids', options.ids.join(','));
  } else {
    args.push(
      '--changed-since-hours', String(options.hours),
      '--only-classified',
      '--checkpoint', options.checkpoint,
    );
  }
  if (dryRun) args.push('--dry-run');
  if (options.insertMissingReviewedNew) args.push('--insert-missing-reviewed-new');
  return args;
}

function qaArgs(options) {
  return [
    'scripts/ops/classification-qa-report.mjs',
    ...(options.ids.length
      ? ['--ids', options.ids.join(',')]
      : ['--hours', String(options.hours), '--limit', '500']),
    '--sample', String(options.sample),
    '--json',
  ];
}

function qaHardIssueIsRepairable(qa) {
  const repairable = qa.flags?.styleWithoutConfidence?.length || 0;
  return repairable > 0 && Object.entries(qa.flags || {}).every(([name, rows]) => {
    if (name === 'styleWithoutConfidence') return true;
    return rows.length === 0 || ![
      'invalidValues',
      'confidenceWithoutStyle',
      'chainMismatches'
    ].includes(name);
  });
}

function runQaWithRepair(options) {
  let qa = run(NODE, qaArgs(options), { json: true });
  for (let attempt = 0; attempt < 3 && qa.state === 'FAIL' && !options.ids.length && qaHardIssueIsRepairable(qa); attempt++) {
    console.log(`QA found ${qa.flags.styleWithoutConfidence.length} missing-confidence rows during concurrent processing; repairing and retrying.`);
    const repair = run(NODE, [
      'scripts/ops/repair-missing-classification-confidence.mjs',
      '--hours', String(options.hours),
      '--limit', '5000',
      '--apply',
      '--json',
    ], { json: true });
    console.log(`confidence repair: updated=${repair.rows_updated}`);
    qa = run(NODE, qaArgs(options), { json: true });
  }
  return qa;
}

async function main() {
  const options = parseArgs(process.argv);
  const startedAt = new Date().toISOString();

  console.log('# Guarded Supabase Sync');
  console.log('');
  console.log(`Started: ${startedAt}`);
  console.log(`Mode: ${options.apply ? 'apply' : 'dry-run only'}`);
  console.log(`Scope: ${options.ids.length ? `ids=${options.ids.join(',')}` : `last ${options.hours}h classified checkpoint window`}`);
  console.log(`Batch: ${options.batch}, max_batches=${options.maxBatches}`);
  console.log(`Checkpoint: ${options.ids.length ? 'none (id-scoped)' : options.checkpoint}`);
  console.log(`Insert missing reviewed-new: ${options.insertMissingReviewedNew ? 'yes' : 'no'}`);

  step('Health Gate');
  const health = run(NODE, ['scripts/ops/classifier-health-report.mjs', '--json'], { json: true });
  console.log(`state=${health.health.state}, completed_last_window=${health.queue?.recent?.completed ?? 'n/a'}, failed_last_window=${health.queue?.recent?.failed ?? 'n/a'}`);
  // The iMac cannot inspect the laptop-owned tunnel launchd service. A healthy
  // tunnel endpoint is sufficient for sync; only actionable health issues
  // should block the write gate.
  if (health.health.issues?.length) {
    throw new Error(`health gate failed: ${JSON.stringify(health.health.issues)}`);
  }
  if (health.health.state !== 'OK') {
    console.log(`health warnings do not block sync: ${JSON.stringify(health.health.warnings || [])}`);
  }

  step('QA Gate');
  const qa = runQaWithRepair(options);
  console.log(`state=${qa.state}, hard_issues=${qa.issueCount}, soft_warnings=${qa.warningCount}, inspected=${qa.totals.inspected}`);
  // Warnings are reported for review but do not block safe sync; hard issues
  // remain represented by FAIL and still stop the write.
  assertState('classification QA', qa.state, ['OK', 'WARN']);

  step('Readiness Gate');
  const readiness = run(NODE, [
    'scripts/ops/supabase-sync-readiness-report.mjs',
    '--batch', String(options.batch),
    '--sample', String(options.sample),
    '--json',
    ...(options.ids.length
      ? ['--ids', options.ids.join(',')]
      : ['--changed-since-hours', String(options.hours), '--only-classified', '--checkpoint', options.checkpoint]),
  ], { json: true });
  console.log(`state=${readiness.state}, would_update=${readiness.totals.wouldUpdate}, missing=${readiness.totals.missingSupabaseRows}, protected_conflicts=${readiness.totals.protectedFieldConflicts}`);
  const allowsReviewedNewInserts = options.insertMissingReviewedNew;
  assertState('readiness', readiness.state, allowsReviewedNewInserts ? ['OK', 'WARN'] : ['OK']);
  if (readiness.totals.missingSupabaseRows > 0 && !allowsReviewedNewInserts) {
    throw new Error('readiness gate failed: missing Supabase rows');
  }
  if (readiness.totals.protectedFieldConflicts > 0) {
    console.log(`Protected field conflicts will be skipped without overwrite: ${readiness.totals.protectedFieldConflicts}`);
  }
  if (readiness.totals.wouldUpdate === 0 && readiness.totals.missingSupabaseRows === 0) {
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
  if (postHealth.health.issues?.length) {
    throw new Error(`post health gate failed: ${JSON.stringify(postHealth.health.issues)}`);
  }
  if (postHealth.health.state !== 'OK') {
    console.log(`post health warnings do not block sync: ${JSON.stringify(postHealth.health.warnings || [])}`);
  }

  step('Post QA Gate');
  const postQa = runQaWithRepair(options);
  console.log(`state=${postQa.state}, hard_issues=${postQa.issueCount}, soft_warnings=${postQa.warningCount}, inspected=${postQa.totals.inspected}`);
  assertState('post classification QA', postQa.state, ['OK', 'WARN']);

  console.log('');
  console.log(`Completed: ${new Date().toISOString()}`);
}

main().catch(error => {
  console.error(`guarded-supabase-sync failed: ${error.message || error}`);
  process.exit(1);
});
