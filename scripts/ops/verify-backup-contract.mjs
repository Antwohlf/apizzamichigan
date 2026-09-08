#!/usr/bin/env node
// Implementation and restore checks belong to the external runtime repository.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const boundary = JSON.parse(readFileSync('config/food-runtime-boundary.json', 'utf8'));
assert.equal(boundary.runtimeRepository, 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline');
assert.equal(boundary.runtimePackage, 'packages/food-runtime');
assert.deepEqual(boundary.scheduledJobsOwnedBySite, []);
assert.equal(boundary.backups.owner, 'external-runtime');
assert.deepEqual(boundary.backups.targets, ['postgres', 'sqlite_queue']);
assert.equal(boundary.backups.verification, 'sha256-and-sqlite-integrity');
assert.equal(existsSync('infra/local/launchd/com.apizzamichigan.backup.plist.template'), false);
console.log('backup_owner=external-runtime; site_scheduled_backups=0; status=ok');
