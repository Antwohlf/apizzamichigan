import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyBackupFreshness } from './backup-freshness.mjs'

test('accepts a recent backup inside the missed-run tolerance', () => {
  const result = classifyBackupFreshness({ ageMinutes: 60 * 24, staleHours: 36 })
  assert.equal(result.state, 'fresh')
  assert.equal(result.fresh, true)
})

test('marks an old backup stale instead of healthy', () => {
  const result = classifyBackupFreshness({ ageMinutes: 60 * 37, staleHours: 36 })
  assert.equal(result.state, 'stale')
  assert.equal(result.fresh, false)
  assert.match(result.detail, /threshold is 36 hours/)
})

test('does not treat an unknown age as fresh', () => {
  const result = classifyBackupFreshness({ ageMinutes: null })
  assert.equal(result.state, 'unknown')
  assert.equal(result.fresh, false)
})
