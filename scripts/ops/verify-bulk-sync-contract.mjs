#!/usr/bin/env node
/** Verify the checked-in low-I/O sync contract without contacting Supabase. */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CANONICAL_MIRROR_COLS,
  LIFECYCLE_COLS,
  OVERWRITE_COLS,
  QA_DEFAULT_COLS,
  SUPABASE_BULK_SYNC_RPC,
  syncColumnsForEntity,
} from '../lib/supabase-sync-policy.mjs';
import { supabaseSyncProfile } from '../lib/supabase-sync-profiles.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-production-migration.sql');
const migration = readFileSync(migrationPath, 'utf8');
const repairMigrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-bulk-sync-rpc-migration.sql');
const repairMigration = readFileSync(repairMigrationPath, 'utf8');
const tacoMigration = readFileSync(resolve(process.cwd(), 'scripts/enrichment/supabase-taco-publication-migration.sql'), 'utf8');
const guardedSyncBoundary = readFileSync(resolve(process.cwd(), 'scripts/lib/guarded-sync-entity-boundary.mjs'), 'utf8');
const verificationSql = readFileSync(resolve(process.cwd(), 'scripts/enrichment/verify-supabase-bulk-sync-rpc.sql'), 'utf8');
const searchMigrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-search-index-migration.sql');
const searchMigration = readFileSync(searchMigrationPath, 'utf8');
const statusReport = readFileSync(resolve(process.cwd(), 'scripts/ops/supabase-sync-status-report.mjs'), 'utf8');
const readinessReport = readFileSync(resolve(process.cwd(), 'scripts/ops/project-readiness-report.mjs'), 'utf8');
const credentials = readFileSync(resolve(process.cwd(), 'scripts/lib/supabase-sync-credentials.mjs'), 'utf8');
const foodRuntimeBoundary = JSON.parse(readFileSync(resolve(process.cwd(), 'config/food-runtime-boundary.json'), 'utf8'));

assert(foodRuntimeBoundary.runtimeRepository === 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline', 'Food publisher must name the external runtime repository.');
assert(foodRuntimeBoundary.runtimePackage === 'packages/food-runtime', 'Food publisher must name the external runtime package.');
assert(Array.isArray(foodRuntimeBoundary.scheduledJobsOwnedBySite) && foodRuntimeBoundary.scheduledJobsOwnedBySite.length === 0, 'Site must not own scheduled food jobs.');
for (const movedImplementation of [
  'scripts/ops/guarded-supabase-sync.mjs',
  'scripts/ops/auto-guarded-supabase-sync.mjs',
  'scripts/sync-local-to-supabase.mjs',
]) {
  assert(!existsSync(resolve(process.cwd(), movedImplementation)), `Migrated publisher must not remain in the app checkout: ${movedImplementation}`);
}

assert(SUPABASE_BULK_SYNC_RPC === 'apply_pizza_places_sync_batch', 'RPC name changed unexpectedly.');
assert(migration.includes(`CREATE OR REPLACE FUNCTION public.${SUPABASE_BULK_SYNC_RPC}(p_rows jsonb)`), 'Migration must define the bulk RPC.');
assert(repairMigration.includes(`CREATE OR REPLACE FUNCTION public.${SUPABASE_BULK_SYNC_RPC}(p_rows jsonb)`), 'RPC repair migration must define the bulk RPC.');
assert(/SECURITY DEFINER/i.test(repairMigration), 'RPC repair migration must run with controlled database privileges.');
assert(/SET search_path = public/i.test(repairMigration), 'RPC repair migration must pin its search path.');
assert(/jsonb_array_length\(p_rows\) > 500/i.test(repairMigration), 'RPC repair migration must cap batch size at 500 rows.');
assert(/REVOKE ALL ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) FROM PUBLIC/i.test(repairMigration), 'RPC repair migration must not be public.');
assert(/GRANT EXECUTE ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) TO service_role/i.test(repairMigration), 'RPC repair migration must be restricted to service_role.');
assert(verificationSql.includes("has_function_privilege('service_role'"), 'RPC verification must check service_role permission.');
assert(verificationSql.includes("has_function_privilege('anon'"), 'RPC verification must check anon permission.');
assert(verificationSql.includes("apply_pizza_places_sync_batch('[]'::jsonb)"), 'RPC verification must probe with an empty array.');
assert(/SECURITY DEFINER/i.test(migration), 'Bulk RPC must run with controlled database privileges.');
assert(/SET search_path = public/i.test(migration), 'Bulk RPC must pin its search path.');
assert(/jsonb_array_length\(p_rows\) > 500/i.test(migration), 'Bulk RPC must cap batch size at 500 rows.');
assert(/REVOKE ALL ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) FROM PUBLIC/i.test(migration), 'Bulk RPC must not be public.');
assert(/GRANT EXECUTE ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) TO service_role/i.test(migration), 'Bulk RPC must be restricted to service_role.');
for (const column of CANONICAL_MIRROR_COLS) {
  assert(new RegExp(`incoming\\.patch \\? '${column}'`).test(migration), `Bulk RPC must accept canonical mirror field ${column}.`);
  assert(!new RegExp(`target\\.${column} IS NULL AND incoming\\.patch \\? '${column}'`).test(migration), `Bulk RPC must not retain fill-only protection for ${column}.`);
}
assert(/lifecycle_status = CASE WHEN incoming\.patch \? 'lifecycle_status'/i.test(migration), 'Bulk RPC must support explicit lifecycle changes.');
assert(/target\.id = incoming\.id/i.test(migration), 'Bulk RPC must update by canonical id only.');
const recordShape = migration.match(/jsonb_to_record\(source\.item\) AS parsed\(([\s\S]*?)\n    \)\n  \)\n  UPDATE/)?.[1] || '';
assert(recordShape, 'Bulk RPC record shape must be discoverable for contract checks.');
const contractColumns = [...new Set([
  ...OVERWRITE_COLS,
  ...CANONICAL_MIRROR_COLS,
  ...QA_DEFAULT_COLS,
  ...LIFECYCLE_COLS,
])];
for (const column of contractColumns) {
  const declared = new RegExp(`\\b${column}\\s+[a-z]+(?:\\s+jsonb)?\\b`, 'i').test(recordShape);
  assert(declared, `Bulk RPC record shape is missing sync column: ${column}.`);
  const updated = new RegExp(`\\b${column}\\s*=\\s*CASE`, 'i').test(migration);
  assert(updated, `Bulk RPC update is missing sync column: ${column}.`);
}
const tacoProfile = supabaseSyncProfile('taco');
assert(tacoMigration.includes(`CREATE OR REPLACE FUNCTION public.${tacoProfile.bulkRpc}(p_rows jsonb)`), 'Taco migration must define its entity-specific bulk RPC.');
assert(/REVOKE ALL ON FUNCTION public\.apply_taco_places_sync_batch\(jsonb\) FROM PUBLIC/i.test(tacoMigration), 'Taco bulk RPC must not be public.');
const tacoRecordShape = tacoMigration.match(/jsonb_to_record\(source\.item\) AS parsed\(([\s\S]*?)\n    \)\n  \)\n  UPDATE/)?.[1] || '';
assert(tacoRecordShape, 'Taco bulk RPC record shape must be discoverable for contract checks.');
const tacoContractColumns = [...new Set([
  ...syncColumnsForEntity(OVERWRITE_COLS, 'taco'),
  ...syncColumnsForEntity(CANONICAL_MIRROR_COLS, 'taco'),
  ...syncColumnsForEntity(QA_DEFAULT_COLS, 'taco'),
  'lifecycle_status',
  'lifecycle_replaced_by_id',
])];
for (const column of tacoContractColumns) {
  assert(new RegExp(`\\b${column}\\s+[a-z]+(?:\\s+jsonb)?\\b`, 'i').test(tacoRecordShape), `Taco RPC record shape is missing sync column: ${column}.`);
  assert(new RegExp(`\\b${column}\\s*=\\s*CASE`, 'i').test(tacoMigration), `Taco RPC update is missing sync column: ${column}.`);
}
for (const excluded of ['created_at', 'menu_data', 'menu_parse_confidence', 'menu_parse_notes', 'menu_last_parsed_at', 'qa_status', 'qa_schema_version']) {
  assert(!new RegExp(`\\b${excluded}\\s+[a-z]+`, 'i').test(tacoRecordShape), `Taco RPC must not parse excluded field: ${excluded}.`);
}
assert(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i.test(searchMigration), 'Search migration must enable pg_trgm.');
assert(/idx_taco_places_search_price/i.test(searchMigration), 'Taco search index definitions must remain covered by the search migration.');
assert(/idx_pizza_places_search_name_trgm/i.test(searchMigration), 'Pizza search index definitions must remain covered by the search migration.');
assert(statusReport.includes('p_rows: []'), 'Sync status report must perform a zero-row bulk RPC capability check.');
for (const state of ['ready', 'not_configured', 'migration_missing', 'unavailable']) {
  assert(statusReport.includes(`'${state}'`), `Sync status report must expose bulk RPC state ${state}.`);
}
assert(statusReport.includes('profile.bulkRpc'), 'Sync status report must resolve the bulk RPC from the selected entity profile.');
assert(statusReport.includes('supabase-bulk-sync-rpc-migration.sql'), 'Sync status report must point to the focused RPC repair migration.');
assert(statusReport.includes('publicationReadiness'), 'Sync status report must expose publication readiness separately from local inspection status.');
assert(statusReport.includes("status: 'READY'"), 'Sync status report must expose a ready publication state.');
assert(statusReport.includes("status: 'BLOCKED'"), 'Sync status report must expose a blocked publication state.');
assert(readinessReport.includes("sync.value.bulkRpc?.state === 'ready'"), 'Project readiness must require a ready bulk RPC.');
assert(statusReport.includes("(requireBulkRpc || bulkRpc?.configured) && bulkRpc.state !== 'ready'"), 'Sync status must block when required bulk RPC is unavailable.');
assert(statusReport.includes("arg === '--require-bulk-rpc'"), 'Sync status must support an explicit bulk RPC requirement.');
assert(guardedSyncBoundary.includes("'--require-bulk-rpc'"), 'Guarded sync must pass the explicit bulk RPC requirement.');
assert(credentials.includes('Live Supabase sync requires SUPABASE_SERVICE_ROLE_KEY'), 'Live sync must require the service-role key.');
assert(credentials.includes('dryRun'), 'Sync credential resolution must distinguish previews from live writes.');

console.log('# Bulk Sync Contract Verification');
console.log('');
console.log(`rpc=${SUPABASE_BULK_SYNC_RPC}`);
console.log('writes=database-side-batch');
console.log('publisher_owner=external-runtime');
console.log(`canonical_mirror_fields=${CANONICAL_MIRROR_COLS.join(',')}`);
console.log('status=ok');
