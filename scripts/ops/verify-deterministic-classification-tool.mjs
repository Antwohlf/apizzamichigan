#!/usr/bin/env node
/**
 * Static contract checks for the deterministic classification ops tool.
 */

import { readFileSync } from 'fs';

const TOOL = 'scripts/ops/apply-deterministic-classification.mjs';
const text = readFileSync(TOOL, 'utf8');

function assertIncludes(needle, label = needle) {
  if (!text.includes(needle)) throw new Error(`${TOOL} missing ${label}`);
}

function assertMatches(pattern, label = pattern.source) {
  if (!pattern.test(text)) throw new Error(`${TOOL} missing ${label}`);
}

assertIncludes("import { inferPriceFromChain, inferStyleFromName } from '../lib/style-inference.mjs';", 'style inference import');
assertIncludes('Default mode is dry-run.', 'dry-run help text');
assertIncludes('Use --ids or both --min-place-id and --max-place-id.', 'exact scope guard');
assertIncludes('Use --ids or an ID range, not both.', 'ambiguous scope guard');
assertIncludes('It never writes Supabase.', 'Supabase safety text');
assertMatches(/UPDATE pizza_places\s+SET style = COALESCE\(style, \$2\),/, 'fill-if-null local style update');
assertIncludes("style_confidence = COALESCE(style_confidence, $4)", 'fill-if-null confidence update');
assertIncludes("styleResult.style ? 'inferred' : null", 'inferred confidence policy');
assertIncludes('last_enriched_at = NOW()', 'local enrichment timestamp');
assertIncludes('if (args.json) console.log(JSON.stringify(payload, null, 2));', 'json report mode');

console.log('# Deterministic Classification Tool Verification');
console.log('dry_run_default=yes');
console.log('exact_scope_required=yes');
console.log('local_only_update=yes');
console.log('fill_if_null=yes');
console.log('status=ok');
