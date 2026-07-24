#!/usr/bin/env node
/**
 * Read-only verification for a local recovery bundle.
 *
 * Checks manifest hashes, the SQLite integrity check, and the custom-format
 * Postgres dump header without connecting to Supabase or restoring data.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

function parseArgs(argv) {
  const options = {
    run: null,
    outputDir: process.env.APIZZA_BACKUP_DIR || resolve('backups'),
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') options.run = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') {
      console.log('Usage: node scripts/ops/verify-local-backup.mjs [--run <directory>] [--output-dir <directory>] [--json]');
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function latestRun(outputDir) {
  const runs = readdirSync(outputDir)
    .map(name => join(outputDir, name))
    .filter(path => statSync(path).isDirectory() && existsSync(join(path, 'manifest.json')))
    .sort();
  return runs.at(-1) || null;
}

async function sha256(path) {
  const hash = createHash('sha256');
  return new Promise((resolveHash, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function verifyQueue(path) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('integrity_check', { simple: true });
    return result === 'ok' ? { status: 'ok', integrity: result } : { status: 'failed', integrity: result };
  } finally {
    database.close();
  }
}

function verifyPostgresDump(path) {
  const header = readFileSync(path).subarray(0, 5).toString('ascii');
  return header === 'PGDMP'
    ? { status: 'ok', format: 'custom', header }
    : { status: 'failed', format: 'unknown', header };
}

async function main() {
  const options = parseArgs(process.argv);
  const runDir = resolve(options.run || latestRun(resolve(options.outputDir)) || '');
  if (!runDir || !existsSync(join(runDir, 'manifest.json'))) {
    throw new Error(`No backup manifest found in ${runDir || options.outputDir}`);
  }

  const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'));
  const files = [];
  let failed = false;
  for (const entry of manifest.files || []) {
    const path = resolve(runDir, entry.label === 'local-postgres' ? 'pizza_enrichment.dump' : 'job-queue.db');
    const exists = existsSync(path);
    const bytes = exists ? statSync(path).size : null;
    const digest = exists ? await sha256(path) : null;
    const result = {
      label: entry.label,
      exists,
      bytes,
      sha256: digest,
      hash_matches: exists && digest === entry.sha256 && bytes === entry.bytes,
    };
    if (entry.label === 'local-postgres' && exists) result.content = verifyPostgresDump(path);
    if (entry.label === 'sqlite-queue' && exists) result.content = verifyQueue(path);
    result.ok = result.hash_matches && result.content?.status === 'ok';
    failed ||= !result.ok;
    files.push(result);
  }

  const result = {
    status: failed ? 'failed' : 'ok',
    run: runDir,
    generated_at: manifest.generated_at || null,
    host: manifest.host || null,
    files,
  };
  console.log(options.json ? JSON.stringify(result, null, 2) : [
    `# Local Backup Verification`,
    `status=${result.status}`,
    `run=${result.run}`,
    `host=${result.host || 'unknown'}`,
    ...files.map(file => `${file.label}: ${file.ok ? 'ok' : 'failed'}`),
  ].join('\n'));
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(`backup verification failed: ${error.message}`);
  process.exitCode = 1;
});
