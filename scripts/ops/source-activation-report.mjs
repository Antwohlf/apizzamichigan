#!/usr/bin/env node
/**
 * Read-only declaration of source adapters owned by the external food runtime.
 *
 * This compatibility report does not inspect the external checkout, infer
 * scheduler health, fetch a source, open Postgres, or mutate review state.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const CONFIG_PATH = join(ROOT, process.env.SOURCE_PIPELINE_CONFIG || 'config/source-pipeline.json')
const BOUNDARY_PATH = join(ROOT, 'config/food-runtime-boundary.json')
const STATE_PATH = join(ROOT, process.env.SOURCE_PIPELINE_STATE || `scripts/.${CONFIG_PATH.split('/').pop().replace(/\.json$/, '')}-state.json`)

const SOURCE_IMPLEMENTATIONS = {
  osm: {
    adapter: 'packages/food-runtime/scripts/ops/export-osm-tiles.mjs',
    execution: 'external food runtime source scheduler',
    writeBoundary: 'local review/provenance; local canonical refresh for exact OSM evidence',
  },
  fsq_os_places: {
    adapter: 'packages/food-runtime/scripts/ops/export-fsq-hf-parquet-sample.py',
    execution: 'external food runtime source scheduler',
    writeBoundary: 'local review queue; reviewed-new import remains guarded',
  },
  all_the_places: {
    adapter: 'packages/food-runtime/scripts/ops/import-atp-spiders.mjs',
    execution: 'external food runtime source scheduler; round-robin spider cursor',
    writeBoundary: 'local review queue; reviewed-new import remains guarded',
  },
  overture_places: {
    adapter: 'packages/food-runtime/scripts/ops/export-overture-tiles.py',
    execution: 'external food runtime source scheduler; bounded tile cursor',
    writeBoundary: 'local review queue; reviewed-new import remains guarded',
  },
  wikidata: {
    adapter: 'packages/food-runtime/scripts/ops/export-wikidata-source.mjs',
    execution: 'external food runtime source scheduler',
    writeBoundary: 'local review/provenance; identity linking remains guarded',
  },
  official_website: {
    adapter: 'packages/food-runtime/scripts/enrichment/agents/web-scraper.mjs',
    execution: 'external food runtime scraper and source scheduler',
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

function productForEntity(entity) {
  if (entity === 'pizza') return 'apizzamichigan'
  if (entity === 'taco') return 'tacoboutmichigan'
  return null
}

function hasExternalRuntimeOwnership(boundary, entity) {
  const product = productForEntity(entity)
  return Boolean(
    product
    && boundary?.runtimeRepository === 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline'
    && boundary?.runtimePackage === 'packages/food-runtime'
    && Array.isArray(boundary?.products)
    && boundary.products.includes(product)
    && Array.isArray(boundary?.scheduledJobsOwnedBySite)
    && boundary.scheduledJobsOwnedBySite.length === 0
  )
}

export function buildSourceActivationReport({
  config = readJson(CONFIG_PATH, {}),
  boundary = readJson(BOUNDARY_PATH, {}),
  state = readJson(STATE_PATH, {}),
} = {}) {
  const operationalRegions = (config.operational_regions || config.regions || [])
    .map(region => typeof region === 'string' ? region : region.key)
    .filter(Boolean)
  const externallyOwned = hasExternalRuntimeOwnership(boundary, config.entity)
  const sources = Object.entries(config.sources || {}).map(([name, sourceConfig]) => {
    const implementation = SOURCE_IMPLEMENTATIONS[name]
    const enabled = Boolean(sourceConfig?.enabled)
    const declaredExternally = Boolean(implementation && externallyOwned)
    const sourceState = state.sources?.[name] || {}
    const status = !enabled ? 'disabled' : declaredExternally ? 'ready' : 'incomplete'

    return {
      source: name,
      status,
      enabled,
      cadence_hours: sourceConfig?.cadence_hours ?? null,
      capabilities: sourceConfig?.capabilities || [],
      auto_create: Boolean(sourceConfig?.auto_create),
      operational_regions: operationalRegions,
      adapter: implementation?.adapter || null,
      adapter_exists: null,
      runner_wired: null,
      ownership: declaredExternally ? 'external-runtime' : 'unresolved',
      execution: implementation?.execution || 'not declared',
      write_boundary: implementation?.writeBoundary || 'unknown',
      last_attempt: sourceState.last_attempt || null,
      last_success: sourceState.last_success || null,
      last_error: sourceState.last_error || null,
    }
  })

  return {
    generated_at: new Date().toISOString(),
    entity: config.entity || null,
    schedule_owner: externallyOwned ? 'external-runtime' : 'unresolved',
    runtime_repository: boundary.runtimeRepository || null,
    runtime_package: boundary.runtimePackage || null,
    operational_regions: operationalRegions,
    source_pipeline_enabled: Boolean(config.entity && externallyOwned),
    observation_scope: 'declaration_only',
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
  console.log(`# Source activation declaration: ${report.entity || 'unknown'}`)
  console.log(`schedule_owner=${report.schedule_owner}`)
  console.log(`operational_regions=${report.operational_regions.join(',') || 'none'}`)
  for (const source of report.sources) {
    console.log(`${source.source}: ${source.status}; owner=${source.ownership}; adapter=${source.adapter || 'none'}`)
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main()
