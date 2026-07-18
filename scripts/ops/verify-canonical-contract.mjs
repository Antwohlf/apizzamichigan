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
  SOURCE_PROMOTION_DEFAULTS,
  autoPromotableSourceFields,
  sourcePromotionFieldPolicy,
} from '../lib/source-promotion-policy.mjs';

const contract = JSON.parse(readFileSync('config/canonical-contract.json', 'utf8'));
const sourcePolicy = JSON.parse(readFileSync('config/source-policy.json', 'utf8'));
const sourcePipeline = JSON.parse(readFileSync('config/source-pipeline.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function flattenedFields() {
  return Object.values(contract.fields).flat();
}

function verifySourceConfiguration() {
  const configuredSources = Object.entries(sourcePipeline.sources || {});
  const policySources = sourcePolicy.sources || {};
  assert(configuredSources.length > 0, 'source pipeline must configure at least one source');
  assert(sourcePolicy.entity === sourcePipeline.entity, 'source policy and pipeline entities must agree');

  const promotionSources = SOURCE_PROMOTION_DEFAULTS.sources;
  const priorities = promotionSources.map(source => policySources[source]?.priority);
  assert(
    priorities.every((priority, index) => Number.isFinite(priority) && (index === 0 || priority <= priorities[index - 1])),
    'source promotion order must follow descending configured priority',
  );

  for (const [source, config] of configuredSources) {
    const policy = policySources[source];
    assert(policy, `configured source is missing source policy: ${source}`);
    assert(Number.isFinite(Number(policy.priority)), `source policy priority missing: ${source}`);
    assert(Number.isFinite(Number(policy.freshness_days)) && Number(policy.freshness_days) > 0, `source freshness_days missing: ${source}`);
    assert(
      Number.isFinite(Number(policy.minimum_match_confidence))
        && Number(policy.minimum_match_confidence) >= 0
        && Number(policy.minimum_match_confidence) <= 1,
      `source minimum_match_confidence must be between 0 and 1: ${source}`,
    );
    assert(Array.isArray(config.capabilities) && config.capabilities.length > 0, `source capabilities missing: ${source}`);
    assert(typeof policy.role === 'string' && policy.role.trim(), `source policy role missing: ${source}`);
  }

  for (const source of Object.keys(policySources)) {
    assert(sourcePipeline.sources?.[source], `source policy contains an unconfigured source: ${source}`);
  }
}

function main() {
  assert(contract.version === 1, 'canonical contract version must be 1');
  assert(contract.sync_target === SUPABASE_SYNC_TARGET_TABLE, 'contract sync target disagrees with sync policy');
  assert(sameSet(contract.local_only_tables, LOCAL_ONLY_SUPABASE_TABLES), 'contract local-only tables disagree with sync policy');
  assert(contract.canonical_tables.pizza === 'pizza_places', 'pizza canonical table must be pizza_places');
  assert(contract.canonical_tables.taco === 'taco_places', 'taco canonical table must be taco_places');
  verifySourceConfiguration();

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
    source_configuration: {
      entity: sourcePipeline.entity,
      sources: Object.keys(sourcePipeline.sources || {}),
      regions: (sourcePipeline.regions || []).map(region => region.key),
    },
  }, null, 2));
}

main();
