#!/usr/bin/env node
/** Verify the checked-in low-I/O sync contract without contacting Supabase. */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SUPABASE_BULK_SYNC_RPC } from '../lib/supabase-sync-policy.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migrationPath = resolve(process.cwd(), 'scripts/enrichment/supabase-production-migration.sql');
const migration = readFileSync(migrationPath, 'utf8');

assert(SUPABASE_BULK_SYNC_RPC === 'apply_pizza_places_sync_batch', 'RPC name changed unexpectedly.');
assert(migration.includes(`CREATE OR REPLACE FUNCTION public.${SUPABASE_BULK_SYNC_RPC}(p_rows jsonb)`), 'Migration must define the bulk RPC.');
assert(/SECURITY DEFINER/i.test(migration), 'Bulk RPC must run with controlled database privileges.');
assert(/SET search_path = public/i.test(migration), 'Bulk RPC must pin its search path.');
assert(/REVOKE ALL ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) FROM PUBLIC/i.test(migration), 'Bulk RPC must not be public.');
assert(/GRANT EXECUTE ON FUNCTION public\.apply_pizza_places_sync_batch\(jsonb\) TO service_role/i.test(migration), 'Bulk RPC must be restricted to service_role.');
for (const column of ['style', 'price', 'price_range', 'style_confidence']) {
  assert(new RegExp(`target\\.${column} IS NULL AND incoming\\.patch \\? '${column}'`).test(migration), `Bulk RPC must preserve non-null ${column}.`);
}
assert(/lifecycle_status = CASE WHEN incoming\.patch \? 'lifecycle_status'/i.test(migration), 'Bulk RPC must support explicit lifecycle changes.');
assert(/target\.id = incoming\.id/i.test(migration), 'Bulk RPC must update by canonical id only.');

console.log('# Bulk Sync Contract Verification');
console.log('');
console.log(`rpc=${SUPABASE_BULK_SYNC_RPC}`);
console.log('writes=database-side-batch');
console.log('protected_fields=preserve-non-null');
console.log('status=ok');
