import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { privatePipelineStatePath, readPrivateJson } from './private-pipeline-state.mjs'
import { ProgressTracker } from './progress-tracker.mjs'
import { StateImportTracker } from './state-import-tracker.mjs'

const withStateDir = async (run) => {
  const previous = process.env.PRIVATE_PIPELINE_STATE_DIR
  const dir = mkdtempSync(join(tmpdir(), 'apizza-private-state-'))
  process.env.PRIVATE_PIPELINE_STATE_DIR = dir
  try {
    return await run(dir)
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_PIPELINE_STATE_DIR
    else process.env.PRIVATE_PIPELINE_STATE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('requires an existing absolute state directory outside the checkout', () => {
  const previous = process.env.PRIVATE_PIPELINE_STATE_DIR
  try {
    delete process.env.PRIVATE_PIPELINE_STATE_DIR
    assert.throws(() => privatePipelineStatePath('checkpoint.json'), /PRIVATE_PIPELINE_STATE_DIR/)
    process.env.PRIVATE_PIPELINE_STATE_DIR = 'relative/private-state'
    assert.throws(() => privatePipelineStatePath('checkpoint.json'), /absolute path/)
    process.env.PRIVATE_PIPELINE_STATE_DIR = process.cwd()
    assert.throws(() => privatePipelineStatePath('checkpoint.json'), /outside the repository/)
    const link = join(tmpdir(), `apizza-checkout-link-${process.pid}`)
    symlinkSync(process.cwd(), link)
    process.env.PRIVATE_PIPELINE_STATE_DIR = link
    assert.throws(() => privatePipelineStatePath('checkpoint.json'), /outside the repository/)
    unlinkSync(link)
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_PIPELINE_STATE_DIR
    else process.env.PRIVATE_PIPELINE_STATE_DIR = previous
  }
})

test('missing and corrupt checkpoints fail closed', () => withStateDir(dir => {
  assert.throws(() => readPrivateJson('missing.json'), /missing or invalid JSON/)
  writeFileSync(join(dir, 'bad.json'), '{not-json')
  assert.throws(() => readPrivateJson('bad.json'), /missing or invalid JSON/)
  writeFileSync(join(dir, 'wrong.json'), JSON.stringify({ version: 2 }))
  assert.throws(() => readPrivateJson('wrong.json', data => data.version === 1), /invalid schema/)
  symlinkSync(join(process.cwd(), 'package.json'), join(dir, 'escape.json'))
  assert.throws(() => readPrivateJson('escape.json'), /must not be a symlink/)
}))

test('trackers do not silently create new state', async () => withStateDir(async dir => {
  const progress = new ProgressTracker()
  await assert.rejects(progress.load(), /missing or invalid JSON/)
  await assert.rejects(progress.save(), /before a valid private checkpoint/)
  const states = new StateImportTracker()
  await assert.rejects(states.load(), /missing or invalid JSON/)
  await assert.rejects(states.save(), /before a valid private checkpoint/)
  assert.equal(progress.filePath, join(realpathSync(dir), '.pizza-metadata-progress.json'))
}))

test('valid legacy schemas remain readable from private state', async () => withStateDir(async dir => {
  writeFileSync(join(dir, '.pizza-metadata-progress.json'), JSON.stringify({
    version: 1, lastUpdated: null,
    stats: { total: 0, processed: 0, styleInferred: 0, priceInferred: 0, needsReview: 0 },
    results: {},
  }))
  writeFileSync(join(dir, '.state-import-progress.json'), JSON.stringify({
    version: 1, lastUpdated: null, startedAt: null,
    states: { completed: [], failed: [], pending: [] },
    recordCounts: {}, retries: {}, errors: {},
  }))
  const progress = new ProgressTracker()
  await progress.load()
  const states = new StateImportTracker()
  await states.load()
  assert.equal(progress.getProcessedCount(), 0)
  assert.equal(states.getCompletedStates().length, 0)
}))
