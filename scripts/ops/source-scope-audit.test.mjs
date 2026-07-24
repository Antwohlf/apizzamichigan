import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyScope } from './source-scope-audit.mjs'

const scope = {
  region_scope: 'US',
  regions: [{ key: 'NY', bbox: [40.4, -79.8, 45.1, -71.7], region_codes: ['NY'] }],
}

test('classifies explicit neighboring-state evidence as out of scope', () => {
  assert.equal(classifyScope({ lat: 40.46, lng: -79.7, region: 'PA' }, scope), 'explicit_out_of_scope')
})

test('keeps missing-region evidence visible as unknown', () => {
  assert.equal(classifyScope({ lat: 40.71, lng: -74, region: null }, scope), 'unknown_region')
})

test('identifies evidence without coordinates separately', () => {
  assert.equal(classifyScope({ region: 'NY' }, scope), 'no_coordinates')
})
