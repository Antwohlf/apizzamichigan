#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('config/source-pipeline.json', 'utf8'));
const policy = JSON.parse(readFileSync('config/source-policy.json', 'utf8'));
const plist = readFileSync('infra/local/launchd/com.apizzamichigan.source-pipeline.plist.template', 'utf8');
const runner = readFileSync('scripts/ops/run-source-pipeline.mjs', 'utf8');
const osmSummary = readFileSync('scripts/lib/osm-refresh-summary.mjs', 'utf8');
const osmSource = readFileSync('scripts/ops/export-osm-source.mjs', 'utf8');
const osmTiles = readFileSync('scripts/ops/export-osm-tiles.mjs', 'utf8');
const readiness = readFileSync('scripts/ops/source-pipeline-readiness-report.mjs', 'utf8');
const sourceQuality = readFileSync('scripts/ops/source-quality-report.mjs', 'utf8');
const lifecycleQuality = readFileSync('scripts/ops/lifecycle-quality-report.mjs', 'utf8');
const osmExtractor = readFileSync('scripts/enrichment/agents/osm-extractor.mjs', 'utf8');
const wikidataSource = readFileSync('scripts/ops/export-wikidata-source.mjs', 'utf8');
const scopeHelper = readFileSync('scripts/lib/source-pipeline-scope.mjs', 'utf8');
const autoLinkPolicy = readFileSync('scripts/lib/source-auto-link-policy.mjs', 'utf8');
const required = ['osm', 'fsq_os_places', 'all_the_places', 'overture_places', 'wikidata', 'official_website'];
const CAPABILITIES = ['discover', 'match_existing', 'enrich_evidence', 'promote_contact'];
const missing = required.filter(key => !config.sources?.[key]?.enabled);
if (missing.length) throw new Error(`missing enabled sources: ${missing.join(', ')}`);
if (!runner.includes("argv[i] === '--plan'") || !runner.includes("mode: 'plan'") || !runner.includes('if (options.plan)')) {
  throw new Error('source pipeline must expose a non-mutating --plan mode');
}
for (const key of required) {
  const capabilities = config.sources[key]?.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.length || capabilities.some(value => !CAPABILITIES.includes(value))) {
    throw new Error(`${key} must declare valid source capabilities: ${CAPABILITIES.join(', ')}`);
  }
  if (config.sources[key].auto_create && !capabilities.includes('discover')) {
    throw new Error(`${key} cannot auto-create without discover capability`);
  }
  if (!capabilities.includes('enrich_evidence')) {
    throw new Error(`${key} must contribute enrichment evidence or be disabled`);
  }
}
if (!config.sources.official_website.capabilities.includes('promote_contact')) {
  throw new Error('official_website must be the explicit contact-promotion source');
}
if (required.filter(key => config.sources[key].capabilities.includes('promote_contact')).length !== 1) {
  throw new Error('exactly one source may currently promote contact fields automatically');
}
if (config.limits.new_places_per_run !== 50 || config.limits.new_places_per_day !== 250 || config.limits.classify_queue_jobs_per_region_per_run !== 50 || config.limits.classify_partial_retry_jobs_per_region_per_run !== 0) {
  throw new Error('new-place caps and classifier feeder cap must remain bounded');
}
if (config.classifier_retry_feeder?.enabled !== true
  || config.classifier_retry_feeder.high_water !== 2
  || config.classifier_retry_feeder.batch_per_run !== 2
  || JSON.stringify(config.classifier_retry_feeder.states) !== JSON.stringify(['MI', 'NY'])) {
  throw new Error('classifier retry feeder must remain enabled and bounded to two MI/NY jobs');
}
if (config.sources.wikidata.auto_create || config.sources.official_website.auto_create) {
  throw new Error('enrichment-only sources cannot auto-create places');
}
if (Number(config.sources.osm.tile_step) !== 0.25) {
  throw new Error('OSM source pipeline must use 0.25-degree resumable tiles');
}
if (Number(config.sources.osm.cadence_hours) !== 0.25) {
  throw new Error('OSM source pipeline must run every 15 minutes while backlog remains');
}
if (Number(config.sources.osm.regions_per_run) !== 1 || !runner.includes('regionsPerRun')) {
  throw new Error('OSM source pipeline must process one region per scheduled run');
}
if (!Array.isArray(config.operational_regions) || !config.operational_regions.length
  || !runner.includes('selectSourcePipelineRegions')
  || !scopeHelper.includes('config.operational_regions')) {
  throw new Error('source pipeline must default to the configured operational regions');
}
if (Number(config.sources.overture_places.tile_step) !== 1 || Number(config.sources.overture_places.tiles_per_run) !== 1 || !runner.includes('export-overture-tiles.py')) {
  throw new Error('Overture source pipeline must use bounded resumable tiles');
}
if (Number(config.sources.osm.tiles_per_run) !== 4
  || Number(config.sources.osm.tiles_per_run_by_region?.MI) !== 12
  || Number(config.sources.osm.tiles_per_run_by_region?.NY) !== 8
  || Number(config.sources.osm.tiles_per_run_by_region?.CA) !== 2
  || Number(config.sources.osm.tiles_per_run_by_region?.TX) !== 8
  || !runner.includes('tiles_per_run_by_region')) {
  throw new Error('OSM source pipeline must use the measured regional tile budgets');
}
if (Number(config.sources.osm.refresh_after_hours) !== 720
  || Number(config.sources.osm.provenance_refresh_limit_per_run) !== 1000
  || !runner.includes('OSM_REFRESH_AFTER_HOURS')
  || !osmTiles.includes('OSM_REFRESH_AFTER_HOURS')
  || !osmSummary.includes('refreshAfterMs')
  || !osmSummary.includes('Date.parse(tile.completed_at)')
  || !osmSummary.includes('refreshQueueTiles')) {
  throw new Error('OSM source pipeline must refresh completed tiles within 30 days');
}
if (!runner.includes('summarizeOsmManifest') || !readiness.includes('summarizeOsmManifest')) {
  throw new Error('OSM source pipeline and readiness report must share manifest accounting');
}
if (!runner.includes('refresh-osm-place-sources.mjs')
  || !runner.includes('provenance_refresh_limit_per_run')
  || !runner.includes("'--states'")) {
  throw new Error('OSM source pipeline must refresh exact existing provenance independently of review queue volume');
}
if (Number(config.sources.osm.tile_timeout_ms_by_region?.NY) !== 180000 || Number(config.sources.osm.tile_timeout_ms_by_region?.TX) !== 180000 || Number(config.sources.osm.overpass_request_timeout_ms_by_region?.NY) !== 60000 || Number(config.sources.osm.overpass_request_timeout_ms_by_region?.TX) !== 60000 || !runner.includes('OSM_TILE_TIMEOUT_MS') || !runner.includes('OVERPASS_REQUEST_TIMEOUT_MS')) {
  throw new Error('OSM source pipeline must support bounded regional timeout overrides');
}
if (Number(config.sources.osm.failure_rotation_threshold) !== 1 || !runner.includes('consecutive_failures') || !runner.includes('Rotated to next region')) {
  throw new Error('OSM source pipeline must rotate regions after one consecutive failure');
}
if (policy.version !== 1 || required.some(key => !policy.sources?.[key]?.freshness_days)) {
  throw new Error('source policy must define freshness for every enabled source');
}
if (!lifecycleQuality.includes("config/source-policy.json") || !lifecycleQuality.includes('sourceFreshnessCase')) {
  throw new Error('lifecycle quality report must derive freshness windows from source policy');
}
if (!runner.includes("resolve(ROOT, 'reports/source-review'") || !runner.includes('last_error')) {
  throw new Error('source runner must pass absolute review paths and persist per-source errors');
}
if (!runner.includes('detached: false') || !runner.includes('killProcess(result.pid)')) {
  throw new Error('source adapters must remain attached so launchd restarts cannot orphan writers');
}
if (!runner.includes('LAST_DRY_RUN_PATH') || !runner.includes('options.apply ? LAST_REPORT_PATH : LAST_DRY_RUN_PATH')) {
  throw new Error('source runner must keep dry-run reports separate from applied-run health state');
}
if (!runner.includes("skipped: []") || !runner.includes("reason: 'cadence_not_due'") || !runner.includes("reason: 'max_work_units_reached'")) {
  throw new Error('source runner must report why sources were skipped');
}
if (!wikidataSource.includes("btrim(COALESCE(brand_wikidata") || !wikidataSource.includes("btrim(qid) ~ '^Q[0-9]+$'")) {
  throw new Error('Wikidata exporter must extract canonical Q identifiers from place identity fields');
}
if (!runner.includes('sourceState.region_index')
  || !runner.includes('state.sources[source]?.region_index')
  || !runner.includes('(startingRegionIndex + regionOffset + 1) % regions.length')) {
  throw new Error('source runner must advance geographic cursors independently per source');
}
if (!runner.includes('selectOsmRegion') || !runner.includes('osmBacklog') || !runner.includes('state.sources[source].region_index')) {
  throw new Error('OSM source runner must prioritize refresh backlog and advance its region cursor');
}
if (!runner.includes('sourceAutoLinkArguments')
  || !autoLinkPolicy.includes("source === 'wikidata'")
  || !autoLinkPolicy.includes("source === 'all_the_places'")
  || !autoLinkPolicy.includes("return []")) {
  throw new Error('source runner must use source-specific auto-link identity contracts');
}
if (!runner.includes('Number.isInteger(Number(sourceState.region_index))') || !runner.includes(': 0;')) {
  throw new Error('source runner must default missing geographic cursors to region zero');
}
if (!runner.includes('SOURCE_PIPELINE_RUN_SCRAPER') || !runner.includes('managed-launchd-scraper')) {
  throw new Error('source runner must delegate production scraping to the managed worker');
}
if (!runner.includes('record-website-provenance.mjs')) {
  throw new Error('source runner must record website evidence after managed scraping');
}
if (!runner.includes('populate-classify-from-db.mjs') || !runner.includes("'--skip-existing'") || !runner.includes('classify_queue_jobs_per_region_per_run') || !runner.includes('populateClassifierQueue(config, options.apply, regions)') || !runner.includes('regions.map(region => region.key)') || runner.includes("for (const state of ['MI', 'NY'])") || runner.includes("'--retry-partial'")) {
  throw new Error('source runner must feed only new bounded classifier jobs; partial retries belong to the dedicated feeder');
}
if (!runner.includes('auto-link-source-review-queue.mjs')
  || !runner.includes('sourceAutoLinkArguments')
  || !runner.includes("'--max-distance-m', '100'")
  || !runner.includes("...(config.apply ? ['--apply'] : [])")
  || !runner.includes("...(options.apply ? ['--apply'] : [])")) {
  throw new Error('source runner must auto-link only through source-specific identity contracts');
}
const autoLink = readFileSync('scripts/ops/auto-link-source-review-queue.mjs', 'utf8');
if (!autoLink.includes('includeScoreDistance && !args.exactIdentifiers && !args.exactSourceId && !args.sourceIdentity')
  || !autoLink.includes('Exact-match automation must not inherit')
  || !autoLink.includes('args.minExactIdentifiers !== 3')
  || !autoLink.includes('sourceAddress')
  || !autoLink.includes('sourcePhone')
  || !autoLink.includes('sourceWebsite')
  || !autoLink.includes('exactSourceIdReason')
  || !autoLink.includes('sourceIdentityReason')) {
  throw new Error('exact-identifier auto-link mode must exclude broad spatial/name matches');
}
if (!autoLink.includes("source_data->>'full_address'")
  || !autoLink.includes("source_data->>'phone_number'")
  || !autoLink.includes("source_data->>'website_url'")) {
  throw new Error('exact-identifier auto-link mode must accept normalized legacy source field aliases');
}
if (!autoLink.includes('--exact-source-id') || !autoLink.includes('exactSourceId')) {
  throw new Error('exact-source-id auto-link mode must be present for unchanged OSM evidence refresh');
}
const websiteProvenance = readFileSync('scripts/ops/record-website-provenance.mjs', 'utf8');
if (!websiteProvenance.includes("CONCAT('place:', id)")) {
  throw new Error('website provenance source identities must be location-scoped');
}
if (!osmSource.includes('OVERPASS_QUERY_TIMEOUT_SECONDS') || !osmSource.includes('OVERPASS_REQUEST_TIMEOUT_MS') || !osmSource.includes('fetchWithHardTimeout') || !osmSource.includes('controller.abort()') || !osmTiles.includes('OSM_TILE_TIMEOUT_MS') || !osmTiles.includes('OSM_RETRY_COOLDOWN_MS') || !osmTiles.includes('next_retry_at') || !osmTiles.includes('deferred_tiles') || !osmTiles.includes('orderedTiles') || !osmTiles.includes('retryPriority') || !osmTiles.includes('time(?:d\\s*out|out)') || !osmTiles.includes('Split only the failed tile') || !osmTiles.includes('resumeSubtiles') || !osmTiles.includes('depth >= 1') || !osmTiles.includes('Manifest bbox mismatch') || !osmTiles.includes('Manifest step mismatch') || !osmTiles.includes('planOnly') || !osmTiles.includes("mode: 'plan'") || !osmTiles.includes('process.exit(0)')) {
  throw new Error('OSM refresh must expose bounded timeouts, adaptive recovery, and a read-only plan mode');
}
if (!readiness.includes('next_actions') || !readiness.includes('plan_command') || !readiness.includes('resume_command') || !readiness.includes('osmResumeCommands')) {
  throw new Error('source readiness must expose actionable OSM plan and resume commands');
}
if (!readiness.includes('source-freshness-report.mjs')
  || !readiness.includes('Source evidence freshness')
  || !readiness.includes('stale evidence rows')
  || !readiness.includes('advisories')
  || !readiness.includes('Advisories:')
  || !readiness.includes('no local evidence rows')) {
  throw new Error('source readiness must expose actionable source freshness status');
}
if (!sourceQuality.includes("source_data->>'latitude'")
  || !sourceQuality.includes("source_data->>'lon'")
  || !sourceQuality.includes("source_data->>'longitude'")) {
  throw new Error('source quality conflict checks must accept normalized coordinate aliases');
}
if (!osmExtractor.includes("tags['disused:amenity']")
  || !osmExtractor.includes("tags['abandoned:amenity']")
  || !osmExtractor.includes("tags['demolished:amenity']")
  || !osmExtractor.includes('recordMeaningfulChange')
  || !osmExtractor.includes('osm_change:')) {
  throw new Error('OSM deep extraction must preserve closure and replacement evidence');
}
if (!runner.includes('OSM_PIPELINE_TIMEOUT_MS') || !runner.includes('1200000')) {
  throw new Error('OSM parent stage must expose a 20-minute bounded timeout');
}
if (!osmTiles.includes('detached: false') || !osmTiles.includes("child.kill('SIGKILL')")) {
  throw new Error('OSM tile workers must stay attached and be killed directly on timeout');
}
if (!plist.includes('run-source-pipeline.mjs --apply') || !plist.includes('<integer>900</integer>') || !plist.includes('<key>OVERPASS_QUERY_TIMEOUT_SECONDS</key>') || !plist.includes('<string>90</string>') || !plist.includes('<key>OSM_TILE_TIMEOUT_MS</key>') || !plist.includes('<string>180000</string>')) {
  throw new Error('launchd template must run the applied pipeline every 15 minutes');
}
console.log(JSON.stringify({
  status: 'ok',
  sources: required,
  caps: { per_run: config.limits.new_places_per_run, per_day: config.limits.new_places_per_day },
  policy_version: policy.version,
  capabilities: Object.fromEntries(required.map(key => [key, config.sources[key].capabilities])),
  schedule: 'every 15 minutes',
}));
