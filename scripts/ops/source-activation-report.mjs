#!/usr/bin/env node
/**
 * Read-only activation matrix for configured source adapters.
 *
 * This reports checked-in capability and machine-local run state. It does not
 * fetch a source, open Postgres, mutate review queues, or publish anything.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CONFIG_PATH = join(ROOT, 'config/source-pipeline.json')
const RUNNER_PATH = join(ROOT, 'scripts/ops/run-source-pipeline.mjs')
const STATE_PATH = join(ROOT, 'scripts/.source-pipeline-state.json')

const SOURCE_IMPLEMENTATIONS = {
  osm: {
    runnerMarker: "source === 'osm'",
    adapter: 'scripts/ops/export-osm-tiles.mjs',
    execution: 'source-pipeline scheduler',
    writeBoundary: 'local review/provenance; local canonical refresh for exact OSM evidence',
  },
  fsq_os_places: {
    runnerMarker: "source === 'fsq_os_places'",
    adapter: 'scripts/ops/export-fsq-hf-parquet-sample.py',
    execution: 'source-pipeline scheduler',
    writeBoundary: 'local review queue; reviewed-new import remains guarded',
  },
  all_the_places: {
    runnerMarker: "source === 'all_the_places'",
    adapter: 'scripts/ops/import-atp-spiders.mjs',
    execution: 'source-pipeline scheduler; round-robin spider cursor',
    writeBoundary: 'local review queue; reviewed-new import remains guarded',
  },
  overture_places: {
    runnerMarker: "source === 'overture_places'",
    adapter: 'scripts/ops/export-overture-tiles.py',
    execution: 'source-pipeline scheduler; bounded tile cursor',
    writeBoundary: 'local review queue; reviewed-new import remains guarded',
  },
  wikidata: {
    runnerMarker: "source === 'wikidata'",
    adapter: 'scripts/ops/export-wikidata-source.mjs',
    execution: 'source-pipeline scheduler',
    writeBoundary: 'local review/provenance; identity linking remains guarded',
  },
  official_website: {
    runnerMarker: "source === 'official_website'",
    adapter: 'scripts/enrichment/agents/web-scraper.mjs',
    execution: 'launchd scraper owns website jobs; source scheduler records provenance',
    writeBoundary: 'local evidence; website/phone promotion is separately capped',
  },
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function buildSourceActivationReport({
  config = readJson(CONFIG_PATH, {}),
  runner = existsSync(RUNNER_PATH) ? readFileSync(RUNNER_PATH, 'utf8') : '',
  state = readJson(STATE_PATH, {}),
} = {}) {
  const operationalRegions = (config.operational_regions || config.regions || [])
    .map(region => typeof region === 'string' ? region : region.key)
    .filter(Boolean)
  const sources = Object.entries(config.sources || {}).map(([name, sourceConfig]) => {
    const implementation = SOURCE_IMPLEMENTATIONS[name]
    const adapterExists = Boolean(implementation && existsSync(join(ROOT, implementation.adapter)))
    const runnerWired = Boolean(implementation && runner.includes(implementation.runnerMarker))
    const sourceState = state.sources?.[name] || {}
    const enabled = Boolean(sourceConfig?.enabled)
    const status = !enabled
      ? 'disabled'
      : !implementation || !runnerWired || !adapterExists
        ? 'incomplete'
        : 'ready'

    return {
      source: name,
      status,
      enabled,
      cadence_hours: sourceConfig?.cadence_hours ?? null,
      capabilities: sourceConfig?.capabilities || [],
      auto_create: Boolean(sourceConfig?.auto_create),
      operational_regions: operationalRegions,
      adapter: implementation?.adapter || null,
      adapter_exists: adapterExists,
      runner_wired: runnerWired,
      execution: implementation?.execution || 'not implemented',
      write_boundary: implementation?.writeBoundary || 'unknown',
      last_attempt: sourceState.last_attempt || null,
      last_success: sourceState.last_success || null,
      last_error: sourceState.last_error || null,
    }
  })

  return {
    generated_at: new Date().toISOString(),
    entity: config.entity || null,
    schedule_owner: 'com.apizzamichigan.source-pipeline',
    operational_regions: operationalRegions,
    source_pipeline_enabled: Boolean(config.entity),
    sources,
    summary: {
      configured: sources.length,
      enabled: sources.filter(source => source.enabled).length,
      ready: sources.filter(source => source.status === 'ready').length,
      incomplete: sources.filter(source => source.status === 'incomplete').length,
      disabled: sources.filter(source => source.status === 'disabled').length,
    },
  }
}

function main() {
  const report = buildSourceActivationReport()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`# Source activation: ${report.entity || 'unknown'}`)
  console.log(`schedule_owner=${report.schedule_owner}`)
  console.log(`operational_regions=${report.operational_regions.join(',') || 'none'}`)
  for (const source of report.sources) {
    console.log(`${source.source}: ${source.status}; adapter=${source.adapter || 'none'}; last_success=${source.last_success || 'never'}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
