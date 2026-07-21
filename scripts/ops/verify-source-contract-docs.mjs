#!/usr/bin/env node
/**
 * Verify that the source/provenance docs state the current operating contract.
 *
 * This guards the simplification decisions that matter most:
 * - one shared place_sources table
 * - one shared source_review_queue table
 * - both provenance/review tables stay local-only
 * - only website_url and phone are automated fill-if-blank promotions
 */

import { readFileSync } from 'fs';
import {
  LOCAL_ONLY_SUPABASE_TABLES,
  SUPABASE_SYNC_TARGET_TABLE,
} from '../lib/supabase-sync-policy.mjs';
import {
  autoPromotableSourceFields,
  sourcePromotionFieldPolicy,
} from '../lib/source-promotion-policy.mjs';
import { PIZZA_STYLES } from '../lib/pizza-style-taxonomy.mjs';

const CONTRACT_DOC = 'docs/SOURCE_PROVENANCE_SCHEMA.md';
const SOURCE_INPUTS_DOC = 'docs/SOURCE_INPUTS.md';
const DATA_SOURCES_DOC = 'docs/DATA_SOURCES.md';
const DATA_DICTIONARY_DOC = 'docs/DATA_DICTIONARY.md';
const OSM_EXPORTER = 'scripts/ops/export-osm-source.mjs';

const CANONICAL_PIZZA_STYLES = PIZZA_STYLES;
const CANONICAL_PRICE_RANGES = ['$', '$$', '$$$', '$$$$'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include: ${needle}`);
}

function assertDocMentionsPolicy(docText) {
  assertIncludes(docText, `| \`${SUPABASE_SYNC_TARGET_TABLE}\` |`, CONTRACT_DOC);

  for (const tableName of LOCAL_ONLY_SUPABASE_TABLES) {
    assertIncludes(docText, `\`${tableName}\``, CONTRACT_DOC);
    assertIncludes(docText, `\`${tableName}\` |`, CONTRACT_DOC);
  }

  assertIncludes(docText, 'Do not double the provenance tables for TacoBoutMichigan.', CONTRACT_DOC);
  assertIncludes(docText, 'Do not create separate pizza/taco copies of the provenance tables.', CONTRACT_DOC);
  assertIncludes(docText, 'Do not mirror `place_sources` or `source_review_queue` to Supabase', CONTRACT_DOC);
  assertIncludes(docText, 'Supabase Sync', CONTRACT_DOC);
}

function assertPromotionDocs(docText) {
  const autoFields = autoPromotableSourceFields();
  assert(
    JSON.stringify(autoFields) === JSON.stringify(['website_url', 'phone']),
    `Unexpected auto-promotable fields: ${autoFields.join(',')}`,
  );

  for (const field of autoFields) {
    assertIncludes(docText, `\`${field}\``, CONTRACT_DOC);
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'auto_fill_if_blank', `${field} must be fill-if-blank in policy.`);
  }

  for (const field of ['address', 'name', 'lat', 'lng', 'state', 'google_place_id']) {
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'manual_review_only', `${field} must require manual review in policy.`);
    assertIncludes(docText, `\`${field}\``, CONTRACT_DOC);
  }

  for (const field of ['style', 'price_range', 'rating', 'notes', 'status', 'photos']) {
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'blocked', `${field} must be blocked in policy.`);
    assertIncludes(docText, field, CONTRACT_DOC);
  }
}

function main() {
  const contract = read(CONTRACT_DOC);
  const sourceInputs = read(SOURCE_INPUTS_DOC);
  const dataSources = read(DATA_SOURCES_DOC);
  const dictionary = read(DATA_DICTIONARY_DOC);
  const osmExporter = read(OSM_EXPORTER);

  assertIncludes(contract, '# Source Provenance Contract', CONTRACT_DOC);
  assertIncludes(contract, '## Current Table Count', CONTRACT_DOC);
  assertIncludes(contract, '| `pizza_places` |', CONTRACT_DOC);
  assertIncludes(contract, '| `taco_places` |', CONTRACT_DOC);
  assertIncludes(contract, '| `place_sources` |', CONTRACT_DOC);
  assertIncludes(contract, '| `source_review_queue` |', CONTRACT_DOC);
  assertIncludes(contract, '## Explicit Non-Goals', CONTRACT_DOC);

  assertDocMentionsPolicy(contract);
  assertPromotionDocs(contract);

  assertIncludes(sourceInputs, 'Keep `place_sources` local-only', SOURCE_INPUTS_DOC);
  assertIncludes(osmExporter, 'disused:amenity', 'OSM closed-status query');
  assertIncludes(osmExporter, 'operating_status', 'OSM closed-status export');
  assertIncludes(sourceInputs, 'Source adapters do not promote canonical fields.', SOURCE_INPUTS_DOC);
  assertIncludes(dataSources, 'Google Maps is an outbound navigation destination, not an ingestion source.', DATA_SOURCES_DOC);
  assertIncludes(dataSources, 'Do not backfill TacoBout yet.', DATA_SOURCES_DOC);

  for (const style of CANONICAL_PIZZA_STYLES) {
    assertIncludes(dictionary, `| ${style} |`, DATA_DICTIONARY_DOC);
  }
  for (const price of CANONICAL_PRICE_RANGES) {
    assertIncludes(dictionary, `| ${price} |`, DATA_DICTIONARY_DOC);
  }
  assertIncludes(dictionary, 'The production classifier and UI currently accept only the controlled', DATA_DICTIONARY_DOC);

  console.log('# Source Contract Docs Verification');
  console.log('');
  console.log(`sync_target=${SUPABASE_SYNC_TARGET_TABLE}`);
  console.log(`local_only_tables=${LOCAL_ONLY_SUPABASE_TABLES.join(',')}`);
  console.log(`auto_promotable_fields=${autoPromotableSourceFields().join(',')}`);
  console.log(`pizza_styles=${CANONICAL_PIZZA_STYLES.join(',')}`);
  console.log(`price_ranges=${CANONICAL_PRICE_RANGES.join(',')}`);
  console.log('status=ok');
}

main();
