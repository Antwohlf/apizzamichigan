#!/usr/bin/env node
/**
 * launchd-safe wrapper for guarded Supabase sync.
 *
 * The underlying guarded runner owns the real safety checks. This wrapper only
 * prevents overlapping scheduled runs and supplies conservative defaults.
 */

import { mkdirSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';

const LOCK_DIR = process.env.APIZZA_SYNC_LOCK_DIR || '/tmp/apizzamichigan/supabase-sync.lock';

function parseArgs(argv) {
  const out = {
    hours: process.env.APIZZA_SYNC_HOURS || '168',
    batch: process.env.APIZZA_SYNC_BATCH || '100',
    maxBatches: process.env.APIZZA_SYNC_MAX_BATCHES || '1',
    checkpoint: process.env.APIZZA_SYNC_CHECKPOINT || 'scripts/.supabase-sync-checkpoint.json',
    sample: process.env.APIZZA_SYNC_SAMPLE || '10',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hours') out.hours = argv[++i];
    else if (arg === '--batch') out.batch = argv[++i];
    else if (arg === '--max-batches') out.maxBatches = argv[++i];
    else if (arg === '--checkpoint') out.checkpoint = argv[++i];
    else if (arg === '--sample') out.sample = argv[++i];
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/auto-guarded-supabase-sync.mjs [options]

Options mirror guarded-supabase-sync.mjs. This wrapper always applies the
bounded write after the guarded preflight checks pass.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
}

function acquireLock() {
  try {
    mkdirSync(LOCK_DIR, { recursive: false });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

const options = parseArgs(process.argv);

if (!acquireLock()) {
  console.log(`[skip] guarded Supabase sync already running; lock=${LOCK_DIR}`);
  process.exit(0);
}

try {
  const result = spawnSync(process.execPath, [
    'scripts/ops/guarded-supabase-sync.mjs',
    '--hours', options.hours,
    '--batch', options.batch,
    '--max-batches', options.maxBatches,
    '--checkpoint', options.checkpoint,
    '--sample', options.sample,
    '--apply',
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} finally {
  releaseLock();
}
