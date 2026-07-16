#!/usr/bin/env node
/**
 * Verify FSQ review summary decisions without FSQ credentials or Postgres.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRIPT = 'scripts/ops/fsq-review-summary.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function reviewPayload(counts = {}) {
  return {
    generated_at: '2026-07-17T00:00:00.000Z',
    source: 'fsq_os_places',
    source_label: 'Foursquare OS Places',
    entity: 'pizza',
    input: 'fixture.json',
    mode: 'dry-run',
    counts: {
      inputRowsInspected: 100,
      usableActiveRows: 80,
      candidatesCompared: 50,
      canonicalRowsPrefetched: 1000,
      gridCellsBuilt: 100,
      matchedExistingPlaces: 20,
      ambiguousReviewCandidates: 5,
      likelyNewUnmatchedCandidates: 25,
      acceptedForPlaceSourcesImport: 20,
      placeSourcesRowsWritten: 0,
      ...counts,
    },
    ambiguous: [],
    likely_new: [],
  };
}

function runSummary(file, extraArgs = []) {
  const output = execFileSync(process.execPath, [SCRIPT, '--input', file, '--json', ...extraArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function writeReview(dir, name, payload) {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'apizza-fsq-summary-'));
  try {
    const useful = runSummary(writeReview(dir, 'useful', reviewPayload()));
    assert(useful.state === 'useful_overlap_and_gap_sample', `Unexpected useful state: ${useful.state}`);
    assert(useful.next_action === 'review_place_sources_import_and_likely_new_queue', `Unexpected useful next action: ${useful.next_action}`);

    const small = runSummary(writeReview(dir, 'small', reviewPayload({
      inputRowsInspected: 5,
      usableActiveRows: 3,
      candidatesCompared: 3,
      matchedExistingPlaces: 2,
      ambiguousReviewCandidates: 0,
      likelyNewUnmatchedCandidates: 1,
      acceptedForPlaceSourcesImport: 2,
    })));
    assert(small.state === 'insufficient_sample', `Unexpected small state: ${small.state}`);

    const ambiguous = runSummary(writeReview(dir, 'ambiguous', reviewPayload({
      matchedExistingPlaces: 10,
      ambiguousReviewCandidates: 30,
      likelyNewUnmatchedCandidates: 10,
      acceptedForPlaceSourcesImport: 10,
    })));
    assert(ambiguous.state === 'manual_review_first', `Unexpected ambiguous state: ${ambiguous.state}`);

    const sourceOnly = runSummary(writeReview(dir, 'source-only', reviewPayload({
      matchedExistingPlaces: 20,
      ambiguousReviewCandidates: 0,
      likelyNewUnmatchedCandidates: 2,
      acceptedForPlaceSourcesImport: 20,
    })));
    assert(sourceOnly.state === 'source_evidence_candidate', `Unexpected source-only state: ${sourceOnly.state}`);

    const gapOnly = runSummary(writeReview(dir, 'gap-only', reviewPayload({
      matchedExistingPlaces: 2,
      ambiguousReviewCandidates: 0,
      likelyNewUnmatchedCandidates: 25,
      acceptedForPlaceSourcesImport: 2,
    })));
    assert(gapOnly.state === 'gap_review_candidate', `Unexpected gap-only state: ${gapOnly.state}`);

    console.log('# FSQ Review Summary Verification');
    console.log('');
    console.log(`fixture_dir=${dir}`);
    console.log('states=useful_overlap_and_gap_sample,insufficient_sample,manual_review_first,source_evidence_candidate,gap_review_candidate');
    console.log('status=ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
