import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSourceActivationReport } from './source-activation-report.mjs'

const runner = [
  "source === 'osm'",
  "source === 'fsq_os_places'",
  "source === 'all_the_places'",
  "source === 'overture_places'",
  "source === 'wikidata'",
  "source === 'official_website'",
].join('\n')

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
    runner,
    state: { sources: { osm: { last_success: '2026-07-25T12:00:00Z' } } },
  })

  assert.equal(report.summary.ready, 1)
  assert.equal(report.summary.disabled, 1)
  assert.equal(report.sources[0].last_success, '2026-07-25T12:00:00Z')
  assert.deepEqual(report.operational_regions, ['MI', 'NY'])
})

test('marks an enabled source incomplete when its runner branch is missing', () => {
  const report = buildSourceActivationReport({
    config: { entity: 'pizza', sources: { osm: { enabled: true } } },
    runner: '',
    state: {},
  })

  assert.equal(report.sources[0].status, 'incomplete')
  assert.equal(report.summary.incomplete, 1)
})
