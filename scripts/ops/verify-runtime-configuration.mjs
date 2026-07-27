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
  'scripts/ops/write-pipeline-status.mjs',
  'scripts/ops/auto-guarded-supabase-sync.mjs',
  'scripts/ops/run-source-pipeline.mjs',
  'scripts/ops/source-activation-report.mjs',
  'scripts/ops/reconcile-classifier-queue.mjs',
  'scripts/ops/feed-classifier-retries.mjs',
  'scripts/ops/verify-canonical-contract.mjs',
  'scripts/enrichment/agents/llm-classifier.mjs',
  'scripts/enrichment/agents/web-scraper.mjs',
  'scripts/enrichment/slowlane/menu-parse-worker.mjs',
  'scripts/ops/process-reviewed-new-batch.mjs',
  'scripts/ops/create-local-backup.mjs',
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
  assert(templates.length >= 7, `expected launchd templates, found ${templates.length}`);

  for (const name of templates) {
    const text = readFileSync(join(LAUNCHD_DIR, name), 'utf8');
    assert(text.includes('<key>Label</key>'), `${name} is missing Label`);
    assert(text.includes('<key>ProgramArguments</key>'), `${name} is missing ProgramArguments`);
    assert(text.includes('<key>RunAtLoad</key>'), `${name} is missing RunAtLoad`);
    assert(text.includes('<key>KeepAlive</key>') || text.includes('<key>StartInterval</key>') || text.includes('<key>StartCalendarInterval</key>'), `${name} needs KeepAlive, StartInterval, or StartCalendarInterval`);
    assert(!/(FSQ_PLACES_TOKEN|HF_TOKEN|SUPABASE_SERVICE_ROLE|PGPASSWORD)\s*=/.test(text), `${name} contains a credential assignment`);
  }

  const menuParser = read('infra/local/launchd/com.apizzamichigan.menu-parser.plist.template');
  assert(menuParser.includes('menu-parse-worker.mjs --max-jobs 100'), 'menu parser must remain bounded at 100 jobs');
  assert(menuParser.includes('<integer>120</integer>'), 'menu parser should run every 120 seconds');
  assert(menuParser.includes('<false/>'), 'menu parser must not run immediately at login');
  assert(!menuParser.includes('OLLAMA_'), 'menu parser must not depend on Ollama');

  const classifier = read('infra/local/launchd/com.apizzamichigan.classifier.plist.template');
  assert(classifier.includes('llm-classifier.mjs'), 'classifier must run the LLM classifier');
  assert(classifier.includes('--worker-id launchd-classify'), 'classifier must declare the primary worker id');
  assert(classifier.includes('<key>KeepAlive</key>'), 'classifier must be self-healing with KeepAlive');
  assert(classifier.includes('<string>llama3.2:latest</string>'), 'classifier must use the approved local model');
  assert(classifier.includes('<string>http://127.0.0.1:11435</string>'), 'classifier must use the forwarded Ollama endpoint');

  const tunnel = read('infra/local/launchd/com.apizzamichigan.laptop-ollama-tunnel.plist.template');
  assert(tunnel.includes('<key>KeepAlive</key>'), 'laptop Ollama tunnel must be self-healing with KeepAlive');
  assert(tunnel.includes('ExitOnForwardFailure=yes'), 'laptop Ollama tunnel must fail fast when forwarding is unavailable');
  assert(tunnel.includes('ServerAliveInterval=30'), 'laptop Ollama tunnel must send SSH keepalives');
  assert(tunnel.includes('127.0.0.1:11435:127.0.0.1:11434'), 'laptop Ollama tunnel endpoint must remain stable');

  const sync = read('infra/local/launchd/com.apizzamichigan.supabase-sync.plist.template');
  assert(sync.includes('<key>ENABLE_LIFECYCLE_SYNC</key>'), 'Supabase sync must explicitly enable lifecycle publication');
  assert(sync.includes('<key>APIZZA_SYNC_BULK_RPC</key>'), 'Supabase sync must use the guarded bulk RPC path');
  assert(sync.includes('<string>1</string>'), 'Supabase sync lifecycle publication must be enabled');

  const backup = read('infra/local/launchd/com.apizzamichigan.backup.plist.template');
  assert(backup.includes('create-local-backup.mjs'), 'backup service must run the local backup job');
  assert(backup.includes('--retention 7'), 'backup service must retain seven runs');
  assert(backup.includes('<key>StartCalendarInterval</key>'), 'backup service must run on a calendar schedule');

  const retryFeeder = read('infra/local/launchd/com.apizzamichigan.classifier-retry-feeder.plist.template');
  assert(retryFeeder.includes('feed-classifier-retries.mjs --apply'), 'classifier retry feeder must run the bounded retry feeder');
  assert(retryFeeder.includes('<integer>300</integer>'), 'classifier retry feeder should run every five minutes');

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
