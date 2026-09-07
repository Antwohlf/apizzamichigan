import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  buildLegacyPipelineStatusDocument,
  presentPipelineStatus,
  readPipelineStatusSnapshot,
  resolveStatusSelection,
  validatePipelineStatusDocument,
  writePipelineStatusSnapshot,
} = require('../../shared/pipeline-status-boundary.cjs')

const ROOT = resolve(import.meta.dirname, '../..')
const boundary = JSON.parse(readFileSync(join(ROOT, 'config/pipeline-boundary.json'), 'utf8'))
const NOW = Date.parse('2026-09-07T12:00:00.000Z')

function targetBinding(entity) {
  const target = boundary.status.targets[entity]
  const bytes = readFileSync(join(ROOT, target.contract.file))
  const contract = JSON.parse(bytes.toString('utf8'))
  return {
    name: contract.name,
    version: contract.version,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  }
}

function expectation(entity = 'pizza', lane = 'legacy') {
  const target = boundary.status.targets[entity]
  const selection = resolveStatusSelection(
    boundary,
    entity,
    { [target.laneEnvVariable]: lane },
    ROOT,
  )
  return { ...selection, targetContract: targetBinding(entity) }
}

function validPizza(overrides = {}) {
  const document = buildLegacyPipelineStatusDocument({
    generatedAt: '2026-09-07T11:55:00.000Z',
    state: 'WARN',
    alerts: [],
    warnings: ['private source text must not survive'],
    queue: { shared: 999 },
    classifier: { backlog: { candidates: 999 } },
    sourcePipeline: { scheduler: { state: 'idle', detail: 'private host detail' } },
    freshness: [{ source: 'osm', fresh_ratio_percent: 96.5, stale_rows: 12, eligible_rows: 840 }],
    sourceActivation: {
      entity: 'pizza',
      sources: [{ source: 'osm', status: 'ready', execution: 'source-pipeline scheduler', last_success: '2026-09-07T11:50:00.000Z' }],
    },
  }, {
    entity: 'pizza',
    profile: 'apizzamichigan',
    partition: 'configured-regions',
    targetContract: targetBinding('pizza'),
    producerCommit: 'a'.repeat(40),
    publishedAt: '2026-09-07T12:00:00.000Z',
  })
  return { ...document, ...overrides }
}

function validExternal(entity, lane = 'shadow') {
  const selected = expectation(entity, lane)
  const timestamp = '2026-09-07T11:58:00.000Z'
  const digest = `sha256:${'d'.repeat(64)}`
  return {
    schema: { name: 'map-data-pipeline.status', version: 1 },
    purpose: 'operations-display-only',
    lane,
    bindings: {
      targetContract: selected.targetContract,
      definitionDigest: digest,
      profileDigest: digest,
      catalogDigest: digest,
      hostPolicyDigest: digest,
      deploymentIdentity: `${entity}-shadow-fixture`,
    },
    profile: selected.profile,
    entity,
    partition: 'MI',
    observedAt: timestamp,
    publishedAt: timestamp,
    producer: {
      kind: 'external-pipeline',
      repository: 'Antwohlf/map-data-aggregation-enhancement-pipeline',
      component: 'status-sink',
      version: '1',
      commit: 'c'.repeat(40),
    },
    run: {
      id: `${entity}-shadow-run-1`,
      mode: lane === 'shadow' ? 'preview' : 'apply',
      state: 'succeeded',
      startedAt: '2026-09-07T11:57:00.000Z',
      finishedAt: timestamp,
    },
    health: { state: 'ok', issues: [] },
    ui: {},
  }
}

test('legacy APizza status validates and presents only bounded compatibility fields', () => {
  const document = validPizza()
  const result = presentPipelineStatus(document, expectation(), { nowMs: NOW, maxAgeMinutes: 360 })
  assert.equal(result.ok, true)
  assert.equal(result.data.state, 'warn')
  assert.equal(result.data.operationalLane, 'legacy')
  assert.equal(result.data.sourcePipeline.scheduler.state, 'idle')
  assert.equal(result.data.freshness[0].eligible_rows, 840)
  assert.equal(result.data.classifier, null)
  assert.equal(Object.hasOwn(result.data, 'queue'), false)
  const serialized = JSON.stringify(document)
  assert.doesNotMatch(serialized, /private source text|private host detail|shared/)
})

test('staleness is calculated from observedAt rather than republishedAt', () => {
  const document = validPizza({
    observedAt: '2026-09-07T01:00:00.000Z',
    publishedAt: '2026-09-07T11:59:00.000Z',
  })
  document.run.finishedAt = document.publishedAt
  const result = presentPipelineStatus(document, expectation(), { nowMs: NOW, maxAgeMinutes: 360 })
  assert.equal(result.ok, true)
  assert.equal(result.data.state, 'stale')
  assert.equal(result.data.ageMinutes, 660)
})

test('rejects identity, lane, digest, version, timing, state, and unknown-key mutations', () => {
  const cases = [
    document => { document.entity = 'taco' },
    document => { document.profile = 'tacoboutmichigan' },
    document => { document.lane = 'shadow' },
    document => { document.bindings.targetContract.digest = `sha256:${'b'.repeat(64)}` },
    document => { document.schema.version = 2 },
    document => { document.publishedAt = '2026-09-07T11:00:00.000Z' },
    document => { document.observedAt = '2026-09-08T12:00:00.000Z' },
    document => { document.health = { state: 'ok', issues: [{ severity: 'warning', code: 'pipeline.operational-warning', count: 1 }] } },
    document => { document.untrusted = true },
    document => { document.health.issues[0].message = '/private/host/path' },
    document => {
      document.run.state = 'failed'
      document.health = { state: 'ok', issues: [] }
    },
  ]
  for (const mutate of cases) {
    const document = structuredClone(validPizza())
    mutate(document)
    assert.equal(
      validatePipelineStatusDocument(document, expectation(), { nowMs: NOW }).ok,
      false,
    )
  }
})

test('presents a running observation without claiming the pipeline is healthy', () => {
  const document = validPizza()
  document.run.state = 'running'
  delete document.run.finishedAt
  const result = presentPipelineStatus(document, expectation(), { nowMs: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.data.state, 'running')
  assert.equal(result.data.label, 'Pipeline observation in progress')
})

test('rejects swapped Pizza/Taco expectations and unknown entities', () => {
  assert.equal(validatePipelineStatusDocument(validPizza(), expectation('taco', 'shadow'), { nowMs: NOW }).ok, false)
  assert.throws(() => resolveStatusSelection(boundary, 'burger', {}, ROOT), /Unsupported/)
})

test('accepts distinct external shadow vectors for Pizza and Taco', () => {
  for (const entity of ['pizza', 'taco']) {
    const selected = expectation(entity, 'shadow')
    const document = validExternal(entity)
    assert.equal(validatePipelineStatusDocument(document, selected, { nowMs: NOW }).ok, true)
    const presented = presentPipelineStatus(document, selected, { nowMs: NOW })
    assert.equal(presented.ok, true)
    assert.equal(presented.data.entity, entity)
    assert.equal(presented.data.authorityLabel, 'Shadow only — non-authoritative')
  }
})

test('selects fixed entity-and-lane paths and never promotes apply from status configuration', () => {
  const pizzaLegacy = resolveStatusSelection(boundary, 'pizza', {}, ROOT)
  const pizzaShadow = resolveStatusSelection(boundary, 'pizza', { PIPELINE_STATUS_PIZZA_LANE: 'shadow' }, ROOT)
  const tacoDefault = resolveStatusSelection(boundary, 'taco', {}, ROOT)
  const tacoShadow = resolveStatusSelection(boundary, 'taco', { PIPELINE_STATUS_TACO_LANE: 'shadow' }, ROOT)
  const pizzaApply = resolveStatusSelection(boundary, 'pizza', { PIPELINE_STATUS_PIZZA_LANE: 'apply' }, ROOT)
  assert.match(pizzaLegacy.path, /pizza\/legacy\.json$/)
  assert.match(pizzaShadow.path, /pizza\/shadow\.json$/)
  assert.equal(tacoDefault.enabled, false)
  assert.match(tacoShadow.path, /taco\/shadow\.json$/)
  assert.notEqual(pizzaShadow.path, tacoShadow.path)
  assert.equal(pizzaApply.enabled, false)
  assert.equal(pizzaApply.reason, 'external_apply_disabled')
})

test('caps JSON structure before nested content can reach the presenter', () => {
  const document = validPizza()
  let nested = {}
  document.ui.deep = nested
  for (let index = 0; index < 20; index += 1) {
    nested.next = {}
    nested = nested.next
  }
  const result = validatePipelineStatusDocument(document, expectation(), { nowMs: NOW })
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /structural limits/)
})

test('writes and reads a private atomic status file and rejects unsafe file types or modes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pipeline-status-boundary-'))
  try {
    const path = join(directory, 'pizza', 'legacy.json')
    const document = validPizza()
    writePipelineStatusSnapshot(path, document)
    const read = readPipelineStatusSnapshot(path, { maxBytes: 131_072 })
    assert.equal(read.state, 'read')
    assert.deepEqual(JSON.parse(read.text), document)

    chmodSync(path, 0o644)
    assert.throws(() => readPipelineStatusSnapshot(path), /permissions/)
    chmodSync(path, 0o600)

    const link = join(directory, 'pizza', 'linked.json')
    symlinkSync(path, link)
    assert.throws(() => readPipelineStatusSnapshot(link), /symlink/)

    const oversized = join(directory, 'pizza', 'oversized.json')
    writeFileSync(oversized, 'x'.repeat(129), { mode: 0o600 })
    assert.throws(() => readPipelineStatusSnapshot(oversized, { maxBytes: 128 }), /byte limit/)
    assert.throws(() => readPipelineStatusSnapshot(join(directory, 'pizza')), /regular file/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
