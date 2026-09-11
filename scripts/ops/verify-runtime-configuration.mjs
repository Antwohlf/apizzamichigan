#!/usr/bin/env node
/** Read-only contract check for the application-owned runtime boundary. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LAUNCHD_DIR = join(ROOT, 'infra/local/launchd');
const REQUIRED_FILES = [
  'server/index.js',
  'shared/admin-session-boundary.cjs',
  'shared/pipeline-status-boundary.cjs',
  'shared/food-runtime-publication-status.cjs',
  'config/food-runtime-boundary.json',
  'config/pipeline-boundary.json',
  'contracts/food-review-artifacts.v1.json',
  'server/integrations/food-review-artifacts.cjs',
  'server/product/lifecycle-mutation.cjs',
  'server/product/source-review-identity.mjs',
  'contracts/pipeline-status.v1.schema.json',
  'contracts/pipeline-targets/apizza-pipeline-write-contract.v1.json',
  'contracts/pipeline-targets/taco-pipeline-write-contract.v1.json',
];

function assert(condition, message) { if (!condition) throw new Error(message); }
function read(path) { return readFileSync(join(ROOT, path), 'utf8'); }

function main() {
  assert(existsSync(join(ROOT, 'package.json')), 'package.json is missing');
  const packageJson = JSON.parse(read('package.json'));
  for (const script of ['build', 'typecheck', 'start:server']) {
    assert(typeof packageJson.scripts?.[script] === 'string', `package.json is missing ${script}`);
  }
  for (const path of REQUIRED_FILES) assert(existsSync(join(ROOT, path)), `required app contract is missing: ${path}`);

  const boundary = JSON.parse(read('config/food-runtime-boundary.json'));
  assert(Array.isArray(boundary.products) && boundary.products.includes('apizzamichigan') && boundary.products.includes('tacoboutmichigan'), 'food runtime boundary must name both products');
  assert(Array.isArray(boundary.scheduledJobsOwnedBySite) && boundary.scheduledJobsOwnedBySite.length === 0, 'site must not own scheduled food jobs');
  assert(boundary.publicationStatus?.access === 'read-only', 'food runtime publication must be read-only');
  assert(boundary.publicationStatus?.rootEnvironmentVariable === 'FOOD_PIPELINE_STATUS_ROOT', 'food runtime status root contract changed');
  assert(boundary.backups?.owner === 'external-runtime', 'food runtime backups must remain externally owned');
  assert(boundary.reviewArtifacts?.access === 'read-only'
    && boundary.reviewArtifacts.rootEnvironmentVariable === 'FOOD_PIPELINE_REPORT_ROOT', 'review reports must use the explicit external read-only contract');

  const server = read('server/index.js');
  for (const contract of ['admin-session-boundary.cjs', 'pipeline-status-boundary.cjs', 'food-runtime-publication-status.cjs']) assert(server.includes(contract), `server must use ${contract}`);
  const publication = read('shared/food-runtime-publication-status.cjs');
  assert(publication.includes('readFoodRuntimePublicationStatus') && publication.includes('foodRuntimePublicationStatusResponse'), 'publication status module must expose read-only status helpers');
  const legacyKeepalive = read('scripts/enrichment/keepalive.mjs');
  assert(legacyKeepalive.includes('packages/food-runtime')
    && !legacyKeepalive.includes('node:child_process')
    && !legacyKeepalive.includes('spawn('), 'legacy keepalive must fail closed and point to the external runtime');
  const retiredSyncAgent = read('scripts/enrichment/agents/sync-agent.mjs');
  assert(retiredSyncAgent.includes('packages/food-runtime')
    && !retiredSyncAgent.includes('node:child_process')
    && !retiredSyncAgent.includes('spawn('), 'retired sync agent must fail closed and point to the external runtime');

  const templates = readdirSync(LAUNCHD_DIR).filter(name => name.endsWith('.plist.template')).sort();
  assert(templates.every(name => name === 'com.apizzamichigan.pipeline-health.plist.template'), `pipeline launchd templates remain: ${templates.filter(name => name !== 'com.apizzamichigan.pipeline-health.plist.template').join(', ')}`);
  assert(templates.length === 1, 'the app may retain only its pipeline-health status service template');
  const health = read('infra/local/launchd/com.apizzamichigan.pipeline-health.plist.template');
  for (const marker of ['<key>Label</key>', '<key>ProgramArguments</key>', '<key>RunAtLoad</key>']) assert(health.includes(marker), `pipeline-health template is missing ${marker}`);
  assert(!/(FSQ_PLACES_TOKEN|HF_TOKEN|SUPABASE_SERVICE_ROLE|PGPASSWORD)\s*=/.test(health), 'pipeline-health template contains a credential assignment');

  const ignored = read('.gitignore').split('\n').map(line => line.trim());
  assert(ignored.includes('.env*') && (ignored.includes('!.env.example') || ignored.includes('!/.env.example')), '.gitignore must protect env files while permitting .env.example');
  assert(ignored.includes('/scripts/.pipeline-status/'), '.gitignore must protect local pipeline status');
  const envExample = read('.env.example');
  for (const variable of ['FOOD_PIPELINE_STATUS_ROOT=', 'FOOD_PIPELINE_STATUS_MAX_AGE_MINUTES=360']) assert(envExample.split('\n').includes(variable), `.env.example is missing safe setting: ${variable}`);

  console.log('# Runtime Configuration Verification\n\nlaunchd_templates=1\napp_owned_scheduled_food_jobs=0\npublication_status=read_only\nsecret_values_checked=none_read_or_printed\nstatus=ok');
}

main();
