#!/usr/bin/env node
/**
 * Read-only status report for the source/enrichment backlog.
 *
 * This is intentionally evidence-based: every status below is derived from
 * current repo files or from read-only helper output. It does not contact
 * Supabase, write Postgres, import rows, or start workers.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { summarizeOsmManifest } from '../lib/osm-refresh-summary.mjs';

function parseArgs(argv) {
  const args = { json: false, regions: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--regions') {
      args.regions = String(argv[++i] || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
      if (!args.regions.length) throw new Error('--regions requires at least one region');
    }
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/source-pipeline-readiness-report.mjs [options]

Options:
  --json   Emit machine-readable JSON
  --regions MI,NY  Limit the report to the active operating regions

Read-only. Reports current evidence for the APizzaMichigan source pipeline
backlog: matching performance, ATP readiness, review queue, FSQ status,
Supabase boundary, UI/search, and canonical promotion policy.
`);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function maybeJsonCommand(command, args, env = {}) {
  try {
    return {
      ok: true,
      value: JSON.parse(execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error.stderr || error.stdout || error.message || error).trim(),
    };
  }
}

function assertEvidence(condition, text, list) {
  if (condition) list.push(text);
}

function statusRank(status) {
  return { blocked: 0, partial: 1, ready: 2 }[status] ?? 0;
}

function minStatus(statuses) {
  return statuses.reduce((lowest, status) => (
    statusRank(status) < statusRank(lowest) ? status : lowest
  ), 'ready');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function osmResumeCommands({ bbox, step, output, manifest, maxTiles, retryFailed }) {
  const base = [
    'node',
    'scripts/ops/export-osm-tiles.mjs',
    '--bbox', bbox.join(','),
    '--step', String(step),
    '--output', output,
    '--manifest', manifest,
    '--max-tiles', String(maxTiles),
  ].map(shellQuote).join(' ');
  return {
    plan: `${base} --plan`,
    resume: `${base}${retryFailed ? ' --retry-failed' : ''}`,
  };
}

function sourceMatchingStatus(files) {
  const evidence = [];
  const missing = [];
  assertEvidence(files.sourceInput.includes('loadCanonicalPlaces'), 'source-input adapter uses loadCanonicalPlaces()', evidence);
  assertEvidence(files.sourceInput.includes('buildPrefetchTiles'), 'source-input adapter batches candidates into prefetch tiles', evidence);
  assertEvidence(files.sourceInput.includes('buildPlaceGrid'), 'source-input adapter builds an in-memory coordinate grid', evidence);
  assertEvidence(files.sourceInput.includes('nearbyPlacesFromGrid'), 'matching uses grid lookup instead of one spatial query per source row', evidence);
  assertEvidence(files.sourceInput.includes('exact_identifier_nearby') && files.sourceInput.includes('sourceIdentifierMatch'), 'matching auto-accepts exact store identifiers near the canonical location', evidence);
  assertEvidence(files.prefetchVerifier.includes('canonical_prefetch_queries'), 'prefetch verifier asserts query/tile metrics', evidence);

  if (!files.sourceInput.includes('loadCanonicalPlaces')) missing.push('batched canonical prefetch implementation');
  if (!files.sourceInput.includes('nearbyPlacesFromGrid')) missing.push('grid-based nearest-place lookup');
  if (!files.sourceInput.includes('exact_identifier_nearby') || !files.sourceInput.includes('sourceIdentifierMatch')) missing.push('exact website/phone identifier matching');
  if (!files.prefetchVerifier.includes('Source Matching Prefetch Verification')) missing.push('read-only prefetch verifier');

  return {
    item: 'Optimize source matching',
    status: missing.length ? 'partial' : 'ready',
    evidence,
    remaining: missing,
  };
}

function sourceFreshnessStatus(regions) {
  const evidence = [];
  const remaining = [];
  const advisories = [];
  const freshnessArgs = [
    'scripts/ops/source-freshness-report.mjs',
    '--json',
  ];
  if (regions?.length) freshnessArgs.push('--states', regions.join(','));
  const freshness = maybeJsonCommand(process.execPath, freshnessArgs);

  if (!freshness.ok) {
    return {
      item: 'Source evidence freshness',
      status: 'partial',
      evidence: ['source-freshness-report.mjs is configured as a read-only check'],
      remaining: [`freshness report unavailable: ${freshness.error}`],
    };
  }

  const sources = Array.isArray(freshness.value.sources) ? freshness.value.sources : [];
  evidence.push(`scope=${freshness.value.scope?.states === 'all' ? 'all states' : (freshness.value.scope?.states || []).join(', ')}`);
  evidence.push(`sources_checked=${sources.length}`);

  if (freshness.value.status && freshness.value.status !== 'ready') {
    return {
      item: 'Source evidence freshness',
      status: 'partial',
      evidence: [...evidence, `report_status=${freshness.value.status}`],
      remaining: [freshness.value.error || 'source freshness could not be verified'],
      source_freshness: freshness.value,
    };
  }

  for (const source of sources) {
    evidence.push(`${source.source}: ${source.fresh_rows}/${source.evidence_rows} fresh, ${source.stale_rows} stale, ${source.eligible_rows} eligible`);
    if (source.latest_input_files?.length) {
      evidence.push(`${source.source}: ${source.stale_rows_observed_in_latest_input || 0} stale rows observed in latest input, ${source.stale_rows_unobserved_in_latest_input || 0} unobserved`);
    }
    if (source.evidence_rows === 0) {
      remaining.push(`${source.source} has no local evidence rows`);
    } else if (source.stale_rows > 0) {
      const unobserved = Number(source.stale_rows_unobserved_in_latest_input);
      const observed = Number(source.stale_rows_observed_in_latest_input);
      if (Number.isFinite(unobserved) && unobserved === Number(source.stale_rows)) {
        advisories.push(`${source.source} has ${source.stale_rows} stale legacy rows absent from the latest input; review or archive them rather than retrying refresh`);
      } else if (Number.isFinite(observed) && observed > 0) {
        remaining.push(`${source.source} has ${observed} stale rows still present in the latest input; refresh those rows before relying on them`);
      } else {
        remaining.push(`${source.source} has ${source.stale_rows} stale evidence rows; refresh or review before relying on it`);
      }
    }
  }

  return {
    item: 'Source evidence freshness',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    advisories,
    remaining,
    source_freshness: freshness.value,
  };
}

function osmStatus(files, regions) {
  const evidence = [];
  const remaining = [];
  const nextActions = [];
  const pipelineConfig = JSON.parse(read('config/source-pipeline.json'));
  const configuredStep = Number(pipelineConfig.sources?.osm?.tile_step || 0.5);
  const configuredRegions = new Map((pipelineConfig.regions || []).map(region => [region.key, region.bbox]));
  const operatingRegions = new Set(
    (regions?.length ? regions : (pipelineConfig.operational_regions || pipelineConfig.regions || []))
      .map(region => typeof region === 'string' ? region.toUpperCase() : String(region.key).toUpperCase())
  );
  evidence.push(`operational_regions=${[...operatingRegions].join(',')}`);
  let activeManifestCount = 0;
  assertEvidence(files.osmExporter.includes('OVERPASS_ENDPOINTS'), 'OSM exporter supports endpoint failover', evidence);
  assertEvidence(files.osmExporter.includes('fetchWithHardTimeout') && files.osmExporter.includes('controller.abort()'), 'OSM exporter hard-aborts each Overpass request', evidence);
  assertEvidence(files.osmTiles.includes('manifest') && files.osmTiles.includes('rowsById'), 'OSM tiled runner supports checkpoints and deduplication', evidence);
  const configuredManifest = process.env.OSM_TILE_MANIFEST || '';
  const discoveredManifests = configuredManifest
    ? [configuredManifest]
    : (existsSync('reports/osm')
      ? readdirSync('reports/osm').filter(file => file.endsWith('.manifest.json')).map(file => `reports/osm/${file}`)
      : []);
  if (discoveredManifests.length) {
    for (const manifestPath of discoveredManifests) {
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(read(manifestPath));
      const manifestName = manifestPath.split('/').pop();
      const regionMatch = manifestName.match(/^([a-z]+)-pizza(?:\.step-[^.]+)?(?:\.json)?\.manifest\.json$/i);
      const regionKey = regionMatch?.[1]?.toUpperCase() || '';
      if (!operatingRegions.has(regionKey)) {
        evidence.push(`out_of_scope_manifest=${manifestPath}`);
        continue;
      }
      const expectedBbox = configuredRegions.get(regionKey);
      const isHistoricalStepManifest = manifestName.includes('.step-') && !configuredManifest;
      if (isHistoricalStepManifest || Number(manifest.step) !== configuredStep || (expectedBbox && JSON.stringify(manifest.bbox) !== JSON.stringify(expectedBbox))) {
        evidence.push(`superseded_tile_manifest=${manifestPath}`);
        continue;
      }
      activeManifestCount += 1;
      const refreshAfterHours = Number(pipelineConfig.sources?.osm?.refresh_after_hours || 720);
      const summary = summarizeOsmManifest(manifest, { refreshAfterHours });
      const { statuses, tileCount, staleTiles } = summary;
      evidence.push(`tile_manifest=${manifestPath}`);
      evidence.push(`tile_count=${tileCount}`);
      evidence.push(`tile_statuses=${JSON.stringify(statuses)}`);
      evidence.push(`stale_tiles=${staleTiles}`);
      if (!statuses.success) remaining.push(`${manifestPath} has no successful tiles`);
      if (statuses.failed) remaining.push(`${manifestPath}: ${statuses.failed} OSM tiles failed and need retry`);
      if (statuses.partial) {
        remaining.push(`${manifestPath}: ${statuses.partial} adaptive partial tile(s) need retry or operator review`);
      }
      if (staleTiles) remaining.push(`${manifestPath}: ${staleTiles} successful tile(s) are past the ${refreshAfterHours}-hour refresh window`);
      const { unprocessedTiles, retryableTiles } = summary;
      const osmConfig = pipelineConfig.sources?.osm || {};
      const tilesPerRun = Number(osmConfig.tiles_per_run_by_region?.[regionKey] || osmConfig.tiles_per_run || 1);
      const cadenceHours = Number(osmConfig.cadence_hours || 1);
      const refreshQueueTiles = summary.refreshQueueTiles;
      const estimatedRuns = tilesPerRun > 0 ? Math.ceil(refreshQueueTiles / tilesPerRun) : null;
      const estimatedHours = estimatedRuns === null ? null : estimatedRuns * cadenceHours;
      evidence.push(`unprocessed_tiles=${unprocessedTiles}`);
      evidence.push(`refresh_queue_tiles=${refreshQueueTiles}`);
      evidence.push(`retryable_tiles=${retryableTiles}`);
      evidence.push(`estimated_runs_remaining=${estimatedRuns ?? 'unknown'}`);
      evidence.push(`estimated_hours_remaining=${estimatedHours ?? 'unknown'}`);
      const hasRetryableTiles = Boolean(statuses.failed || statuses.partial);
      if (refreshQueueTiles > 0 || hasRetryableTiles) {
        const output = `reports/osm/${regionKey.toLowerCase()}-pizza.json`;
        const commands = expectedBbox
          ? osmResumeCommands({
            bbox: expectedBbox,
            step: configuredStep,
            output,
            manifest: manifestPath,
            maxTiles: tilesPerRun,
            retryFailed: hasRetryableTiles,
          })
          : null;
        nextActions.push({
          region: regionKey,
          manifest: manifestPath,
          unprocessed_tiles: unprocessedTiles,
          stale_tiles: staleTiles,
          refresh_queue_tiles: refreshQueueTiles,
          retryable_tiles: retryableTiles,
          failed_tiles: statuses.failed || 0,
          partial_tiles: statuses.partial || 0,
          estimated_runs: estimatedRuns,
          estimated_hours: estimatedHours,
          plan_command: commands?.plan || null,
          resume_command: commands?.resume || null,
        });
      }
      if (unprocessedTiles > 0) remaining.push(`${manifestPath} is incomplete; ${unprocessedTiles} unprocessed tiles remain`);
    }
  } else {
    remaining.push('no successful regional OSM tile manifest has been verified');
  }
  if (discoveredManifests.length && activeManifestCount === 0) {
    remaining.push('no active regional OSM tile manifest matches the configured tile geometry');
  }
  if (!files.osmExporter.includes('OVERPASS_ENDPOINTS')) remaining.push('OSM endpoint failover missing');
  if (!files.osmExporter.includes('fetchWithHardTimeout') || !files.osmExporter.includes('controller.abort()')) remaining.push('OSM request hard timeout missing');
  if (!files.osmTiles.includes('manifest')) remaining.push('resumable OSM tile runner missing');
  return { item: 'OSM regional refresh', status: remaining.length ? 'partial' : 'ready', evidence, remaining, next_actions: nextActions };
}

function atpStatus(files) {
  const manifest = JSON.parse(files.atpManifest);
  const spiders = manifest.spiders || [];
  const enabled = spiders.filter(row => row.import_enabled).map(row => row.spider);
  const gaps = spiders.filter(row => !row.import_enabled).map(row => `${row.spider}:${row.status}`);
  const desired = ['dominos_pizza_us', 'papa_johns', 'marcos'];
  const evidence = [
    `manifest=${spiders.length} spiders`,
    `import_enabled=${enabled.length}`,
  ];
  for (const spider of desired) {
    assertEvidence(enabled.includes(spider), `${spider} is import-enabled`, evidence);
  }
  assertEvidence(gaps.some(row => row.startsWith('hungry_howies:')), "Hungry Howie's documented as an ATP gap", evidence);
  assertEvidence(gaps.some(row => row.startsWith('jet:')), "Jet's documented as non-pizza/false-positive ATP gap", evidence);
  assertEvidence(files.atpVerifier.includes('ATP Batch Planning Verification'), 'ATP batch planner verifier exists', evidence);

  const remaining = [];
  if (!enabled.includes('dominos_pizza_us')) remaining.push('Domino’s spider not enabled');
  if (!enabled.includes('papa_johns')) remaining.push('Papa John’s spider not enabled');
  if (!enabled.includes('marcos')) remaining.push('Marco’s spider not enabled');
  if (!files.atpVerifier.includes('blocked_by_review')) remaining.push('batch planner does not guard pending review work');

  return {
    item: 'Continue ATP source batches',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    remaining,
  };
}

function likelyNewStatus(files) {
  const evidence = [];
  const remaining = [];
  assertEvidence(files.sourceInput.includes('likely_new'), 'source reports emit likely_new review artifacts', evidence);
  assertEvidence(files.importReviewQueue.includes("review_kind: kind"), 'review importer persists review_kind rows', evidence);
  assertEvidence(files.acceptLikelyNew.includes("review_kind = 'likely_new'"), 'likely-new acceptance is scoped to likely_new rows', evidence);
  assertEvidence(files.acceptLikelyNew.includes('It never imports places'), 'likely-new acceptance does not import canonical rows', evidence);
  assertEvidence(files.reviewWorkflowVerifier.includes('likely_new_acceptance_no_import=yes'), 'workflow verifier protects no-import acceptance boundary', evidence);

  if (!files.sourceInput.includes('likely_new')) remaining.push('likely-new artifact output missing');
  if (!files.acceptLikelyNew.includes("status = 'accepted'")) remaining.push('bounded likely-new acceptance path missing');
  if (!files.reviewWorkflowVerifier.includes('likely_new_acceptance_no_import=yes')) remaining.push('review workflow verifier missing likely-new no-import guard');

  return {
    item: 'Handle likely-new source rows',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    remaining,
  };
}

function reviewWorkflowStatus(files) {
  const evidence = [];
  const remaining = [];
  assertEvidence(files.reviewSchema.includes('CREATE TABLE IF NOT EXISTS source_review_queue'), 'source_review_queue schema exists', evidence);
  assertEvidence(files.importReviewQueue.includes('ON CONFLICT (entity_type, source, source_id, review_kind)'), 'review queue import is idempotent by source/review kind', evidence);
  assertEvidence(files.adminPanel.includes('Review Worklist'), 'admin provenance panel exposes a review worklist', evidence);
  assertEvidence(files.adminTriage.includes('buildReviewWorklist'), 'admin triage has a recommended work order', evidence);
  assertEvidence(files.reviewWorkflowVerifier.includes('admin review workflow'), 'source review workflow verifier covers admin invariants', evidence);

  if (!files.reviewSchema.includes('source_review_queue')) remaining.push('durable source_review_queue schema missing');
  if (!files.importReviewQueue.includes('--apply')) remaining.push('review artifact importer missing apply mode');
  if (!files.adminPanel.includes('Review Worklist')) remaining.push('admin review worklist not visible');

  return {
    item: 'Add review workflow for ambiguous/new rows',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    remaining,
  };
}

function fsqStatus(files) {
  const evidence = [];
  const remaining = [];
  const preflight = maybeJsonCommand(process.execPath, [
    'scripts/ops/fsq-sample-preflight.mjs',
    '--json',
  ]);

  assertEvidence(existsSync('data/source-samples/fixtures/fsq-os-places-pizza-fixture.json'), 'checked-in FSQ fixture exists', evidence);
  assertEvidence(files.fsqVerifier.includes('FSQ Sample Workflow Verification'), 'FSQ fixture/preflight verifier exists', evidence);
  assertEvidence(files.fsqPreflight.includes('portal_setup_needed'), 'FSQ preflight distinguishes incomplete Places Portal setup', evidence);
  assertEvidence(files.fsqPreflight.includes('portal_setup_steps'), 'FSQ preflight emits a concrete Places Portal setup checklist', evidence);
  assertEvidence(files.fsqPreflight.includes('portal_setup_command'), 'FSQ preflight emits the one-time Places Portal Python setup command', evidence);
  assertEvidence(files.fsqPreflight.includes('example_only'), 'FSQ preflight rejects copied example SQL as export-ready setup', evidence);
  if (preflight.ok) {
    evidence.push(`current_preflight_state=${preflight.value.state}`);
    evidence.push(`recommended_action=${preflight.value.recommended_action}`);
    if (preflight.value.input_exists) evidence.push(`sample_input=${preflight.value.input}`);
    if (preflight.value.portal_init_sql) evidence.push(`portal_init_sql=${preflight.value.portal_init_sql}`);
    if (preflight.value.portal_connection) evidence.push(`portal_connection=${preflight.value.portal_connection}`);
    if (preflight.value.portal_connection_detail) evidence.push(`portal_connection_detail=${preflight.value.portal_connection_detail}`);
    if (Array.isArray(preflight.value.portal_setup_steps)) {
      evidence.push(`portal_setup_steps=${preflight.value.portal_setup_steps.map(step => `${step.id}:${step.status}`).join(',')}`);
    }
  } else {
    remaining.push(`preflight failed: ${preflight.error}`);
  }

  const productionReady = preflight.ok
    && (preflight.value.can_export_via_hf === true || preflight.value.can_export_via_portal === true);
  if (!productionReady) {
    remaining.push(preflight.ok && preflight.value.input_exists
      ? 'FSQ is sample-ready only; configure a real HF or Places Portal export before production ingestion'
      : 'real FSQ slice/export is not ready yet');
  }

  return {
    item: 'FSQ production input path',
    status: productionReady ? 'ready' : 'partial',
    evidence,
    remaining,
  };
}

function supabaseBoundaryStatus(files) {
  const evidence = [];
  const remaining = [];
  assertEvidence(files.supabasePolicy.includes("SUPABASE_SYNC_TARGET_TABLE = 'pizza_places'"), 'sync target is pizza_places only', evidence);
  assertEvidence(files.supabasePolicy.includes("'place_sources'"), 'place_sources is listed local-only', evidence);
  assertEvidence(files.supabasePolicy.includes("'source_review_queue'"), 'source_review_queue is listed local-only', evidence);
  assertEvidence(files.supabaseVerifier.includes('verify-supabase-sync-policy'), 'Supabase sync policy verifier exists', evidence);
  assertEvidence(files.sourceDocs.includes('Keep `place_sources` local-only'), 'docs state place_sources stays local-only for now', evidence);

  if (!files.supabasePolicy.includes("'place_sources'")) remaining.push('place_sources local-only policy missing');
  if (!files.supabasePolicy.includes('assertSupabaseSyncTableBoundary')) remaining.push('sync table boundary assertion missing');

  return {
    item: 'Decide whether place_sources syncs to Supabase',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    remaining,
  };
}

function uiSearchStatus(files) {
  const evidence = [];
  const remaining = [];
  assertEvidence(files.mapControls.includes('visibleResultLimit'), 'map search has expandable result limit state', evidence);
  assertEvidence(files.mapControls.includes('Show ') && files.mapControls.includes(' more'), 'map search exposes show-more expansion', evidence);
  assertEvidence(files.app.includes('stateScopedNameTerms') && files.app.includes('adjacentNamePhrases'), 'state-scoped search preserves multi-word place/brand phrases', evidence);
  assertEvidence(files.mapControls.includes('Style match:') && files.mapControls.includes('Price match:') && files.mapControls.includes('Status match: Anthony reviewed'), 'search results explain style, price, and reviewed-status matches', evidence);
  assertEvidence(files.mapControls.includes('searchResultSummary') && files.mapControls.includes('Search result summary'), 'search results summarize reviewed places, suggestions, and near-me distance', evidence);
  assertEvidence(files.mapControls.includes('reviewedFirst') && files.mapControls.includes('Reviewed first'), 'search results can prioritize Anthony-reviewed places over suggestions', evidence);
  assertEvidence(files.mapControls.includes('setReviewedFirst(false)') && files.mapControls.includes('searchQuery]'), 'reviewed-first search sorting resets for new search result sets', evidence);
  assertEvidence(files.mapControls.includes('searchResultBadge') && files.mapControls.includes('map-result-badge'), 'search results label reviewed picks versus suggestions', evidence);
  assertEvidence(files.mapControls.includes('role="combobox"') && files.mapControls.includes('aria-activedescendant') && files.mapControls.includes('role="listbox"'), 'map search exposes keyboard results as an accessible combobox/listbox', evidence);
  assertEvidence(files.placesLayer.includes('lightboxRestoreViewport'), 'photo lightbox restores a useful active-place viewport', evidence);
  assertEvidence(files.reviewGallery.includes('INLINE_THUMB_LIMIT') && files.reviewGallery.includes('review-gallery__more-count'), 'popup photo galleries stay compact while preserving full lightbox access', evidence);
  assertEvidence(files.reviewGallery.includes('review-lightbox__thumb') && files.reviewGallery.includes('Show photo'), 'photo lightbox supports direct thumbnail navigation', evidence);
  assertEvidence(files.reviewGallery.includes('openerRef') && files.reviewGallery.includes('closeButtonRef'), 'photo lightbox manages focus on open and close', evidence);
  assertEvidence(files.reviewGallery.includes('imageState') && files.reviewGallery.includes('Photo failed to load'), 'photo lightbox has loading and failure states for large review images', evidence);
  assertEvidence(files.renderPopup.includes('Open in Google Maps') && files.renderPopup.includes('Anthony reviewed'), 'expanded map popups expose clearer status and Google Maps actions', evidence);
  assertEvidence(files.bugReport.includes('price_range') && files.bugReport.includes('Open selected place in Google Maps'), 'bug reports capture rich selected-place context from the map', evidence);
  assertEvidence(files.adminReviews.includes('Matching reviewed places'), 'admin reviews has compact matching-review selection', evidence);
  assertEvidence(files.adminReviews.includes('Selected review') && files.adminReviews.includes('selectOffset'), 'admin reviews shows the active editing target with previous/next navigation', evidence);
  assertEvidence(files.adminPanel.includes('Recent Source Links'), 'admin exposes source/provenance visibility', evidence);
  assertEvidence(files.adminPanel.includes('Export current filtered queue') && files.adminPanel.includes('currentQueueExportCommand') && files.exportReviewQueue.includes('--search'), 'admin source review queue exposes a current-filter CSV export handoff', evidence);
  assertEvidence(files.adminPanel.includes('Selected queue export command') && files.adminPanel.includes('selectedQueueExportCommand') && files.exportReviewQueue.includes('--ids'), 'admin source review queue exposes exact selected-row CSV exports', evidence);
  assertEvidence(files.adminPanel.includes('Decision checklist') && files.adminTriage.includes('reviewDecisionChecklist'), 'admin source review rows show decision checklists', evidence);
  assertEvidence(files.adminPanel.includes('selectedReviewEligibilitySummary') && files.adminPanel.includes('Selected row eligibility'), 'admin source review bulk actions show selected-row eligibility before mutation', evidence);

  if (!files.mapControls.includes('visibleResultLimit')) remaining.push('search result expansion not implemented');
  if (!files.app.includes('adjacentNamePhrases')) remaining.push('state-scoped brand search phrases not implemented');
  if (!files.mapControls.includes('searchResultSummary')) remaining.push('search result composition summary not implemented');
  if (!files.mapControls.includes('reviewedFirst')) remaining.push('reviewed-first search result prioritization not implemented');
  if (!files.mapControls.includes('setReviewedFirst(false)')) remaining.push('reviewed-first search result reset not implemented');
  if (!files.mapControls.includes('searchResultBadge')) remaining.push('reviewed/suggestion result labels not implemented');
  if (!files.mapControls.includes('aria-activedescendant')) remaining.push('search result combobox/listbox accessibility not implemented');
  if (!files.reviewGallery.includes('review-lightbox__thumb')) remaining.push('photo lightbox thumbnail navigation not implemented');
  if (!files.reviewGallery.includes('INLINE_THUMB_LIMIT')) remaining.push('compact popup photo gallery limit not implemented');
  if (!files.reviewGallery.includes('openerRef')) remaining.push('photo lightbox focus restoration not implemented');
  if (!files.reviewGallery.includes('imageState')) remaining.push('photo lightbox loading/error state not implemented');
  if (!files.bugReport.includes('price_range')) remaining.push('bug report selected-place context not implemented');
  if (!files.adminReviews.includes('Matching reviewed places')) remaining.push('admin review selector not implemented');
  if (!files.adminReviews.includes('Selected review') || !files.adminReviews.includes('selectOffset')) remaining.push('admin selected-review target summary not implemented');
  if (!files.adminPanel.includes('Export current filtered queue') || !files.exportReviewQueue.includes('--search')) remaining.push('admin source review current-filter export handoff not implemented');
  if (!files.adminPanel.includes('selectedQueueExportCommand') || !files.exportReviewQueue.includes('--ids')) remaining.push('admin source review selected-row export handoff not implemented');
  if (!files.adminTriage.includes('reviewDecisionChecklist')) remaining.push('source review decision checklists not implemented');
  if (!files.adminPanel.includes('selectedReviewEligibilitySummary')) remaining.push('admin source review selected-row eligibility summary not implemented');
  return {
    item: 'UI/search polish',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    remaining,
  };
}

function promotionPolicyStatus(files) {
  const evidence = [];
  const remaining = [];
  assertEvidence(files.promotionPolicy.includes("fields: ['website_url', 'phone']"), 'only website_url and phone are auto-fill candidates', evidence);
  assertEvidence(files.promotionPolicy.includes('manual_review_only'), 'identity fields require manual review', evidence);
  assertEvidence(files.promotionPolicy.includes('evidence_only'), 'service/social fields are evidence-only', evidence);
  assertEvidence(files.promotionPolicy.includes('blocked'), 'classifier/editorial fields are blocked from source promotion', evidence);
  assertEvidence(files.promotionVerifier.includes('Source Promotion Policy Verification'), 'promotion policy verifier exists', evidence);

  if (!files.promotionPolicy.includes("fields: ['website_url', 'phone']")) remaining.push('explicit auto-promotable field list missing');
  if (!files.promotionPolicy.includes('style_confidence')) remaining.push('style_confidence promotion boundary missing');
  if (!files.promotionVerifier.includes('blocked_non_source_fields')) remaining.push('promotion verifier missing blocked fields check');

  return {
    item: 'Canonical field promotion policy',
    status: remaining.length ? 'partial' : 'ready',
    evidence,
    remaining,
  };
}

function loadFiles() {
  return {
    sourceInput: read('scripts/ops/source-input-sample-report.mjs'),
    osmExporter: read('scripts/ops/export-osm-source.mjs'),
    osmTiles: read('scripts/ops/export-osm-tiles.mjs'),
    prefetchVerifier: read('scripts/ops/verify-source-matching-prefetch.mjs'),
    atpManifest: read('config/atp-pizza-spiders.json'),
    atpVerifier: read('scripts/ops/verify-atp-batch-planning.mjs'),
    sourceDocs: read('docs/SOURCE_INPUTS.md'),
    importReviewQueue: read('scripts/ops/import-source-review-queue.mjs'),
    acceptLikelyNew: read('scripts/ops/accept-likely-new-source-candidates.mjs'),
    reviewSchema: read('scripts/enrichment/source-review-queue-schema.sql'),
    reviewWorkflowVerifier: read('scripts/ops/verify-source-review-workflow.mjs'),
    adminPanel: read('src/admin/AdminSourceProvenancePanel.js'),
    adminTriage: read('src/admin/sourceReviewTriage.js'),
    exportReviewQueue: read('scripts/ops/export-reviewed-source-candidates.mjs'),
    fsqPreflight: read('scripts/ops/fsq-sample-preflight.mjs'),
    fsqVerifier: read('scripts/ops/verify-fsq-sample-workflow.mjs'),
    supabasePolicy: read('scripts/lib/supabase-sync-policy.mjs'),
    supabaseVerifier: read('scripts/ops/verify-supabase-sync-policy.mjs'),
    mapControls: read('src/map/MapControls.js'),
    placesLayer: read('src/map/PlacesLayer.js'),
    adminReviews: read('src/admin/AdminPhotosPanel.js'),
    promotionPolicy: read('scripts/lib/source-promotion-policy.mjs'),
    promotionVerifier: read('scripts/ops/verify-source-promotion-policy.mjs'),
    app: read('src/App.js'),
    reviewGallery: read('src/components/ReviewGallery.js'),
    renderPopup: read('src/components/map/renderPopup.tsx'),
    bugReport: read('src/components/bug-report/BugReportModal.jsx'),
  };
}

function renderMarkdown(report) {
  console.log('# Source Pipeline Readiness Report');
  console.log('');
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Overall status: ${report.overall_status}`);
  console.log('');
  console.log('| item | status | remaining |');
  console.log('| --- | --- | --- |');
  for (const row of report.items) {
    console.log(`| ${row.item} | ${row.status} | ${row.remaining.length ? row.remaining.join('; ') : 'none'} |`);
  }
  console.log('');
  for (const row of report.items) {
    console.log(`## ${row.item}`);
    console.log(`status=${row.status}`);
    console.log('');
    console.log('Evidence:');
    for (const item of row.evidence) console.log(`- ${item}`);
    if (row.remaining.length) {
      console.log('');
      console.log('Remaining:');
      for (const item of row.remaining) console.log(`- ${item}`);
    }
    if (row.advisories?.length) {
      console.log('');
      console.log('Advisories:');
      for (const item of row.advisories) console.log(`- ${item}`);
    }
    if (row.next_actions?.length) {
      console.log('');
      console.log('Next actions:');
      for (const action of row.next_actions) {
        console.log(`- ${action.region}: ${action.unprocessed_tiles} unprocessed, ${action.stale_tiles || 0} stale, ${action.failed_tiles} failed, ${action.partial_tiles} partial`);
        if (action.plan_command) console.log(`  - Read-only plan: \`${action.plan_command}\``);
        if (action.resume_command) console.log(`  - Bounded resume: \`${action.resume_command}\``);
      }
    }
    console.log('');
  }
}

function main() {
  const args = parseArgs(process.argv);
  const files = loadFiles();
  const pipelineConfig = JSON.parse(read('config/source-pipeline.json'));
  const regions = args.regions?.length ? args.regions : pipelineConfig.operational_regions;
  const items = [
    osmStatus(files, regions),
    sourceMatchingStatus(files),
    sourceFreshnessStatus(regions),
    atpStatus(files),
    likelyNewStatus(files),
    reviewWorkflowStatus(files),
    fsqStatus(files),
    supabaseBoundaryStatus(files),
    uiSearchStatus(files),
    promotionPolicyStatus(files),
  ];
  const report = {
    generated_at: new Date().toISOString(),
    overall_status: minStatus(items.map(item => item.status)),
    items,
  };

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else renderMarkdown(report);
}

main();
