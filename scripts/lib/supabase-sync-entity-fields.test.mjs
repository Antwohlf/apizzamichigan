import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSupabaseInsertPayload,
  buildSupabasePayload,
  syncColumnsForEntity,
} from './supabase-sync-policy.mjs'

const NOW = '2026-09-07T12:00:00.000Z'

test('Taco update payload omits fields its RPC does not parse and apply', () => {
  const payload = buildSupabasePayload({
    id: 7,
    created_at: '2020-01-01T00:00:00.000Z',
    website_url: 'https://example.invalid',
    menu_data: { items: [] },
  }, {
    id: 7,
    created_at: null,
    website_url: null,
    menu_data: null,
    qa_status: null,
    qa_schema_version: null,
  }, { entity: 'taco', nowIso: NOW })

  assert.deepEqual(payload, {
    id: 7,
    website_url: 'https://example.invalid',
    updated_at: NOW,
  })
  for (const field of ['created_at', 'menu_data', 'qa_status', 'qa_schema_version']) {
    assert.equal(Object.hasOwn(payload, field), false)
  }
})

test('Taco insert payload relies on target defaults for excluded QA and creation fields', () => {
  const payload = buildSupabaseInsertPayload({ id: 8, name: 'Taco fixture', lat: 1, lng: 2 }, {
    entity: 'taco',
    nowIso: NOW,
  })
  assert.equal(payload.updated_at, NOW)
  for (const field of ['created_at', 'qa_status', 'qa_schema_version']) {
    assert.equal(Object.hasOwn(payload, field), false)
  }
})

test('Pizza retains its existing QA and creation defaults', () => {
  assert.deepEqual(syncColumnsForEntity(['created_at', 'qa_status'], 'pizza'), ['created_at', 'qa_status'])
  const payload = buildSupabasePayload({ id: 9, website_url: 'https://example.invalid' }, {
    id: 9,
    website_url: null,
    qa_status: null,
    qa_schema_version: null,
  }, { entity: 'pizza', nowIso: NOW })
  assert.equal(payload.qa_status, 'unreviewed')
  assert.equal(payload.qa_schema_version, 1)
})
