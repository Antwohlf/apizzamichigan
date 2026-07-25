import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPABASE_SYNC_PROFILES,
  syncRpcForEntity,
  syncTargetForEntity,
  supabaseSyncProfile,
} from './supabase-sync-profiles.mjs';

test('keeps pizza as the enabled default publication profile', () => {
  assert.deepEqual(supabaseSyncProfile(), SUPABASE_SYNC_PROFILES.pizza);
  assert.equal(SUPABASE_SYNC_PROFILES.pizza.targetTable, 'pizza_places');
  assert.equal(SUPABASE_SYNC_PROFILES.pizza.publicationEnabled, true);
});

test('exposes taco for dry-run planning but keeps publication disabled', () => {
  const taco = supabaseSyncProfile('taco');
  assert.equal(taco.targetTable, 'taco_places');
  assert.equal(taco.publicationEnabled, false);
  assert.throws(() => supabaseSyncProfile('dessert'), /Unsupported sync entity/);
});

test('resolves entity-specific target tables and bulk RPCs from one profile', () => {
  assert.equal(syncTargetForEntity('pizza'), 'pizza_places');
  assert.equal(syncTargetForEntity('taco'), 'taco_places');
  assert.equal(syncRpcForEntity('pizza'), 'apply_pizza_places_sync_batch');
  assert.equal(syncRpcForEntity('taco'), 'apply_taco_places_sync_batch');
});
