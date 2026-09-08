import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSourceActivationReport } from './source-activation-report.mjs'

const externalBoundary = {
  runtimeRepository: 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline',
  runtimePackage: 'packages/food-runtime',
  products: ['apizzamichigan', 'tacoboutmichigan'],
  scheduledJobsOwnedBySite: [],
}

test('reports configured sources and preserves local run state', () => {
  const report = buildSourceActivationReport({
    config: {
      entity: 'pizza',
      operational_regions: ['MI', 'NY'],
      sources: {
        osm: { enabled: true, cadence_hours: 0.25, capabilities: ['discover'] },
        official_website: { enabled: false, cadence_hours: 1, capabilities: ['enrich_evidence'] },
      },
    },
    boundary: externalBoundary,
    state: { sources: { osm: { last_success: '2026-07-25T12:00:00Z' } } },
  })

  assert.equal(report.summary.ready, 1)
  assert.equal(report.summary.disabled, 1)
  assert.equal(report.sources[0].last_success, '2026-07-25T12:00:00Z')
  assert.equal(report.sources[0].ownership, 'external-runtime')
  assert.equal(report.sources[0].adapter_exists, null)
  assert.match(report.sources[0].adapter, /^packages\/food-runtime\//)
  assert.equal(report.schedule_owner, 'external-runtime')
  assert.equal(report.observation_scope, 'declaration_only')
  assert.deepEqual(report.operational_regions, ['MI', 'NY'])
})

test('marks an enabled source incomplete when external ownership is not declared', () => {
  const report = buildSourceActivationReport({
    config: { entity: 'pizza', sources: { osm: { enabled: true } } },
    boundary: { ...externalBoundary, scheduledJobsOwnedBySite: ['source'] },
    state: {},
  })

  assert.equal(report.sources[0].status, 'incomplete')
  assert.equal(report.sources[0].ownership, 'unresolved')
  assert.equal(report.summary.incomplete, 1)
})

test('binds Taco declarations to the separate Taco product identity', () => {
  const report = buildSourceActivationReport({
    config: { entity: 'taco', sources: { osm: { enabled: true } } },
    boundary: externalBoundary,
    state: {},
  })

  assert.equal(report.source_pipeline_enabled, true)
  assert.equal(report.sources[0].ownership, 'external-runtime')
})
