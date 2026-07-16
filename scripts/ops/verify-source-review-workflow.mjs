#!/usr/bin/env node
/**
 * Verify source review workflow safety boundaries.
 *
 * This is a static, read-only guard for the admin review flow. Runtime tests
 * cover behavior elsewhere; this protects the high-level invariants that source
 * review decisions stay conservative.
 */

import { readFileSync } from 'fs';

const SERVER = readFileSync('server/index.js', 'utf8');
const SYNC = readFileSync('scripts/sync-local-to-supabase.mjs', 'utf8');
const ADMIN = [
  readFileSync('src/admin/AdminSourceProvenancePanel.js', 'utf8'),
  readFileSync('src/admin/sourceReviewTriage.js', 'utf8'),
].join('\n');
const AUTO_LINK = readFileSync('scripts/ops/auto-link-source-review-queue.mjs', 'utf8');
const RECLASSIFY_AMBIGUOUS = readFileSync('scripts/ops/reclassify-ambiguous-source-candidates.mjs', 'utf8');
const ACCEPT_LIKELY_NEW = readFileSync('scripts/ops/accept-likely-new-source-candidates.mjs', 'utf8');
const PREFLIGHT_REVIEWED_NEW = readFileSync('scripts/ops/preflight-reviewed-new-place-import.mjs', 'utf8');
const VERIFY_REVIEWED_NEW_IMPORTS = readFileSync('scripts/ops/verify-reviewed-new-imports.mjs', 'utf8');
const POPULATE_CLASSIFY = readFileSync('scripts/enrichment/populate-classify-from-db.mjs', 'utf8');
const PROMOTION_POLICY = readFileSync('scripts/lib/source-promotion-policy.mjs', 'utf8');
const DOCS = [
  readFileSync('docs/SOURCE_INPUTS.md', 'utf8'),
  readFileSync('docs/DATA_SOURCES.md', 'utf8'),
  readFileSync('docs/SOURCE_PROVENANCE_SCHEMA.md', 'utf8'),
].join('\n');
const NORMALIZED_DOCS = DOCS.replace(/\s+/g, ' ');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(text, needles, label) {
  for (const needle of needles) {
    assert(text.includes(needle), `${label} missing: ${needle}`);
  }
}

function main() {
  includesAll(SERVER, [
    "allowedSourceReviewStatuses = new Set(['pending', 'accepted', 'linked', 'rejected', 'ignored'])",
    "allowedSourceReviewKinds = new Set(['ambiguous', 'likely_new'])",
    "status === 'accepted' ? \"AND review_kind = 'likely_new'\" : ''",
    "AND review_kind = 'ambiguous'",
    "AND nearest_place_id IS NOT NULL",
    "status = 'linked'",
    "'reviewed_new_import'",
    "review_kind = 'likely_new'",
    "status = 'accepted'",
    "reclassify-likely-new",
    "Only pending ambiguous source rows can be reclassified as likely-new candidates.",
    "review_kind = 'likely_new'",
    "decision = NULL",
    "canonical_place_id = NULL",
    "reviewed_at = NULL",
    "reviewed_by = 'admin:reclassified-likely-new'",
    'applyReviewedNewImports',
    'reportFile = (req.query?.reportFile',
    'reportFile = (req.body?.reportFile',
    'const reviewIds = parseReviewIdList(req.query?.ids)',
    'const reviewIds = parseReviewIdList(req.body?.ids)',
    'filters.push(`report_file = $${values.length}`)',
    'filters.push(`id = ANY($${values.length}::bigint[])`)',
  ], 'server review workflow');

  includesAll(SYNC, [
    'insertMissingReviewedNew',
    "match_method = 'reviewed_new_import'",
    'reviewedNewImportedIds.has(Number(local.id))',
  ], 'reviewed-new Supabase sync guard');

  includesAll(AUTO_LINK, [
    "srq.review_kind = 'ambiguous'",
    "srq.status = 'pending'",
    'srq.nearest_place_id IS NOT NULL',
    'exact_reviewed_ids',
    "'exact_reviewed_link'",
    'srq.nearest_name_score >= $2',
    'srq.nearest_distance_m <= $3',
    'ps.id IS NULL',
    'const BRAND_RULES = [',
    'args.brandRules',
    'brandRuleSql(values)',
    "reportFile: 'papa_murphys-review.json'",
    "reportFile: 'dominos_pizza_us-review.json'",
    "reportFile: 'california_pizza_kitchen-review.json'",
    "reportFile: 'papa_johns-review.json'",
    "reportFile: 'pizza_hut_us-review.json'",
    "reportFile: 'simple_simons_pizza_us-review.json'",
    "reportFile: 'foxs_pizza-review.json'",
    "reportFile: 'and_pizza-review.json'",
    "reportFile: 'round_table_pizza-review.json'",
    "'auto_reviewed_link'",
    "'auto_brand_reviewed_link'",
    "status = 'linked'",
    "decision = 'auto_linked'",
  ], 'auto-link source review guard');

  const promotionMatchMethods = SOURCE_PROMOTION_DEFAULTS_MATCH_METHODS(PROMOTION_POLICY);
  assert(!promotionMatchMethods.includes('auto_reviewed_link'), 'source promotion defaults must not include auto_reviewed_link');
  assert(!promotionMatchMethods.includes('auto_brand_reviewed_link'), 'source promotion defaults must not include auto_brand_reviewed_link');

  includesAll(RECLASSIFY_AMBIGUOUS, [
    "review_kind = 'ambiguous'",
    "status = 'pending'",
    "review_kind = 'likely_new'",
    'decision = NULL',
    'canonical_place_id = NULL',
    'reviewed_at = NULL',
    "reviewed_by = 'ops:reclassify-ambiguous-source-candidates'",
    'exact reviewed source_review_queue ids',
    'srq.id = ANY',
    'ps.id IS NULL',
    'likely_new_duplicate.id IS NULL',
    'BRAND_CONFLICT_RULES',
    'It never creates',
    'writes place_sources',
    'syncs Supabase',
  ], 'ambiguous reclassification guard');

  includesAll(ACCEPT_LIKELY_NEW, [
    "review_kind = 'likely_new'",
    "status = 'pending'",
    "status = 'accepted'",
    "decision = 'accepted'",
    "reviewed_by = 'ops:accept-likely-new-source-candidates'",
    `${READINESS_SQL_SENTINEL()} = 'candidate_ready'`,
    `${SIGNAL_COUNT_SQL_SENTINEL()} >= $2`,
    "source_data->>'region'",
    'It never imports places or writes',
  ], 'likely-new acceptance guard');

  includesAll(VERIFY_REVIEWED_NEW_IMPORTS, [
    "match_method = 'reviewed_new_import'",
    "srq.review_kind = 'likely_new'",
    "srq.status = 'linked'",
    "srq.decision = 'imported_new'",
    "p.google_place_id IS DISTINCT FROM (ps.source || ':' || ps.source_id)",
    "ps.data #>> '{imported_place,name}'",
    'linkedReviewRowsWithoutProvenance',
  ], 'reviewed-new import integrity guard');

  includesAll(PREFLIGHT_REVIEWED_NEW + ACCEPT_LIKELY_NEW + DOCS, [
    '--state <code>',
    '--report-file',
    '--ids <ids>',
    '--ready-limit',
    'candidate_ready rows selected',
  ], 'bounded source review filters');

  includesAll(POPULATE_CLASSIFY + DOCS, [
    "state && state !== '*'",
    "--state '*'",
  ], 'reviewed-new classify queue handoff');

  includesAll(ADMIN, [
    'Recommended Queue Order',
    'Review Worklist',
    'Recent Source Links',
    'Latest local place_sources evidence attached to canonical places.',
    'it does not sync raw evidence to Supabase',
    'Resolve ambiguous links',
    'Review likely-new candidates',
    'Work ambiguous rows first, then likely-new candidates.',
    'Link ambiguous source rows',
    'Accept likely-new candidates',
    'Preflight accepted likely-new rows',
    'Review as likely-new',
    'Move "${row.source_name || row.source_id}" from ambiguous-link review to likely-new review?',
    'This does not create a canonical place or source evidence.',
    'This does not create canonical places or write Supabase.',
    'This writes source evidence to place_sources.',
    'Import remains local-only through the guarded admin action or local script.',
    'Preflight source',
    'Preflight report',
    'reportFile: importPreflightReportFile',
    'Local enrichment handoff',
    'reviewedNewEnrichmentCommands(imported)',
  ], 'admin review workflow');

  includesAll(NORMALIZED_DOCS, [
    '`accepted`: pending likely-new source row looks like a future new canonical place candidate',
    '`linked`: source row should attach to an existing canonical place id',
    '`Review as likely-new`: pending ambiguous source row is probably not the',
    '`source_review_queue.review_kind` from `ambiguous` to `likely_new`',
    'leaves the row pending',
    'scripts/ops/reclassify-ambiguous-source-candidates.mjs',
    'auto-link-source-review-queue.mjs',
    '--ids 123,456',
    'does not write `place_sources`, create',
    'No decision creates canonical places or syncs anything to Supabase.',
    '`candidate_ready` rows are imported into the local canonical table',
    'verify-reviewed-new-imports.mjs',
    'does not sync Supabase.',
    '--insert-missing-reviewed-new',
    '`place_sources` and `source_review_queue` stay',
  ], 'source review docs');

  console.log('# Source Review Workflow Verification');
  console.log('');
  console.log('accepted_likely_new_only=yes');
  console.log('bulk_link_ambiguous_only=yes');
  console.log('reviewed_new_import_guard=yes');
  console.log('auto_link_ambiguous_only=yes');
  console.log('ambiguous_reclassification_only=yes');
  console.log('auto_link_not_promotable_by_default=yes');
  console.log('brand_rule_link_not_promotable_by_default=yes');
  console.log('likely_new_acceptance_no_import=yes');
  console.log('local_only_import=yes');
  console.log('status=ok');
}

function SOURCE_PROMOTION_DEFAULTS_MATCH_METHODS(policyText) {
  const match = policyText.match(/matchMethods:\s*\[([^\]]+)\]/);
  assert(match, 'source promotion defaults missing matchMethods');
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
}

function READINESS_SQL_SENTINEL() {
  return '${READINESS_SQL}';
}

function SIGNAL_COUNT_SQL_SENTINEL() {
  return '${SIGNAL_COUNT_SQL}';
}

main();
