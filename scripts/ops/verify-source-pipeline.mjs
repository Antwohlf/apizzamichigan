#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('config/source-pipeline.json', 'utf8'));
const policy = JSON.parse(readFileSync('config/source-policy.json', 'utf8'));
const plist = readFileSync('infra/local/launchd/com.apizzamichigan.source-pipeline.plist.template', 'utf8');
const runner = readFileSync('scripts/ops/run-source-pipeline.mjs', 'utf8');
const osmSource = readFileSync('scripts/ops/export-osm-source.mjs', 'utf8');
const osmTiles = readFileSync('scripts/ops/export-osm-tiles.mjs', 'utf8');
const required = ['osm', 'fsq_os_places', 'all_the_places', 'overture_places', 'wikidata', 'official_website'];
const CAPABILITIES = ['discover', 'match_existing', 'enrich_evidence', 'promote_contact'];
const missing = required.filter(key => !config.sources?.[key]?.enabled);
if (missing.length) throw new Error(`missing enabled sources: ${missing.join(', ')}`);
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
if (config.limits.new_places_per_run !== 50 || config.limits.new_places_per_day !== 250) {
  throw new Error('new-place caps must remain 50/run and 250/day');
}
if (config.sources.wikidata.auto_create || config.sources.official_website.auto_create) {
  throw new Error('enrichment-only sources cannot auto-create places');
}
if (Number(config.sources.osm.tile_step) !== 0.25) {
  throw new Error('OSM source pipeline must use 0.25-degree resumable tiles');
}
if (Number(config.sources.osm.failure_rotation_threshold) !== 1 || !runner.includes('consecutive_failures') || !runner.includes('Rotated to next region')) {
  throw new Error('OSM source pipeline must rotate regions after one consecutive failure');
}
if (policy.version !== 1 || required.some(key => !policy.sources?.[key]?.freshness_days)) {
  throw new Error('source policy must define freshness for every enabled source');
}
if (!runner.includes("resolve(ROOT, 'reports/source-review'") || !runner.includes('last_error')) {
  throw new Error('source runner must pass absolute review paths and persist per-source errors');
}
if (!runner.includes('sourceState.region_index') || !runner.includes('region_index: (Number(state.sources[source]?.region_index || 0) + 1) % config.regions.length')) {
  throw new Error('source runner must advance geographic cursors independently per source');
}
if (!runner.includes('SOURCE_PIPELINE_RUN_SCRAPER') || !runner.includes('managed-launchd-scraper')) {
  throw new Error('source runner must delegate production scraping to the managed worker');
}
if (!runner.includes('record-website-provenance.mjs')) {
  throw new Error('source runner must record website evidence after managed scraping');
}
const websiteProvenance = readFileSync('scripts/ops/record-website-provenance.mjs', 'utf8');
if (!websiteProvenance.includes("CONCAT('place:', id)")) {
  throw new Error('website provenance source identities must be location-scoped');
}
if (!osmSource.includes('OVERPASS_QUERY_TIMEOUT_SECONDS') || !osmSource.includes('OVERPASS_REQUEST_TIMEOUT_MS') || !osmTiles.includes('OSM_TILE_TIMEOUT_MS') || !osmTiles.includes('OSM_RETRY_COOLDOWN_MS') || !osmTiles.includes('next_retry_at') || !osmTiles.includes('deferred_tiles') || !osmTiles.includes('Split only the failed tile') || !osmTiles.includes('resumeSubtiles') || !osmTiles.includes('depth >= 1') || !osmTiles.includes('Manifest bbox mismatch') || !osmTiles.includes('Manifest step mismatch')) {
  throw new Error('OSM refresh must expose bounded timeouts and adaptive tile recovery');
}
if (!plist.includes('run-source-pipeline.mjs --apply') || !plist.includes('<integer>3600</integer>')) {
  throw new Error('launchd template must run the applied pipeline hourly');
}
console.log(JSON.stringify({
  status: 'ok',
  sources: required,
  caps: { per_run: config.limits.new_places_per_run, per_day: config.limits.new_places_per_day },
  policy_version: policy.version,
  capabilities: Object.fromEntries(required.map(key => [key, config.sources[key].capabilities])),
  schedule: 'hourly',
}));
