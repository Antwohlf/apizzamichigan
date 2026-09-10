import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { normalizeAdminPlaceSubmission, normalizePreparedPhoto } = require('../../shared/admin-place-write-boundary.cjs')

test('normalizes pizza and taco submissions to the authoritative canonical schema', () => {
  const base = {
    name: ' Test ', address: ' 1 Main ', lat: 42, lng: -83, style: ' Detroit ', rating: 8.5,
    state: ' MI ', google_place_id: ' google-123 ', url: ' https://example.com ',
    review: 'Quick review', notes: 'Private note', city: 'obsolete',
  }
  assert.deepEqual(normalizeAdminPlaceSubmission({ entity: 'pizza', ...base }).row, {
    name: 'Test', address: '1 Main', state: 'MI', website_url: 'https://example.com',
    google_place_id: 'google-123', price: null, status: 'unvisited',
    notes: 'Quick review\n\nPrivate note', rating: 8.5, lat: 42, lng: -83, style: 'Detroit',
  })
  const tacoRow = normalizeAdminPlaceSubmission({ entity: 'taco', ...base }).row
  assert.equal(tacoRow.style, 'Detroit')
  for (const obsolete of ['city', 'url', 'review', 'type', 'photos', 'photo_url', 'photo_path']) {
    assert.equal(Object.hasOwn(tacoRow, obsolete), false, `unexpected ${obsolete} column`)
  }
})

test('preserves the legacy frozen-pizza column contract', () => {
  assert.deepEqual(normalizeAdminPlaceSubmission({
    entity: 'frozen', brand: ' Motor City ', product: ' Pepperoni ', price: '$$', rating: 7, notes: ' crisp ',
  }), {
    entity: 'frozen', table: 'frozen_pizzas',
    row: { Brand: 'Motor City', Type: 'Pepperoni', Price: '$$', Rating: 7, Notes: 'crisp' },
  })
})

test('rejects unsupported entities, incomplete rows, and unsafe photo formats', () => {
  assert.throws(() => normalizeAdminPlaceSubmission({ entity: 'burger' }), /pizza, taco, or frozen/)
  assert.throws(() => normalizeAdminPlaceSubmission(null), /Invalid submission/)
  assert.throws(() => normalizeAdminPlaceSubmission({ entity: 'pizza', name: 'x' }), /required/)
  assert.throws(() => normalizeAdminPlaceSubmission({
    entity: 'pizza', name: 'x', address: 'y', style: 'z', lat: 91, lng: -83,
  }), /required/)
  assert.throws(() => normalizePreparedPhoto({ path: 'x.jpg', dataBase64: 'abc', mimeType: 'image/jpeg' }), /WebP/)
  assert.deepEqual(normalizePreparedPhoto({ path: 'pizza/1/x.webp', dataBase64: 'YWJj', mimeType: 'image/webp' }), {
    path: 'pizza/1/x.webp', dataBase64: 'YWJj', mimeType: 'image/webp',
  })
})
test('does not coerce missing coordinates to zero', () => {
  const base = { entity: 'pizza', name: 'Test', address: 'Test address', style: 'Other', lat: 42, lng: -83 }
  for (const value of [null, '', false, undefined]) {
    assert.throws(() => normalizeAdminPlaceSubmission({ ...base, lat: value }), /Missing required fields/)
    assert.throws(() => normalizeAdminPlaceSubmission({ ...base, lng: value }), /Missing required fields/)
  }
})
