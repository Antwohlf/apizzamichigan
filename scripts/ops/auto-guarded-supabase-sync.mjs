#!/usr/bin/env node
/**
 * launchd-safe wrapper for guarded Supabase sync.
 *
 * The underlying guarded runner owns the real safety checks. This wrapper only
 * prevents overlapping scheduled runs and supplies conservative defaults.
 */

import { mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';

const LOCK_DIR = process.env.APIZZA_SYNC_LOCK_DIR || '/tmp/apizzamichigan/supabase-sync.lock';
const LOCK_MAX_AGE_MS = parseInt(process.env.APIZZA_SYNC_LOCK_MAX_AGE_MS || String(25 * 60 * 1000), 10);

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

function lockAgeMs() {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function acquireLock() {
  try {
    mkdirSync(LOCK_DIR, { recursive: false });
    writeFileSync(`${LOCK_DIR}/owner.json`, JSON.stringify({
      pid: process.pid,
      started_at: new Date().toISOString(),
    }, null, 2));
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const age = lockAgeMs();
      if (age !== null && Number.isFinite(LOCK_MAX_AGE_MS) && age > LOCK_MAX_AGE_MS) {
        console.log(`[recover] removing stale guarded Supabase sync lock; lock=${LOCK_DIR} age_ms=${Math.round(age)}`);
        releaseLock();
        return acquireLock();
      }
      return false;
    }
    throw error;
  }
}

function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

const options = parseArgs(process.argv);

if (!acquireLock()) {
  const age = lockAgeMs();
  console.log(`[skip] guarded Supabase sync already running; lock=${LOCK_DIR} age_ms=${age === null ? 'unknown' : Math.round(age)}`);
  process.exit(0);
}

let exitCode = 1;
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
  exitCode = result.status ?? 1;
} finally {
  releaseLock();
}

process.exit(exitCode);
