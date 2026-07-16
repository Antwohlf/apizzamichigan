#!/usr/bin/env node
/**
 * Verify the canonical source-promotion boundary.
 *
 * This intentionally exercises the operator CLI as a black box. The blocked
 * field checks fail during argument parsing, before any Postgres connection is
 * opened, so the verifier can run anywhere.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import {
  SOURCE_PROMOTION_DEFAULTS,
  SOURCE_PROMOTION_FIELD_POLICIES,
  autoPromotableSourceFields,
  sourcePromotionFieldPolicy,
} from '../lib/source-promotion-policy.mjs';

const SCRIPT = 'scripts/ops/promote-source-contact-fields.mjs';
const SERVER = readFileSync('server/index.js', 'utf8');
const ADMIN_PANEL = readFileSync('src/admin/AdminSourceProvenancePanel.js', 'utf8');
const ALLOWED_FIELDS = ['website_url', 'phone'];
const IDENTITY_FIELDS = ['address', 'name', 'lat', 'lng', 'state', 'google_place_id', 'brand', 'operator'];
const EVIDENCE_ONLY_FIELDS = ['menu_url', 'email', 'instagram_url', 'facebook_url', 'hours', 'delivery', 'takeaway'];
const NON_SOURCE_FIELDS = ['style', 'price', 'price_range', 'style_confidence', 'rating', 'notes', 'status', 'photos'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPromotion(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', message: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      message: String(error.stderr || error.stdout || error.message || error),
    };
  }
}

function assertRejected(field, expectedText) {
  const result = runPromotion(['--fields', field]);
  assert(!result.ok, `Expected ${field} promotion to fail.`);
  assert(
    result.message.includes(expectedText),
    `Expected ${field} failure to include "${expectedText}", got: ${result.message}`,
  );
}

function main() {
  assert(
    JSON.stringify(autoPromotableSourceFields()) === JSON.stringify(ALLOWED_FIELDS),
    `Auto-promotable fields drifted: ${autoPromotableSourceFields().join(',')}`,
  );
  assert(
    JSON.stringify(SOURCE_PROMOTION_DEFAULTS.fields) === JSON.stringify(ALLOWED_FIELDS),
    `Default fields drifted: ${SOURCE_PROMOTION_DEFAULTS.fields.join(',')}`,
  );
  assert(
    SOURCE_PROMOTION_DEFAULTS.minConfidence >= 0.9,
    `Default source promotion confidence is too low: ${SOURCE_PROMOTION_DEFAULTS.minConfidence}`,
  );
  assert(
    SOURCE_PROMOTION_DEFAULTS.maxUpdates > 0 && SOURCE_PROMOTION_DEFAULTS.maxUpdates <= 100,
    `Default source promotion apply batch is too broad: ${SOURCE_PROMOTION_DEFAULTS.maxUpdates}`,
  );
  for (const field of SOURCE_PROMOTION_DEFAULTS.matchMethods) {
    assert(field && typeof field === 'string', `Invalid match method in defaults: ${field}`);
  }

  for (const field of ALLOWED_FIELDS) {
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'auto_fill_if_blank', `${field} must be fill-if-blank only.`);
    assert(typeof policy.valid === 'function', `${field} must have a validator.`);
    assert(typeof policy.normalize === 'function', `${field} must have a normalizer.`);
    assert(Array.isArray(policy.sourceKeys) && policy.sourceKeys.length, `${field} must list source keys.`);
  }

  for (const field of IDENTITY_FIELDS) {
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'manual_review_only', `${field} must require manual review.`);
    assertRejected(field, 'Refusing to auto-promote');
  }

  for (const field of EVIDENCE_ONLY_FIELDS) {
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'evidence_only', `${field} must be evidence-only until source-specific promotion rules exist.`);
    assertRejected(field, 'Refusing to auto-promote');
  }

  for (const field of NON_SOURCE_FIELDS) {
    const policy = sourcePromotionFieldPolicy(field);
    assert(policy?.disposition === 'blocked', `${field} must be blocked from source promotion.`);
    assertRejected(field, 'Refusing to auto-promote');
  }

  assertRejected('not_a_real_field', 'Invalid --fields');

  const help = runPromotion(['--help']);
  assert(help.ok, '--help should not require Postgres.');
  assert(help.stdout.includes('Fields to promote: website_url,phone'), 'Help must list only contact promotion fields.');
  assert(help.stdout.includes('--max-updates'), 'Help must document the bounded apply guard.');
  assert(help.stdout.includes('Apply mode is intentionally bounded'), 'Help must explain that apply mode is bounded.');
  for (const field of ALLOWED_FIELDS) {
    assert(help.stdout.includes(field), `Help should mention allowed field ${field}.`);
  }

  assert(SERVER.includes('SOURCE_CONTACT_PROMOTION_PREVIEW'), 'admin API should expose a promotion preview policy.');
  assert(SERVER.includes("fields: ['website_url', 'phone']"), 'admin promotion preview should include only website_url and phone.');
  assert(SERVER.includes("sources: ['all_the_places', 'osm']"), 'admin promotion preview should use default source priority.');
  assert(SERVER.includes("matchMethods: ['exact_name_nearby', 'strong_spatial_name', 'imported_primary', 'reviewed_link', 'reviewed_new_import']"), 'admin promotion preview should use default eligible match methods.');
  assert(SERVER.includes('minConfidence: 0.9'), 'admin promotion preview should require high-confidence evidence.');
  assert(SERVER.includes('promotionCandidates'), 'admin source provenance payload should include promotion candidate preview.');
  assert(ADMIN_PANEL.includes('Contact Promotion Candidates'), 'admin panel should show contact promotion candidates.');
  assert(ADMIN_PANEL.includes('Read-only preview of blank canonical website/phone fields'), 'admin panel should state promotion preview is read-only.');
  assert(ADMIN_PANEL.includes('Apply remains a bounded local CLI action.'), 'admin panel should not expose unbounded promotion apply.');

  console.log('# Source Promotion Policy Verification');
  console.log('');
  console.log(`policy_fields=${Object.keys(SOURCE_PROMOTION_FIELD_POLICIES).length}`);
  console.log(`allowed_fields=${ALLOWED_FIELDS.join(',')}`);
  console.log(`default_apply_limit=${SOURCE_PROMOTION_DEFAULTS.maxUpdates}`);
  console.log(`blocked_identity_fields=${IDENTITY_FIELDS.join(',')}`);
  console.log(`evidence_only_fields=${EVIDENCE_ONLY_FIELDS.join(',')}`);
  console.log(`blocked_non_source_fields=${NON_SOURCE_FIELDS.join(',')}`);
  console.log('status=ok');
}

main();
