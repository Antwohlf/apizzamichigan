import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { sourceRecordIdentity } = require('../../server/product/source-record-identity.cjs')

test('OSM queue and raw IDs resolve to one canonical identity and raw provenance ID', () => {
  for (const type of ['node', 'way', 'relation']) {
    for (const prefix of ['', 'osm:', 'osm:osm:']) {
      assert.deepEqual(sourceRecordIdentity('osm', `${prefix}${type}/123`), {
        sourceId: `${type}/123`, googlePlaceId: `osm:${type}/123`,
      })
    }
  }
  assert.deepEqual(sourceRecordIdentity('osm', ' osm:way/123 '), { sourceId: 'way/123', googlePlaceId: 'osm:way/123' })
  assert.equal(sourceRecordIdentity('osm', 'osm:').googlePlaceId, null)
  assert.equal(sourceRecordIdentity('osm', null).googlePlaceId, null)
})

test('other sources retain their existing identifiers', () => {
  for (const source of ['overture_places', 'fsq_os_places', 'wikidata', 'all_the_places']) {
    assert.deepEqual(sourceRecordIdentity(source, 'provider:123'), {
      sourceId: 'provider:123', googlePlaceId: `${source}:provider:123`,
    })
  }
})

test('actual admin preflight payload and both provenance writes use the normalized identity', () => {
  const server = readFileSync('server/index.js', 'utf8')
  const body = server.slice(server.indexOf('const sourceReviewCandidatePayload ='), server.indexOf('async function sourceReviewGooglePlaceIdExists'))
  const context = vm.createContext({
    sourceRecordIdentity,
    canonicalSourceReviewName: row => row.source_name,
    sourceReviewCoordinate: () => 1,
  })
  const payload = vm.runInContext(`${body}\nsourceReviewCandidatePayload({source: 'osm', source_id: 'osm:way/123', source_name: 'Synthetic taqueria', source_data: {}})`, context)
  assert.equal(payload.googlePlaceId, 'osm:way/123')
  for (const name of ['importReviewedNewCandidate', 'upsertReviewedPlaceSource']) {
    const start = server.indexOf(`async function ${name}(`)
    const end = server.indexOf('\n}', start) + 2
    assert.match(server.slice(start, end), /sourceRecordIdentity\(row\.source, row\.source_id\)\.sourceId/)
  }
})
