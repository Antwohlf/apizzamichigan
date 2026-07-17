#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
  FILL_IF_NULL_COLS,
  LOCAL_CONTEXT_COLS,
  LOCAL_SYNC_COLS,
  OVERWRITE_COLS,
  QA_DEFAULT_COLS,
  SUPABASE_SYNC_SELECT_COLS,
  SUPABASE_SYNC_TARGET_TABLE,
  LOCAL_ONLY_SUPABASE_TABLES,
} from '../lib/supabase-sync-policy.mjs';
import {
  autoPromotableSourceFields,
  sourcePromotionFieldPolicy,
} from '../lib/source-promotion-policy.mjs';

const contract = JSON.parse(readFileSync('config/canonical-contract.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function flattenedFields() {
  return Object.values(contract.fields).flat();
}

function main() {
  assert(contract.version === 1, 'canonical contract version must be 1');
  assert(contract.sync_target === SUPABASE_SYNC_TARGET_TABLE, 'contract sync target disagrees with sync policy');
  assert(sameSet(contract.local_only_tables, LOCAL_ONLY_SUPABASE_TABLES), 'contract local-only tables disagree with sync policy');
  assert(contract.canonical_tables.pizza === 'pizza_places', 'pizza canonical table must be pizza_places');
  assert(contract.canonical_tables.taco === 'taco_places', 'taco canonical table must be taco_places');

  const localSyncColumns = [...new Set(LOCAL_SYNC_COLS)];
  const syncColumns = [...new Set([...localSyncColumns, ...QA_DEFAULT_COLS])];
  const expectedRemoteSelect = [...new Set(['id', ...OVERWRITE_COLS, ...FILL_IF_NULL_COLS, ...QA_DEFAULT_COLS])];
  assert(sameSet(SUPABASE_SYNC_SELECT_COLS, expectedRemoteSelect), 'remote select columns drift from sync policy');
  assert(localSyncColumns.includes('id'), 'local sync contract must include id');
  const contractedSyncColumns = new Set(flattenedFields());
  for (const column of syncColumns) assert(contractedSyncColumns.has(column), `sync column missing from canonical contract: ${column}`);

  const fieldGroups = Object.entries(contract.fields);
  const seen = new Set();
  for (const [group, fields] of fieldGroups) {
    assert(Array.isArray(fields) && fields.length, `${group} fields must be a non-empty array`);
    for (const field of fields) {
      assert(!seen.has(field), `canonical field appears in multiple groups: ${field}`);
      seen.add(field);
    }
  }

  assert(sameSet(contract.promotion.auto_fill_if_blank, autoPromotableSourceFields()), 'auto-promotion policy disagrees with canonical contract');
  for (const field of contract.promotion.manual_review_only) {
    assert(sourcePromotionFieldPolicy(field)?.disposition === 'manual_review_only', `${field} must remain manual-review-only`);
  }
  for (const field of contract.promotion.blocked_from_source_promotion) {
    assert(sourcePromotionFieldPolicy(field)?.disposition === 'blocked', `${field} must remain blocked from source promotion`);
  }

  for (const [field, values] of Object.entries(contract.allowed_values)) {
    assert(Array.isArray(values) && values.length, `${field} must define allowed values`);
  }

  console.log(JSON.stringify({
    status: 'ok',
    version: contract.version,
    entities: contract.entities,
    canonical_tables: contract.canonical_tables,
    local_only_tables: contract.local_only_tables,
    sync_columns: syncColumns.length,
    field_groups: Object.fromEntries(fieldGroups.map(([group, fields]) => [group, fields.length])),
    auto_fill_if_blank: contract.promotion.auto_fill_if_blank,
  }, null, 2));
}

main();
