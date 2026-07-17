#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = resolve(ROOT, 'config/source-pipeline.json');
const STATE_PATH = resolve(ROOT, 'scripts/.source-pipeline-state.json');
const LOCK_PATH = '/tmp/apizzamichigan/source-pipeline.lock';
const NODE = process.execPath;

function args(argv) {
  const out = { apply: false, source: 'all', maxWorkUnits: 2, maxNewPlaces: 5, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--apply') out.apply = true;
    else if (argv[i] === '--dry-run') out.apply = false;
    else if (argv[i] === '--source') out.source = argv[++i];
    else if (argv[i] === '--max-work-units') out.maxWorkUnits = Number(argv[++i]);
    else if (argv[i] === '--max-new-places') out.maxNewPlaces = Number(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--help') { console.log('Usage: node scripts/ops/run-source-pipeline.mjs [--dry-run|--apply] [--source key|all] [--max-work-units n] [--max-new-places n] [--json]'); process.exit(0); }
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(out.maxWorkUnits) || out.maxWorkUnits < 1) throw new Error('Invalid --max-work-units');
  if (!Number.isInteger(out.maxNewPlaces) || out.maxNewPlaces < 0) throw new Error('Invalid --max-new-places');
  return out;
}

function loadJson(path, fallback) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; }
function saveJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function run(command, commandArgs, { timeout = 120000, env = process.env } = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8', env, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed: ${String(result.stderr || result.stdout).trim().slice(-3000)}`);
  return String(result.stdout || '').trim();
}
function acquireLock() {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  try { mkdirSync(LOCK_PATH); writeFileSync(`${LOCK_PATH}/owner.json`, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); return true; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = null;
    try { owner = loadJson(`${LOCK_PATH}/owner.json`, null); } catch { owner = null; }
    if (owner?.pid && !isProcessAlive(owner.pid)) {
      rmSync(LOCK_PATH, { recursive: true, force: true });
      try { mkdirSync(LOCK_PATH); writeFileSync(`${LOCK_PATH}/owner.json`, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); return true; }
      catch (retryError) { if (retryError.code === 'EEXIST') return false; throw retryError; }
    }
    return false;
  }
}
function isProcessAlive(pid) {
  try { process.kill(Number(pid), 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
function releaseLock() { rmSync(LOCK_PATH, { recursive: true, force: true }); }
function due(entry, now) { return !entry?.last_success || (now - Date.parse(entry.last_success)) >= entry.cadence_hours * 3600000; }
function stampReport(source, region, output) {
  const report = resolve(ROOT, 'reports/source-review', `${source}-${region}-review.json`);
  return { input: output, report, reportFile: basename(report) };
}
function assertSourceCapabilities(source, sourceConfig, required) {
  const capabilities = sourceConfig?.capabilities || [];
  if (!required.every(capability => capabilities.includes(capability))) {
    throw new Error(`Source ${source} lacks required capabilities: ${required.join(', ')}`);
  }
}
function splitBbox(bbox) {
  const [south, west, north, east] = bbox;
  const tiles = [];
  for (let lat = 0; lat < 4; lat += 1) {
    for (let lng = 0; lng < 4; lng += 1) {
      tiles.push([
        south + ((north - south) * lat) / 4,
        west + ((east - west) * lng) / 4,
        south + ((north - south) * (lat + 1)) / 4,
        west + ((east - west) * (lng + 1)) / 4,
      ]);
    }
  }
  return tiles;
}
function runAdapter(source, region, output, config, state) {
  const [south, west, north, east] = region.bbox;
  if (source === 'osm') {
    // Keep the regional export and manifest stable across hourly runs. The
    // tiled runner resumes completed Overpass tiles instead of re-querying a
    // whole region or losing progress when one endpoint fails.
    const regionalOutput = resolve(ROOT, 'reports/osm', `${region.key.toLowerCase()}-pizza.json`);
    const manifest = `${regionalOutput}.manifest.json`;
    mkdirSync(dirname(regionalOutput), { recursive: true });
    run(NODE, [
      'scripts/ops/export-osm-tiles.mjs',
      '--bbox', region.bbox.join(','),
      '--step', String(config.sources.osm.tile_step || 0.5),
      '--max-tiles', String(config.sources.osm.tiles_per_run || 1),
      '--output', regionalOutput,
      '--manifest', manifest,
    ], { timeout: 900000 });
    writeFileSync(output, readFileSync(regionalOutput));
  } else if (source === 'overture_places') {
    run(resolve(ROOT, 'scripts/.fsq-venv/bin/python'), ['scripts/ops/export-overture-source.py', '--bbox', region.bbox.join(','), '--output', output, '--limit', String(config.limits.candidate_rows_per_source)], { timeout: 1200000 });
  } else if (source === 'wikidata') {
    run(NODE, ['scripts/ops/export-wikidata-source.mjs', '--output', output, '--limit', String(config.sources.wikidata.rows_per_run || 50)], { timeout: 240000 });
  } else if (source === 'fsq_os_places') {
    run(resolve(ROOT, 'scripts/.fsq-venv/bin/python'), ['scripts/ops/export-fsq-hf-parquet-sample.py', '--query', '', '--country', 'US', '--max-files', String(config.sources.fsq_os_places.max_files), '--limit', String(config.limits.candidate_rows_per_source), '--output', output], { timeout: 1800000 });
  } else throw new Error(`No adapter for ${source}`);
  const paths = stampReport(source, region.key, output);
  run(NODE, ['scripts/ops/source-input-sample-report.mjs', '--source', source, '--input', paths.input, '--entity', config.entity, '--max-distance-m', '100', '--limit', String(config.limits.candidate_rows_per_source), '--sample', '10', '--review-output', paths.report, ...(config.apply ? ['--apply'] : [])], { timeout: 600000 });
  if (config.apply) run(NODE, ['scripts/ops/import-source-review-queue.mjs', '--input-files', paths.report, '--entity', config.entity, '--apply'], { timeout: 180000 });
  return paths;
}
function runAtp(region, config, state, apply, maxSpiders) {
  const manifest = loadJson(resolve(ROOT, 'config/atp-pizza-spiders.json'), { spiders: [] });
  const enabled = manifest.spiders.filter(row => row.import_enabled && row.status === 'active').map(row => row.spider);
  const index = Number(state.all_the_places?.spider_index || 0) % Math.max(enabled.length, 1);
  const selected = Array.from({ length: Math.min(maxSpiders, enabled.length) }, (_, i) => enabled[(index + i) % enabled.length]);
  if (!selected.length) return null;
  const command = ['scripts/ops/import-atp-spiders.mjs', '--spiders', selected.join(','), '--entity', config.entity, '--import-review-queue', ...(apply ? ['--apply', '--apply-review-queue'] : [])];
  const output = run(NODE, command, { timeout: 900000 });
  return { selected, output };
}
function processNew(reportFile, source, config, apply, maxNewPlaces) {
  const sourceConfig = config.sources[source];
  if (!apply || !sourceConfig?.auto_create || maxNewPlaces <= 0) return;
  assertSourceCapabilities(source, sourceConfig, ['discover', 'enrich_evidence']);
  run(NODE, ['scripts/ops/process-reviewed-new-batch.mjs', '--entity', config.entity, '--source', source, '--report-file', reportFile, '--min-signals', '4', '--accept-limit', String(maxNewPlaces), '--import-limit', String(maxNewPlaces), '--nearby-radius-m', '150', '--apply', '--run-scrape'], { timeout: 900000 });
}
function runWebsiteDrain(config, apply) {
  if (!apply || !config.sources.official_website.enabled) return 'dry-run';
  // The launchd scraper is the single production owner of website jobs. Do
  // not start a second foreground worker from the hourly source pipeline.
  // Operators can still opt into a bounded manual drain when diagnosing a
  // scraper-specific issue.
  if (process.env.SOURCE_PIPELINE_RUN_SCRAPER !== '1') {
    run(NODE, ['scripts/ops/record-website-provenance.mjs', '2'], { timeout: 180000 });
    return 'managed-launchd-scraper';
  }
  const env = { ...process.env, SCRAPE_REQUEUE_BATCH: '0', SCRAPE_MAX_JOBS: String(config.limits.website_jobs_per_run), SCRAPE_CANT_SCRAPE_LOG: '/tmp/apizzamichigan/scrape-cant-scrape.jsonl' };
  const output = run(NODE, ['scripts/enrichment/agents/web-scraper.mjs', '--worker-id', 'source-pipeline-scraper', '--max-jobs', String(config.limits.website_jobs_per_run)], { timeout: 1200000, env });
  run(NODE, ['scripts/ops/record-website-provenance.mjs', '2'], { timeout: 180000 });
  return output.slice(-1000);
}

const options = args(process.argv);
const config = loadJson(CONFIG_PATH, null);
if (!config) throw new Error(`Missing ${CONFIG_PATH}`);
if (!acquireLock()) { console.log('source pipeline already running; exiting'); process.exit(0); }
const now = Date.now();
const state = loadJson(STATE_PATH, { sources: {}, region_index: 0, last_run: null });
const selected = options.source === 'all' ? Object.keys(config.sources) : options.source.split(',').map(value => value.trim());
const report = { started_at: new Date(now).toISOString(), mode: options.apply ? 'apply' : 'dry-run', work_units: [], errors: [] };
let workUnits = 0;
try {
  for (const source of selected) {
    if (workUnits >= options.maxWorkUnits || !config.sources[source]?.enabled || !due({ ...config.sources[source], ...state.sources[source] }, now)) continue;
    const sourceState = state.sources[source] || {};
    // Each source owns its geographic cursor. A failed OSM tile or an
    // intentionally slower source must not advance the region schedule for
    // every other adapter.
    const rotationThreshold = Number(config.sources[source]?.failure_rotation_threshold || 0);
    if (rotationThreshold > 0
      && Number(sourceState.consecutive_failures || 0) >= rotationThreshold
      && config.regions.length > 1) {
      sourceState.region_index = (Number(sourceState.region_index || 0) + 1) % config.regions.length;
      sourceState.consecutive_failures = 0;
      sourceState.last_error = `${sourceState.last_error || 'source failure'}\nRotated to next region before retry after ${rotationThreshold} consecutive failures; prior region remains resumable.`;
      state.sources[source] = sourceState;
    }
    const region = config.regions[sourceState.region_index % config.regions.length];
    try {
      const sourceConfig = config.sources[source];
      if (!sourceConfig?.capabilities?.includes('enrich_evidence')) {
        throw new Error(`Source ${source} is enabled without enrich_evidence capability`);
      }
      if (source === 'official_website') {
        assertSourceCapabilities(source, sourceConfig, ['match_existing', 'enrich_evidence']);
        report.website = runWebsiteDrain(config, options.apply);
        state.sources[source] = {
          ...(state.sources[source] || {}),
          last_attempt: new Date().toISOString(),
          last_success: new Date().toISOString(),
          last_error: null,
        };
        continue;
      }
      if (source === 'all_the_places') {
        assertSourceCapabilities(source, sourceConfig, ['discover', 'match_existing', 'enrich_evidence']);
        const result = runAtp(region, config, state.sources, options.apply, config.sources[source].spiders_per_run || 3);
        report.work_units.push({ source, region: region.key, spiders: result?.selected || [] });
        for (const spider of result?.selected || []) {
          processNew(resolve(ROOT, 'reports/source-review', `${spider}-review.json`), source, config, options.apply, options.maxNewPlaces);
        }
        state.sources[source] = {
          ...(state.sources[source] || {}),
          last_success: new Date().toISOString(),
          spider_index: (Number(state.sources[source]?.spider_index || 0) + (result?.selected?.length || 0)),
          region_index: (Number(state.sources[source]?.region_index || 0) + 1) % config.regions.length,
        };
      } else {
        assertSourceCapabilities(source, sourceConfig, ['match_existing', 'enrich_evidence']);
        if (sourceConfig.auto_create) assertSourceCapabilities(source, sourceConfig, ['discover']);
        const output = resolve(ROOT, 'data/source-inputs', `${source}-${region.key}-${now}.json`);
        mkdirSync(dirname(output), { recursive: true });
        const paths = runAdapter(source, region, output, { ...config, apply: options.apply }, state);
        report.work_units.push({ source, region: region.key, report_file: paths.reportFile });
        processNew(paths.report, source, config, options.apply, options.maxNewPlaces);
        state.sources[source] = { ...(state.sources[source] || {}), last_success: new Date().toISOString(), region_index: (Number(state.sources[source]?.region_index || 0) + 1) };
      }
      state.sources[source] = {
        ...(state.sources[source] || {}),
        last_attempt: new Date().toISOString(),
        last_error: null,
        consecutive_failures: 0,
      };
      workUnits += 1;
    } catch (error) {
      const message = error?.stack || error?.message || String(error);
      report.errors.push({ source, message });
      state.sources[source] = {
        ...(state.sources[source] || {}),
        last_attempt: new Date().toISOString(),
        last_error: message.slice(-5000),
      };
      const failures = Number(state.sources[source].consecutive_failures || 0) + 1;
      const rotationThreshold = Number(config.sources[source]?.failure_rotation_threshold || 0);
      state.sources[source].consecutive_failures = failures;
      if (rotationThreshold > 0 && failures >= rotationThreshold && config.regions.length > 1) {
        state.sources[source].region_index = (Number(state.sources[source].region_index || 0) + 1) % config.regions.length;
        state.sources[source].consecutive_failures = 0;
        state.sources[source].last_error = `${message.slice(-4500)}\nRotated to next region after ${failures} consecutive failures; prior region remains resumable.`;
      }
    }
  }
  // Keep the legacy aggregate cursor for older status tooling, but derive
  // actual work selection from each source's cursor above.
  if (workUnits) state.region_index = (state.region_index + 1) % config.regions.length;
  state.last_run = new Date().toISOString();
  if (options.apply) saveJson(STATE_PATH, state);
  report.finished_at = new Date().toISOString();
  console.log(options.json ? JSON.stringify(report, null, 2) : `source pipeline ${report.mode}: work_units=${workUnits} errors=${report.errors.length}`);
  // A source-level failure is recorded in state and the JSON report for the
  // health/alerting layer. Keep the scheduler itself successful so one
  // transient provider or failed OSM tile cannot take the hourly pipeline out
  // of service and prevent unrelated sources from running.
  if (report.errors.length && !options.json) {
    console.log(`source pipeline warnings: ${report.errors.map(error => error.source).join(', ')}`);
  }
} finally { releaseLock(); }
