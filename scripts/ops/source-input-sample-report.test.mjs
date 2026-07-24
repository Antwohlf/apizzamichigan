import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSourceRow,
  normalizeSourcePhone,
  normalizeSourceUrl,
  sourceIdentifierMatch,
  sourceMatchMethod,
  isWithinScope,
} from './source-input-sample-report.mjs'

test('normalizes phone identifiers conservatively', () => {
  assert.equal(normalizeSourcePhone('+1 (209) 466-5555'), '2094665555')
  assert.equal(normalizeSourcePhone('not a phone'), '')
})

test('normalizes store URLs without collapsing distinct store paths', () => {
  assert.equal(normalizeSourceUrl('https://www.littlecaesars.com/en-us/store/8742/'), 'littlecaesars.com/en-us/store/8742')
  assert.notEqual(
    normalizeSourceUrl('https://littlecaesars.com/en-us/store/8742'),
    normalizeSourceUrl('https://littlecaesars.com/en-us/store/9867')
  )
})

test('recognizes exact website or phone matches at the same location', () => {
  const match = sourceIdentifierMatch(
    { website: 'https://littlecaesars.com/en-us/store/8742', phone: '(209) 466-5555' },
    { website_url: 'https://www.littlecaesars.com/en-us/store/8742/', phone: '+1 209-466-5555' }
  )
  assert.deepEqual(match, { website: true, phone: true, exact: true })
})

test('does not treat a shared chain homepage as a store identifier', () => {
  const match = sourceIdentifierMatch(
    { website: 'https://littlecaesars.com', phone: '' },
    { website_url: 'https://www.littlecaesars.com/', phone: '' }
  )
  assert.deepEqual(match, { website: false, phone: false, exact: false })
})

test('promotes an exact identifier match while preserving weak-name safety', () => {
  assert.equal(sourceMatchMethod(0, 0, true), 'exact_identifier_nearby')
  assert.equal(sourceMatchMethod(0, 0, false), 'spatial_only_review')
})

test('treats OSM disused, abandoned, and demolished statuses as closed evidence', () => {
  for (const operatingStatus of ['disused', 'abandoned', 'demolished']) {
    const row = normalizeSourceRow({
      id: `osm:node/${operatingStatus}`,
      name: 'Test Pizzeria',
      lat: 42,
      lng: -83,
      operating_status: operatingStatus,
      category: 'pizza',
    }, 'osm')
    assert.equal(row.is_closed, true, operatingStatus)
  }
})

test('rejects explicit neighboring state records inside a broad regional bbox', () => {
  const scope = { region_scope: 'US', regions: [{ key: 'NY', bbox: [40.4, -79.8, 45.1, -71.7], region_codes: ['NY'] }] }
  assert.equal(isWithinScope({ lat: 40.46, lng: -79.70, region: 'PA' }, scope), false)
  assert.equal(isWithinScope({ lat: 40.71, lng: -74.00, region: 'NY' }, scope), true)
  assert.equal(isWithinScope({ lat: 40.71, lng: -74.00, region: null }, scope), true)
})
