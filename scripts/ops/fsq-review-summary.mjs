#!/usr/bin/env node
/**
 * Summarize a completed FSQ OS Places sample review artifact.
 *
 * This is read-only. It consumes the JSON written by source-input-sample-report
 * and turns the counts into an operator decision before any FSQ evidence is
 * imported into place_sources.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function parseArgs(argv) {
  const args = {
    input: 'reports/source-review/fsq-os-places-review.json',
    minCandidates: 25,
    minAccepted: 5,
    minLikelyNew: 5,
    maxAmbiguousRate: 0.35,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--min-candidates') args.minCandidates = parseInt(argv[++i], 10);
    else if (arg === '--min-accepted') args.minAccepted = parseInt(argv[++i], 10);
    else if (arg === '--min-likely-new') args.minLikelyNew = parseInt(argv[++i], 10);
    else if (arg === '--max-ambiguous-rate') args.maxAmbiguousRate = parseFloat(argv[++i]);
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) throw new Error('Missing --input');
  if (!Number.isFinite(args.minCandidates) || args.minCandidates < 1) throw new Error('Invalid --min-candidates');
  if (!Number.isFinite(args.minAccepted) || args.minAccepted < 0) throw new Error('Invalid --min-accepted');
  if (!Number.isFinite(args.minLikelyNew) || args.minLikelyNew < 0) throw new Error('Invalid --min-likely-new');
  if (!Number.isFinite(args.maxAmbiguousRate) || args.maxAmbiguousRate < 0 || args.maxAmbiguousRate > 1) {
    throw new Error('Invalid --max-ambiguous-rate');
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/fsq-review-summary.mjs [options]

Options:
  --input <file>              FSQ review JSON from source-input-sample-report
                              (default reports/source-review/fsq-os-places-review.json)
  --min-candidates <n>        Minimum pizza-ish active candidates before judging
                              sample quality (default 25)
  --min-accepted <n>          Existing-place matches needed to justify source
                              evidence import review (default 5)
  --min-likely-new <n>        Likely-new rows needed to justify new-place review
                              (default 5)
  --max-ambiguous-rate <n>    Max ambiguous/(matched+ambiguous+likely_new)
                              before manual duplicate review first (default 0.35)
  --json                      Emit machine-readable JSON

Read-only. Does not import FSQ evidence, mutate canonical tables, or sync Supabase.
`);
}

function readReview(path) {
  const absPath = resolve(process.cwd(), path);
  if (!existsSync(absPath)) {
    throw new Error(`FSQ review artifact not found: ${path}`);
  }
  const payload = JSON.parse(readFileSync(absPath, 'utf8'));
  if (payload.source !== 'fsq_os_places') {
    throw new Error(`Expected source=fsq_os_places, got ${payload.source || '(missing)'}`);
  }
  return payload;
}

function count(payload, key) {
  const value = Number(payload?.counts?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function recommendation(payload, args) {
  const compared = count(payload, 'candidatesCompared');
  const matched = count(payload, 'matchedExistingPlaces');
  const ambiguous = count(payload, 'ambiguousReviewCandidates');
  const likelyNew = count(payload, 'likelyNewUnmatchedCandidates');
  const accepted = count(payload, 'acceptedForPlaceSourcesImport');
  const decided = matched + ambiguous + likelyNew;
  const ambiguousRate = pct(ambiguous, decided);

  if (compared < args.minCandidates) {
    return {
      state: 'insufficient_sample',
      next_action: 'export_larger_fsq_sample',
      reason: `Only ${compared} pizza-ish active candidates were compared; minimum is ${args.minCandidates}.`,
      ambiguousRate,
    };
  }

  if (ambiguousRate > args.maxAmbiguousRate) {
    return {
      state: 'manual_review_first',
      next_action: 'review_ambiguous_fsq_candidates',
      reason: `Ambiguous rate ${(ambiguousRate * 100).toFixed(1)}% exceeds ${(args.maxAmbiguousRate * 100).toFixed(1)}%.`,
      ambiguousRate,
    };
  }

  if (accepted >= args.minAccepted && likelyNew >= args.minLikelyNew) {
    return {
      state: 'useful_overlap_and_gap_sample',
      next_action: 'review_place_sources_import_and_likely_new_queue',
      reason: `${accepted} existing-place source links and ${likelyNew} likely-new rows meet thresholds.`,
      ambiguousRate,
    };
  }

  if (accepted >= args.minAccepted) {
    return {
      state: 'source_evidence_candidate',
      next_action: 'dry_run_fsq_place_sources_import',
      reason: `${accepted} existing-place source links meet threshold ${args.minAccepted}.`,
      ambiguousRate,
    };
  }

  if (likelyNew >= args.minLikelyNew) {
    return {
      state: 'gap_review_candidate',
      next_action: 'import_fsq_likely_new_rows_to_review_queue',
      reason: `${likelyNew} likely-new rows meet threshold ${args.minLikelyNew}.`,
      ambiguousRate,
    };
  }

  return {
    state: 'low_incremental_value',
    next_action: 'try_broader_or_different_fsq_sample',
    reason: `Accepted links (${accepted}) and likely-new rows (${likelyNew}) are below thresholds.`,
    ambiguousRate,
  };
}

function buildSummary(payload, args) {
  const rec = recommendation(payload, args);
  const counts = payload.counts || {};
  return {
    source: payload.source,
    source_label: payload.source_label,
    entity: payload.entity,
    input: payload.input,
    review_artifact: args.input,
    generated_at: payload.generated_at,
    mode: payload.mode,
    thresholds: {
      minCandidates: args.minCandidates,
      minAccepted: args.minAccepted,
      minLikelyNew: args.minLikelyNew,
      maxAmbiguousRate: args.maxAmbiguousRate,
    },
    counts,
    rates: {
      usableActiveRate: pct(counts.usableActiveRows, counts.inputRowsInspected),
      pizzaCandidateRate: pct(counts.candidatesCompared, counts.usableActiveRows),
      matchedRate: pct(counts.matchedExistingPlaces, counts.candidatesCompared),
      ambiguousRate: rec.ambiguousRate,
      likelyNewRate: pct(counts.likelyNewUnmatchedCandidates, counts.candidatesCompared),
    },
    state: rec.state,
    next_action: rec.next_action,
    reason: rec.reason,
  };
}

function printText(summary) {
  const rate = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
  console.log('# FSQ Review Summary');
  console.log('');
  console.log(`state=${summary.state}`);
  console.log(`next_action=${summary.next_action}`);
  console.log(`reason=${summary.reason}`);
  console.log(`review_artifact=${summary.review_artifact}`);
  console.log(`input=${summary.input}`);
  console.log(`mode=${summary.mode}`);
  console.log('');
  console.log('## Counts');
  for (const [key, value] of Object.entries(summary.counts)) {
    console.log(`${key}=${value}`);
  }
  console.log('');
  console.log('## Rates');
  for (const [key, value] of Object.entries(summary.rates)) {
    console.log(`${key}=${rate(value)}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const payload = readReview(args.input);
  const summary = buildSummary(payload, args);
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else printText(summary);
}

main();
