import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  MAX_STATUS_BYTES,
  STATUS_FILES,
  foodRuntimePublicationStatusResponse,
  readFoodRuntimePublicationStatus,
} = require('../../shared/food-runtime-publication-status.cjs')

const NOW = Date.parse('2026-09-08T16:00:00.000Z')

function status(entity, overrides = {}) {
  return {
    state: 'succeeded',
    started_at: '2026-09-08T15:58:00.000Z',
    finished_at: '2026-09-08T15:59:00.000Z',
    duration_ms: 60_000,
    exit_code: 0,
    reason: 'bounded sync completed',
    pid: 12345,
    scope: {
      entity,
      hours: '168',
      batch: '100',
      max_batches: '1',
      reconciliation: false,
      internal: 'drop-me',
    },
    secretLikeExtraField: 'drop-me',
    ...overrides,
  }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'food-publication-status-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    root,
    write(entity, value) {
      const path = join(root, STATUS_FILES[entity])
      writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 })
      return path
    },
  }
}

test('missing root is truthful and product-neutral for Pizza and Taco', () => {
  for (const entity of ['pizza', 'taco']) {
    const response = foodRuntimePublicationStatusResponse('', entity, { nowMs: NOW })
    assert.deepEqual(Object.keys(response), ['available', 'state', 'label', 'detail', 'generatedAt'])
    assert.equal(response.available, false)
    assert.equal(response.state, 'not_configured')
    assert.equal(response.label, 'External status not configured')
    assert.match(response.detail, /runs externally/)
    assert.doesNotMatch(response.detail, /disabled|pizza_places/i)
  }
})

test('reads only the selected entity file and exposes only known status fields', t => {
  const files = fixture(t)
  files.write('pizza', status('pizza'))
  files.write('taco', status('taco', { state: 'skipped', reason: 'nothing eligible\nthis cycle' }))

  const pizza = foodRuntimePublicationStatusResponse(files.root, 'pizza', { nowMs: NOW })
  assert.equal(pizza.available, true)
  assert.equal(pizza.state, 'succeeded')
  assert.deepEqual(pizza.lastRun, {
    state: 'succeeded',
    started_at: '2026-09-08T15:58:00.000Z',
    finished_at: '2026-09-08T15:59:00.000Z',
    duration_ms: 60_000,
    exit_code: 0,
    scope: { entity: 'pizza', reconciliation: false },
  })
  assert.equal(Object.hasOwn(pizza.lastRun, 'pid'), false)
  assert.equal(Object.hasOwn(pizza.lastRun, 'secretLikeExtraField'), false)

  const taco = foodRuntimePublicationStatusResponse(files.root, 'taco', { nowMs: NOW })
  assert.equal(taco.state, 'skipped')
  assert.equal(taco.detail, 'The external Taco compatibility publisher skipped its latest bounded run.')
  assert.equal(taco.lastRun.scope.entity, 'taco')
  assert.equal(Object.hasOwn(taco.lastRun, 'reason'), false)

  files.write('pizza', status('pizza', {
    state: 'running',
    finished_at: null,
    duration_ms: null,
    exit_code: null,
  }))
  const running = foodRuntimePublicationStatusResponse(files.root, 'pizza', { nowMs: NOW })
  assert.equal(running.state, 'running')
  assert.equal(running.lastRun.finished_at, null)
})

test('rejects cross-entity, malformed, oversized, and symlinked statuses', t => {
  const files = fixture(t)
  files.write('pizza', status('taco'))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  files.write('pizza', '{not json')
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  files.write('pizza', 'x'.repeat(MAX_STATUS_BYTES + 1))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  const target = files.write('taco', status('taco'))
  const link = join(files.root, STATUS_FILES.pizza)
  rmSync(link)
  symlinkSync(target, link)
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')
})

test('rejects stale, future, and structurally invalid status observations', t => {
  const files = fixture(t)
  files.write('pizza', status('pizza', {
    started_at: '2026-09-08T01:00:00.000Z',
    finished_at: '2026-09-08T01:01:00.000Z',
  }))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW, maxAgeMinutes: 60 }).kind, 'stale')

  files.write('pizza', status('pizza', {
    started_at: '2026-09-08T17:00:00.000Z',
    finished_at: '2026-09-08T17:01:00.000Z',
  }))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  files.write('pizza', status('pizza', { state: 'running', finished_at: '2026-09-08T15:59:00.000Z' }))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  files.write('pizza', status('pizza', { duration_ms: '60000' }))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  files.write('pizza', status('pizza', { duration_ms: 1 }))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')

  files.write('pizza', status('pizza', { scope: { entity: 'pizza', reconciliation: 'false' } }))
  assert.equal(readFoodRuntimePublicationStatus(files.root, 'pizza', { nowMs: NOW }).kind, 'invalid')
})

test('rejects unsupported products and relative roots', () => {
  assert.throws(
    () => readFoodRuntimePublicationStatus('/tmp/status', 'burger', { nowMs: NOW }),
    /Unsupported food runtime status entity/,
  )
  assert.equal(
    readFoodRuntimePublicationStatus('relative/status', 'pizza', { nowMs: NOW }).kind,
    'invalid_configuration',
  )
})
