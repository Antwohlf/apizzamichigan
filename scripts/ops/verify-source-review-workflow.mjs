#!/usr/bin/env node
/**
 * Verify source review workflow safety boundaries.
 *
 * This is a static, read-only guard for the admin review flow. Runtime tests
 * cover behavior elsewhere; this protects the high-level invariants that source
 * review decisions stay conservative.
 */

import { existsSync, readFileSync } from 'fs';

const SERVER = readFileSync('server/index.js', 'utf8');
const FOOD_RUNTIME_BOUNDARY = JSON.parse(readFileSync('config/food-runtime-boundary.json', 'utf8'));
const ADMIN = [
  readFileSync('src/admin/AdminSourceProvenancePanel.js', 'utf8'),
  readFileSync('src/admin/sourceReviewTriage.js', 'utf8'),
].join('\n');
const AUTO_LINK = readFileSync('scripts/ops/auto-link-source-review-queue.mjs', 'utf8');
const AI_REVIEW = readFileSync('scripts/ops/ai-source-review-triage.mjs', 'utf8');
const AI_IDENTITY = readFileSync('server/product/source-review-identity.mjs', 'utf8');
const RECLASSIFY_AMBIGUOUS = readFileSync('scripts/ops/reclassify-ambiguous-source-candidates.mjs', 'utf8');
const ACCEPT_LIKELY_NEW = readFileSync('scripts/ops/accept-likely-new-source-candidates.mjs', 'utf8');
const REVIEWED_NEW_BACKLOG = readFileSync('scripts/ops/reviewed-new-source-backlog-report.mjs', 'utf8');
const EXPORT_REVIEWED = readFileSync('scripts/ops/export-reviewed-source-candidates.mjs', 'utf8');
const PREFLIGHT_REVIEWED_NEW = readFileSync('scripts/ops/preflight-reviewed-new-place-import.mjs', 'utf8');
const VERIFY_REVIEWED_NEW_IMPORTS = readFileSync('scripts/ops/verify-reviewed-new-imports.mjs', 'utf8');
const REPLACEMENT_REPORT = readFileSync('scripts/ops/replacement-candidate-report.mjs', 'utf8');
const LIFECYCLE_REPORT = readFileSync('scripts/ops/lifecycle-quality-report.mjs', 'utf8');
const POPULATE_SCRAPE = readFileSync('scripts/enrichment/populate-scrape-from-db.mjs', 'utf8');
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
    "reclassify-replacement",
    "business_replacement",
    "lifecycle_status = 'closed'",
    "Only pending ambiguous source rows can be reclassified as likely-new candidates.",
    "review_kind = 'likely_new'",
    "decision = NULL",
    "canonical_place_id = NULL",
    "reviewed_at = NULL",
    "reviewed_by = 'admin:reclassified-likely-new'",
    'applyReviewedNewImports',
    'replacement_candidate_ready',
    'historical:${payload.googlePlaceId}',
    'reportFile = (req.query?.reportFile',
    'reportFile = (req.body?.reportFile',
    'const reviewIds = parseReviewIdList(req.query?.ids)',
    'const reviewIds = parseReviewIdList(req.body?.ids)',
    'filters.push(`report_file = $${values.length}`)',
    'filters.push(`id = ANY($${values.length}::bigint[])`)',
  ], 'server review workflow');

  assert(FOOD_RUNTIME_BOUNDARY.runtimeRepository === 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline', 'food publisher must name the external runtime repository');
  assert(FOOD_RUNTIME_BOUNDARY.runtimePackage === 'packages/food-runtime', 'food publisher must name the external runtime package');
  assert(Array.isArray(FOOD_RUNTIME_BOUNDARY.scheduledJobsOwnedBySite) && FOOD_RUNTIME_BOUNDARY.scheduledJobsOwnedBySite.length === 0, 'site must not own scheduled food jobs');
  assert(!existsSync('scripts/sync-local-to-supabase.mjs'), 'migrated Supabase publisher must not remain in the app checkout');
  includesAll(ADMIN, [
    'FOOD_PIPELINE_WORKSPACE',
    'private external runtime workspace',
    'node scripts/sync-local-to-supabase.mjs --entity ${selectedEntity}',
    '--insert-missing-reviewed-new',
    'dryRun:',
    'apply:',
  ], 'external reviewed-new publication handoff');

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
    'const includeScoreDistance = !args.brandRules || args.includeScoreDistance',
    '--include-score-distance',
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
    'INSERT INTO source_review_decision_history',
    "action,\n            reviewer_notes,\n            reviewed_by",
    "'auto_link'",
  ], 'auto-link source review guard');

  includesAll(AI_REVIEW, [
    'CREATE TABLE IF NOT EXISTS source_review_ai_assessments',
    'UNIQUE (review_queue_id, model)',
    'if (args.cache) await ensureAssessmentTable()',
    "if (args.cache && (!args.deterministicOnly || ai.decision_origin !== 'deterministic_only'))",
    "else if (args.deterministicOnly)",
    "decision_origin: 'deterministic_only'",
    "'--deterministic-only'",
    "const decisions = new Set(['same_place', 'different_place', 'business_replacement', 'uncertain'])",
    "result.needs_human_review = result.decision !== 'same_place' || result.needs_human_review !== false",
    'The decision value must be exactly one of',
  ], 'AI source review guard');
  includesAll(AI_REVIEW, [
    "from '../../server/product/source-review-identity.mjs'",
    'deterministicDecision',
    'evidenceFor',
  ], 'AI identity evidence integration');
  includesAll(AI_IDENTITY, [
    'source_website_matches',
    'source_phone_matches',
    'location_is_close',
    'matching official website',
    'matching phone number',
    'needs_human_review: true',
  ], 'AI deterministic identity rules');
  includesAll(SERVER, [
    'JOIN source_review_queue queue ON queue.id = assessment.review_queue_id',
    '(assessment.created_at < queue.updated_at) AS stale',
    "if (assessment && !assessment.stale)",
    "const identity = await import('./product/source-review-identity.mjs')",
    'const deterministic = identity.deterministicDecision(reviewRow, evidence)',
    "model: 'deterministic-identity'",
    'the UI still keeps the human decision gate.',
  ], 'AI assessment freshness and deterministic fallback guard');
  assert(!AI_REVIEW.includes('UPDATE source_review_queue'), 'AI review must not mutate queue decisions');
  assert(!AI_REVIEW.includes('INSERT INTO place_sources'), 'AI review must not write provenance');
  assert(!AI_REVIEW.includes('supabase'), 'AI review must not write Supabase');

  includesAll(REPLACEMENT_REPORT + LIFECYCLE_REPORT, [
    'unreviewed_identity_change_requires_review',
    'exact OSM',
  ], 'identity-change review labeling');

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
    '--scan-limit',
    '--nearby-radius-m',
    '--prefetch-tile-degrees',
    'buildPrefetchTiles',
    'filterImportReadyCandidates',
    'nearbyPlacesFromGrid',
    'skippedNearby',
    'canonicalPrefetchTiles',
    'canonicalPrefetchQueries',
    'It never imports places or writes',
  ], 'likely-new acceptance guard');

  includesAll(REVIEWED_NEW_BACKLOG, [
    'Read-only. Does not accept candidates',
    'strong_ready_pending',
    'nearby_canonical_review',
    'missing_required_data',
    'accept-likely-new-source-candidates.mjs',
    '--min-signals',
  ], 'reviewed-new backlog report guard');

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

  includesAll(ACCEPT_LIKELY_NEW, [
    "import { basename, resolve } from 'path'",
    'if (args.reportFile) args.reportFile = basename(args.reportFile)',
  ], 'report path normalization');

  includesAll(POPULATE_SCRAPE + POPULATE_CLASSIFY + ADMIN + DOCS, [
    "state && state !== '*'",
    "--state '*'",
    '--ids <ids>',
    '--ids ${idList}',
  ], 'reviewed-new classify queue handoff');
  assert(POPULATE_CLASSIFY.includes("NULLIF(BTRIM(google_place_id), '') IS NOT NULL"), 'classify queue population must exclude canonical rows without a source identifier');

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
    'External runtime enrichment handoff',
    'reviewedNewEnrichmentCommands(imported, { entity })',
    'Selected queue export command',
    'selectedQueueExportCommand',
  ], 'admin review workflow');

  includesAll(EXPORT_REVIEWED, [
    '--ids <id,id>',
    'srq.id = ANY',
    'IDs:',
  ], 'exact selected review queue export');

  includesAll(NORMALIZED_DOCS, [
    '`accepted`: pending likely-new source row looks like a future new canonical place candidate',
    '`linked`: source row should attach to an existing canonical place id',
    '`Review as likely-new`: pending ambiguous source row is probably not the',
    '`source_review_queue.review_kind` from `ambiguous` to `likely_new`',
    'leaves the row pending',
    'scripts/ops/reclassify-ambiguous-source-candidates.mjs',
    'auto-link-source-review-queue.mjs',
    'reviewed-new-source-backlog-report.mjs',
    '--ids 123,456',
    'does not write `place_sources`, create',
    'No decision creates canonical places or syncs anything to Supabase.',
    '`candidate_ready` rows are imported into the local canonical table',
    'verify-reviewed-new-imports.mjs',
    'does not sync Supabase.',
    'ranks `likely_new` buckets by pending `candidate_ready`',
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
