#!/usr/bin/env node
/** Read-only contract check for the local backup job and launchd template. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/ops/create-local-backup.mjs');
const TEMPLATE = join(ROOT, 'infra/local/launchd/com.apizzamichigan.backup.plist.template');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(existsSync(SCRIPT), 'local backup script is missing');
assert(existsSync(TEMPLATE), 'local backup launchd template is missing');

const script = readFileSync(SCRIPT, 'utf8');
const template = readFileSync(TEMPLATE, 'utf8');

for (const required of [
  'pg_dump',
  'better-sqlite3',
  '.backup(',
  'sha256',
  'manifest.json',
  'retention',
  '--dry-run',
]) {
  assert(script.includes(required), `backup script is missing ${required}`);
}
assert(!script.includes('SUPABASE_SERVICE_ROLE'), 'backup script must not reference Supabase service credentials');
assert(template.includes('create-local-backup.mjs'), 'backup template must invoke the backup script');
assert(template.includes('--retention 7'), 'backup template must retain seven runs');
assert(template.includes('<key>StartCalendarInterval</key>'), 'backup template must use a calendar schedule');
assert(template.includes('<integer>3</integer>') && template.includes('<integer>30</integer>'), 'backup template must run at 03:30');

console.log('# Local Backup Contract Verification');
console.log('');
console.log('targets=postgres,sqlite_queue');
console.log('manifest=sha256');
console.log('schedule=03:30');
console.log('status=ok');
