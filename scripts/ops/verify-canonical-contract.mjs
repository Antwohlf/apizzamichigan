#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import {
  CANONICAL_MIRROR_COLS,
  LIFECYCLE_COLS,
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
const entityProfiles = JSON.parse(readFileSync('config/entity-profiles.json', 'utf8'));
const sourcePolicy = JSON.parse(readFileSync('config/source-policy.json', 'utf8'));
const sourcePipeline = JSON.parse(readFileSync('config/source-pipeline.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function extractQuotedArray(source, declaration) {
  const match = source.match(new RegExp(`export const ${declaration} = \\[([\\s\\S]*?)\\]`));
  assert(match, `frontend taxonomy declaration missing: ${declaration}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(result => result[1]);
}

function extractQuotedObject(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = \\{([\\s\\S]*?)\\n\\}`));
  assert(match, `frontend taxonomy object missing: ${declaration}`);
  return Object.fromEntries([...match[1].matchAll(/(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*'([^']+)'/g)].map(result => [result[1] || result[2], result[3]]));
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

  const precedence = contract.source_precedence;
  assert(Array.isArray(precedence) && precedence.length === configuredSources.length, 'canonical source precedence must cover every configured source exactly once');
  assert(sameSet(precedence, configuredSources.map(([source]) => source)), 'canonical source precedence must match configured sources');
  const precedencePriorities = precedence.map(source => Number(policySources[source]?.priority));
  assert(
    precedencePriorities.every((priority, index) => index === 0 || priority <= precedencePriorities[index - 1]),
    'canonical source precedence must follow descending source-policy priority',
  );
}

function verifyEntityProfiles() {
  const profiles = entityProfiles.profiles || {};
  assert(entityProfiles.version === 1, 'entity profile version must be 1');
  assert(sameSet(Object.keys(profiles), contract.entities), 'entity profiles must cover exactly the canonical entities');
  const picksRule = contract.editorial_rules?.picks;
  const ratingRule = contract.editorial_rules?.rating;
  assert(ratingRule && typeof ratingRule === 'object', 'editorial rating rule is missing from the canonical contract');
  const ratingMinimum = Number(ratingRule.normal_scale?.minimum);
  const ratingMaximum = Number(ratingRule.normal_scale?.maximum);
  assert(Number.isFinite(ratingMinimum) && Number.isFinite(ratingMaximum) && ratingMinimum >= 0 && ratingMinimum < ratingMaximum, 'editorial rating scale is invalid');
  assert(ratingMaximum === 10, 'editorial rating scale must remain 0-10 unless the product contract changes explicitly');
  assert(typeof ratingRule.legacy_out_of_scale_policy === 'string' && ratingRule.legacy_out_of_scale_policy.trim(), 'legacy editorial rating policy is missing');
  assert(picksRule && typeof picksRule === 'object', 'editorial Picks rule is missing from the canonical contract');
  assert(typeof picksRule.public_label === 'string' && picksRule.public_label.trim(), 'editorial Picks public label is missing');
  assert(picksRule.minimum_rating_by_entity && typeof picksRule.minimum_rating_by_entity === 'object', 'editorial Picks thresholds are missing');
  assert(sameSet(Object.keys(picksRule.minimum_rating_by_entity), contract.entities), 'editorial Picks thresholds must cover exactly the canonical entities');

  for (const entity of contract.entities) {
    const profile = profiles[entity];
    assert(profile && typeof profile === 'object', `entity profile missing: ${entity}`);
    assert(profile.canonical_table === contract.canonical_tables[entity], `entity profile table disagrees: ${entity}`);
    assert(typeof profile.primary_classification_field === 'string' && profile.primary_classification_field.trim(), `primary classification field missing: ${entity}`);
    assert(typeof profile.taxonomy_file === 'string' && profile.taxonomy_file.trim(), `taxonomy file missing: ${entity}`);
    assert(Array.isArray(profile.regions) && profile.regions.length > 0, `entity profile regions missing: ${entity}`);
    assert(typeof profile.public_route === 'string' && profile.public_route.startsWith('/'), `public route missing: ${entity}`);
    assert(typeof profile.admin_route === 'string' && profile.admin_route.startsWith('/admin/'), `admin route missing: ${entity}`);
    const profilePicks = profile.editorial?.picks;
    const contractPicksThreshold = Number(picksRule.minimum_rating_by_entity[entity]);
    assert(profilePicks && typeof profilePicks === 'object', `editorial Picks profile missing: ${entity}`);
    assert(Number.isFinite(contractPicksThreshold) && contractPicksThreshold >= 0 && contractPicksThreshold <= 10, `editorial Picks threshold is invalid: ${entity}`);
    assert(Number(profilePicks.minimum_rating) === contractPicksThreshold, `editorial Picks threshold disagrees with canonical contract: ${entity}`);
    assert(profilePicks.label === picksRule.public_label, `editorial Picks label disagrees with canonical contract: ${entity}`);
    const sourcePipelineProfile = profile.source_pipeline;
    assert(sourcePipelineProfile && typeof sourcePipelineProfile === 'object', `source pipeline profile missing: ${entity}`);
    assert(typeof sourcePipelineProfile.enabled === 'boolean', `source pipeline enabled flag missing: ${entity}`);
    if (sourcePipelineProfile.enabled) {
      assert(typeof sourcePipelineProfile.config_file === 'string' && sourcePipelineProfile.config_file.trim(), `enabled source pipeline config missing: ${entity}`);
      assert(existsSync(sourcePipelineProfile.config_file), `enabled source pipeline config not found: ${entity}`);
    } else {
      assert(sourcePipelineProfile.config_file === null, `disabled source pipeline must not have a config file: ${entity}`);
    }

    if (entity === 'pizza' && profile.taxonomy_file.endsWith('.json')) {
      const taxonomy = JSON.parse(readFileSync(profile.taxonomy_file, 'utf8'));
      assert(Array.isArray(taxonomy.styles) && taxonomy.styles.length > 0, 'pizza taxonomy must define styles');
      assert(sameSet(taxonomy.styles, contract.allowed_values.style), 'pizza taxonomy styles disagree with canonical allowed values');
      for (const [legacy, canonical] of Object.entries(taxonomy.legacy_aliases || {})) {
        assert(taxonomy.styles.includes(canonical), `pizza taxonomy alias target is not canonical: ${legacy} -> ${canonical}`);
      }
    }
  }
}

function verifyFrontendPizzaTaxonomy() {
  const taxonomy = JSON.parse(readFileSync('config/pizza-style-taxonomy.json', 'utf8'));
  const frontendSource = readFileSync('src/data/pizzaStyles.js', 'utf8');
  const generatedSource = readFileSync('src/data/pizza-style-taxonomy.generated.js', 'utf8');
  assert(frontendSource.includes("pizza-style-taxonomy.generated"), 'frontend must import the generated canonical pizza taxonomy');
  assert(generatedSource.includes('Generated from config/pizza-style-taxonomy.json'), 'generated frontend taxonomy must identify its canonical source');
  for (const style of taxonomy.styles) {
    assert(generatedSource.includes(JSON.stringify(style)), `generated frontend taxonomy is missing style: ${style}`);
  }
  assert(Array.isArray(taxonomy.specificity_order), 'pizza taxonomy specificity order missing');
  assert(sameSet(taxonomy.specificity_order, taxonomy.styles), 'pizza specificity order must cover every canonical style exactly once');
}

function verifyPublicFieldPolicy() {
  const policy = contract.public_fields;
  assert(policy && Array.isArray(policy.base), 'public field policy is missing its base fields');
  const canonicalFields = new Set(flattenedFields());
  const generatedSource = readFileSync('src/config/public-fields.generated.js', 'utf8');
  assert(generatedSource.includes('Generated from config/canonical-contract.json'), 'generated public field policy must identify its canonical source');

  for (const field of policy.base) {
    assert(canonicalFields.has(field), `public base field is missing from canonical contract: ${field}`);
  }

  for (const entity of contract.entities) {
    const entityPolicy = policy[entity];
    assert(entityPolicy && typeof entityPolicy === 'object', `public field policy missing entity: ${entity}`);
    for (const [surface, fields] of Object.entries(entityPolicy)) {
      assert(Array.isArray(fields) && fields.length > 0, `public field policy surface is empty: ${entity}.${surface}`);
      assert(new Set(fields).size === fields.length, `public field policy contains duplicates: ${entity}.${surface}`);
      for (const field of fields) {
        assert(canonicalFields.has(field), `public field is missing from canonical contract: ${entity}.${surface}.${field}`);
        assert(generatedSource.includes(JSON.stringify(field)), `generated public field policy is missing field: ${entity}.${surface}.${field}`);
      }
    }
  }
}

function main() {
  assert(contract.version === 1, 'canonical contract version must be 1');
  assert(contract.sync_target === SUPABASE_SYNC_TARGET_TABLE, 'contract sync target disagrees with sync policy');
  assert(sameSet(contract.local_only_tables, LOCAL_ONLY_SUPABASE_TABLES), 'contract local-only tables disagree with sync policy');
  assert(contract.canonical_tables.pizza === 'pizza_places', 'pizza canonical table must be pizza_places');
  assert(contract.canonical_tables.taco === 'taco_places', 'taco canonical table must be taco_places');
  assert(contract.primary_fields?.pizza_style === 'style', 'primary pizza style field must be style');
  assert(contract.primary_fields?.price === 'price_range', 'primary price field must be price_range');
  assert(contract.primary_fields?.business_lifecycle === 'lifecycle_status', 'business lifecycle field must be lifecycle_status');
  assert(contract.primary_fields?.personal_status === 'status', 'personal status field must be status');
  assert(contract.legacy_field_aliases?.price === 'price_range', 'legacy price alias must point to price_range');
  verifyEntityProfiles();
  verifySourceConfiguration();
  verifyFrontendPizzaTaxonomy();
  verifyPublicFieldPolicy();

  const localSyncColumns = [...new Set(LOCAL_SYNC_COLS)];
  const syncColumns = [...new Set([...localSyncColumns, ...QA_DEFAULT_COLS])];
  const expectedRemoteSelect = [...new Set(['id', ...OVERWRITE_COLS, ...CANONICAL_MIRROR_COLS, ...QA_DEFAULT_COLS, ...LIFECYCLE_COLS])];
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
    entity_profiles: Object.fromEntries(Object.entries(entityProfiles.profiles).map(([entity, profile]) => [entity, {
      canonical_table: profile.canonical_table,
      primary_classification_field: profile.primary_classification_field,
      regions: profile.regions,
      source_pipeline_enabled: profile.source_pipeline.enabled,
    }])),
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
