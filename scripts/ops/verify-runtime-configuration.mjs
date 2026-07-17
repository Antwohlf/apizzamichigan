#!/usr/bin/env node
/**
 * Read-only deployment and runtime configuration contract check.
 *
 * This validates checked-in templates and entrypoints only. It never reads or
 * prints .env values and never contacts launchd, Postgres, Ollama, or Supabase.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LAUNCHD_DIR = join(ROOT, 'infra/local/launchd');
const REQUIRED_SCRIPTS = [
  'scripts/ops/classifier-health-report.mjs',
  'scripts/ops/pipeline-alert-report.mjs',
  'scripts/ops/auto-guarded-supabase-sync.mjs',
  'scripts/ops/run-source-pipeline.mjs',
  'scripts/ops/reconcile-classifier-queue.mjs',
  'scripts/ops/verify-canonical-contract.mjs',
  'scripts/enrichment/agents/llm-classifier.mjs',
  'scripts/enrichment/agents/web-scraper.mjs',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function main() {
  assert(existsSync(join(ROOT, 'package.json')), 'package.json is missing');
  const packageJson = JSON.parse(read('package.json'));
  for (const script of ['build', 'typecheck', 'start:server']) {
    assert(typeof packageJson.scripts?.[script] === 'string', `package.json is missing ${script}`);
  }

  for (const path of REQUIRED_SCRIPTS) {
    assert(existsSync(join(ROOT, path)), `required runtime entrypoint is missing: ${path}`);
  }

  const templates = readdirSync(LAUNCHD_DIR)
    .filter(name => name.endsWith('.plist.template'))
    .sort();
  assert(templates.length >= 5, `expected launchd templates, found ${templates.length}`);

  for (const name of templates) {
    const text = readFileSync(join(LAUNCHD_DIR, name), 'utf8');
    assert(text.includes('<key>Label</key>'), `${name} is missing Label`);
    assert(text.includes('<key>ProgramArguments</key>'), `${name} is missing ProgramArguments`);
    assert(text.includes('<key>RunAtLoad</key>'), `${name} is missing RunAtLoad`);
    assert(text.includes('<key>KeepAlive</key>') || text.includes('<key>StartInterval</key>'), `${name} needs KeepAlive or StartInterval`);
    assert(!/(FSQ_PLACES_TOKEN|HF_TOKEN|SUPABASE_SERVICE_ROLE|PGPASSWORD)\s*=/.test(text), `${name} contains a credential assignment`);
  }

  const gitignore = read('.gitignore');
  assert(gitignore.split('\n').some(line => line.trim() === '.env'), '.gitignore must protect .env');
  assert(gitignore.split('\n').some(line => line.trim().startsWith('.env.') || line.trim() === '.env.*'), '.gitignore must protect local env variants');
  for (const ignored of ['scripts/.job-queue.db', 'scripts/.fsq-portal-init.sql']) {
    assert(gitignore.split('\n').some(line => line.trim() === ignored || line.trim() === `/${ignored}`), `.gitignore must protect ${ignored}`);
  }

  console.log('# Runtime Configuration Verification');
  console.log('');
  console.log(`launchd_templates=${templates.length}`);
  console.log(`required_entrypoints=${REQUIRED_SCRIPTS.length}`);
  console.log('secret_values_checked=none_read_or_printed');
  console.log('status=ok');
}

main();
