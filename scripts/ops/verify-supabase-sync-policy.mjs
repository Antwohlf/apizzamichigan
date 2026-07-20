#!/usr/bin/env node
/**
 * Verify the local-to-Supabase sync boundary.
 *
 * This is intentionally dependency-free so it can run in ops checks without a
 * test harness. It guards the current policy: only pizza_places is syncable;
 * provenance/review tables remain local-only.
 */

import {
  LIFECYCLE_COLS,
  LIFECYCLE_SYNC_ENABLED,
  LOCAL_ONLY_SUPABASE_TABLES,
  SUPABASE_SYNC_TARGET_TABLE,
  assertSupabaseSyncTableBoundary,
  localSyncSelect,
} from '../lib/supabase-sync-policy.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn, expectedText) {
  try {
    fn();
  } catch (error) {
    assert(String(error?.message || error).includes(expectedText), `Expected error to include "${expectedText}"`);
    return;
  }
  throw new Error(`Expected function to throw: ${expectedText}`);
}

function main() {
  const boundary = assertSupabaseSyncTableBoundary();
  assert(boundary.targetTable === 'pizza_places', 'Default sync target must be pizza_places.');
  assert(SUPABASE_SYNC_TARGET_TABLE === 'pizza_places', 'SUPABASE_SYNC_TARGET_TABLE must stay pizza_places.');
  assert(LOCAL_ONLY_SUPABASE_TABLES.includes('place_sources'), 'place_sources must be local-only.');
  assert(LOCAL_ONLY_SUPABASE_TABLES.includes('source_review_queue'), 'source_review_queue must be local-only.');

  for (const tableName of LOCAL_ONLY_SUPABASE_TABLES) {
    assertThrows(
      () => assertSupabaseSyncTableBoundary({ targetTable: tableName }),
      'Refusing to sync local-only provenance/review table',
    );
  }

  assertThrows(
    () => assertSupabaseSyncTableBoundary({ targetTable: 'taco_places' }),
    'Unsupported Supabase sync target table',
  );

  const { sql } = localSyncSelect({ batch: 5 });
  assert(/\bfrom pizza_places\b/i.test(sql), 'Local sync SQL must select from pizza_places.');
  for (const tableName of LOCAL_ONLY_SUPABASE_TABLES) {
    assert(!new RegExp(`\\b${tableName}\\b`, 'i').test(sql), `Local sync SQL must not reference ${tableName}.`);
  }

  if (LIFECYCLE_SYNC_ENABLED) {
    assert(LIFECYCLE_COLS.includes('lifecycle_status'), 'Enabled lifecycle sync must select lifecycle_status.');
    assert(LIFECYCLE_COLS.includes('lifecycle_replaced_by_id'), 'Enabled lifecycle sync must select replacement IDs.');
  } else {
    assert(LIFECYCLE_COLS.length === 0, 'Lifecycle columns must stay disabled until the remote migration is applied.');
    assert(!/\\blifecycle_status\\b/i.test(sql), 'Default sync must not reference lifecycle_status.');
  }

  console.log('# Supabase Sync Policy Verification');
  console.log('');
  console.log(`target_table=${SUPABASE_SYNC_TARGET_TABLE}`);
  console.log(`local_only_tables=${LOCAL_ONLY_SUPABASE_TABLES.join(',')}`);
  console.log(`lifecycle_sync=${LIFECYCLE_SYNC_ENABLED ? 'enabled' : 'disabled'}`);
  console.log('status=ok');
}

main();
