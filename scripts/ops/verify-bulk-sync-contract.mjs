#!/usr/bin/env node
/** Verify the checked-in low-I/O sync contract without contacting Supabase. */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FILL_IF_NULL_COLS,
  LIFECYCLE_COLS,
  OVERWRITE_COLS,
  QA_DEFAULT_COLS,
  SUPABASE_BULK_SYNC_RPC,
} from '../lib/supabase-sync-policy.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-production-migration.sql');
const migration = readFileSync(migrationPath, 'utf8');
const repairMigrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-bulk-sync-rpc-migration.sql');
const repairMigration = readFileSync(repairMigrationPath, 'utf8');
const verificationSql = readFileSync(resolve(process.cwd(), 'scripts/enrichment/verify-supabase-bulk-sync-rpc.sql'), 'utf8');
const searchMigrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-search-index-migration.sql');
const searchMigration = readFileSync(searchMigrationPath, 'utf8');
const statusReport = readFileSync(resolve(process.cwd(), 'scripts/ops/supabase-sync-status-report.mjs'), 'utf8');
const readinessReport = readFileSync(resolve(process.cwd(), 'scripts/ops/project-readiness-report.mjs'), 'utf8');
const guardedSync = readFileSync(resolve(process.cwd(), 'scripts/ops/guarded-supabase-sync.mjs'), 'utf8');
const autoSync = readFileSync(resolve(process.cwd(), 'scripts/ops/auto-guarded-supabase-sync.mjs'), 'utf8');

assert(SUPABASE_BULK_SYNC_RPC === 'apply_pizza_places_sync_batch', 'RPC name changed unexpectedly.');
assert(migration.includes(`CREATE OR REPLACE FUNCTION public.${SUPABASE_BULK_SYNC_RPC}(p_rows jsonb)`), 'Migration must define the bulk RPC.');
assert(repairMigration.includes(`CREATE OR REPLACE FUNCTION public.${SUPABASE_BULK_SYNC_RPC}(p_rows jsonb)`), 'RPC repair migration must define the bulk RPC.');
assert(/SECURITY DEFINER/i.test(repairMigration), 'RPC repair migration must run with controlled database privileges.');
assert(/SET search_path = public/i.test(repairMigration), 'RPC repair migration must pin its search path.');
assert(/REVOKE ALL ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) FROM PUBLIC/i.test(repairMigration), 'RPC repair migration must not be public.');
assert(/GRANT EXECUTE ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) TO service_role/i.test(repairMigration), 'RPC repair migration must be restricted to service_role.');
assert(verificationSql.includes("has_function_privilege('service_role'"), 'RPC verification must check service_role permission.');
assert(verificationSql.includes("has_function_privilege('anon'"), 'RPC verification must check anon permission.');
assert(verificationSql.includes("apply_pizza_places_sync_batch('[]'::jsonb)"), 'RPC verification must probe with an empty array.');
assert(/SECURITY DEFINER/i.test(migration), 'Bulk RPC must run with controlled database privileges.');
assert(/SET search_path = public/i.test(migration), 'Bulk RPC must pin its search path.');
assert(/REVOKE ALL ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) FROM PUBLIC/i.test(migration), 'Bulk RPC must not be public.');
assert(/GRANT EXECUTE ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) TO service_role/i.test(migration), 'Bulk RPC must be restricted to service_role.');
for (const column of ['style', 'price', 'price_range', 'style_confidence']) {
  assert(new RegExp(`target\\.${column} IS NULL AND incoming\\.patch \\? '${column}'`).test(migration), `Bulk RPC must preserve non-null ${column}.`);
}
assert(/lifecycle_status = CASE WHEN incoming\.patch \? 'lifecycle_status'/i.test(migration), 'Bulk RPC must support explicit lifecycle changes.');
assert(/target\.id = incoming\.id/i.test(migration), 'Bulk RPC must update by canonical id only.');
const recordShape = migration.match(/jsonb_to_record\(source\.item\) AS parsed\(([\s\S]*?)\n    \)\n  \)\n  UPDATE/)?.[1] || '';
assert(recordShape, 'Bulk RPC record shape must be discoverable for contract checks.');
const contractColumns = [...new Set([
  ...OVERWRITE_COLS,
  ...FILL_IF_NULL_COLS,
  ...QA_DEFAULT_COLS,
  ...LIFECYCLE_COLS,
])];
for (const column of contractColumns) {
  const declared = new RegExp(`\\b${column}\\s+[a-z]+(?:\\s+jsonb)?\\b`, 'i').test(recordShape);
  assert(declared, `Bulk RPC record shape is missing sync column: ${column}.`);
  const updated = new RegExp(`\\b${column}\\s*=\\s*CASE`, 'i').test(migration);
  assert(updated, `Bulk RPC update is missing sync column: ${column}.`);
}
assert(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i.test(searchMigration), 'Search migration must enable pg_trgm.');
assert(/idx_taco_places_search_price/i.test(searchMigration), 'Taco search index definitions must remain covered by the search migration.');
assert(/idx_pizza_places_search_name_trgm/i.test(searchMigration), 'Pizza search index definitions must remain covered by the search migration.');
assert(statusReport.includes('p_rows: []'), 'Sync status report must perform a zero-row bulk RPC capability check.');
for (const state of ['ready', 'not_configured', 'migration_missing', 'unavailable']) {
  assert(statusReport.includes(`'${state}'`), `Sync status report must expose bulk RPC state ${state}.`);
}
assert(statusReport.includes('SUPABASE_BULK_SYNC_RPC'), 'Sync status report must use the canonical bulk RPC name.');
assert(statusReport.includes('supabase-bulk-sync-rpc-migration.sql'), 'Sync status report must point to the focused RPC repair migration.');
assert(statusReport.includes('publicationReadiness'), 'Sync status report must expose publication readiness separately from local inspection status.');
assert(statusReport.includes("status: 'READY'"), 'Sync status report must expose a ready publication state.');
assert(statusReport.includes("status: 'BLOCKED'"), 'Sync status report must expose a blocked publication state.');
assert(readinessReport.includes("sync.value.bulkRpc?.state === 'ready'"), 'Project readiness must require a ready bulk RPC.');
assert(statusReport.includes("(requireBulkRpc || bulkRpc?.configured) && bulkRpc.state !== 'ready'"), 'Sync status must block when required bulk RPC is unavailable.');
assert(statusReport.includes("arg === '--require-bulk-rpc'"), 'Sync status must support an explicit bulk RPC requirement.');
assert(guardedSync.includes("'--require-bulk-rpc'"), 'Guarded sync must pass the explicit bulk RPC requirement.');
assert(guardedSync.includes('bulk RPC gate failed'), 'Guarded sync must fail before writes when bulk RPC is not ready.');
assert(guardedSync.includes("step('Bulk RPC Gate')"), 'Guarded sync must report the bulk RPC gate explicitly.');
const noWorkExit = guardedSync.indexOf('No rows to update; stopping cleanly');
const bulkGate = guardedSync.indexOf("step('Bulk RPC Gate')");
assert(noWorkExit >= 0 && bulkGate > noWorkExit, 'Guarded sync must stop idle runs before requiring the bulk RPC.');
assert((autoSync.match(/'--bulk-rpc'/g) || []).length >= 2, 'Scheduled sync and reconciliation must explicitly require the bulk RPC path.');
assert(autoSync.includes("'scripts/ops/supabase-sync-status-report.mjs'"), 'Scheduled sync must check bulk capability before local repair.');
assert(autoSync.includes("'--require-bulk-rpc'"), 'Scheduled sync must require the bulk RPC during preflight.');
assert(autoSync.includes('if (!bulkSyncPreflight()) process.exit(0);'), 'Scheduled sync must skip cleanly while migration is missing.');

console.log('# Bulk Sync Contract Verification');
console.log('');
console.log(`rpc=${SUPABASE_BULK_SYNC_RPC}`);
console.log('writes=database-side-batch');
console.log('protected_fields=preserve-non-null');
console.log('status=ok');
