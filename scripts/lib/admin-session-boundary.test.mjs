import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  DEFAULT_SESSION_TTL_MS,
  createAdminSessionValue,
  isAdminAuthConfigured,
  validateAdminSessionValue,
} = require('../../shared/admin-session-boundary.cjs')

const NOW = Date.parse('2026-09-07T12:00:00.000Z')

test('creates and accepts a bounded server-expiring admin session', () => {
  const value = createAdminSessionValue({ nowMs: NOW })
  const result = validateAdminSessionValue(value, { nowMs: NOW + 1_000 })
  assert.equal(result.ok, true)
  assert.equal(result.expiresAtMs - result.issuedAtMs, DEFAULT_SESSION_TTL_MS)
})

test('rejects legacy, malformed, expired, future, and oversized sessions', () => {
  for (const value of [null, '', '1', 'v2.1725700000000.1725700001000', 'v1.not-a-date.1725700001000']) {
    assert.equal(validateAdminSessionValue(value, { nowMs: NOW }).ok, false)
  }
  assert.equal(validateAdminSessionValue(`v1.${NOW - 2_000}.${NOW - 1_000}`, { nowMs: NOW }).reason, 'expired')
  assert.equal(validateAdminSessionValue(`v1.${NOW + 600_000}.${NOW + 601_000}`, { nowMs: NOW }).reason, 'future_issued')
  assert.equal(
    validateAdminSessionValue(`v1.${NOW}.${NOW + DEFAULT_SESSION_TTL_MS + 1}`, { nowMs: NOW }).reason,
    'invalid_lifetime',
  )
})

test('refuses to mint sessions with invalid inputs', () => {
  assert.throws(() => createAdminSessionValue({ nowMs: -1 }))
  assert.throws(() => createAdminSessionValue({ nowMs: NOW, ttlMs: DEFAULT_SESSION_TTL_MS + 1 }))
})

test('treats missing password or signing material as unconfigured', () => {
  assert.equal(isAdminAuthConfigured(), false)
  assert.equal(isAdminAuthConfigured({ password: 'configured', sessionSecret: '' }), false)
  assert.equal(isAdminAuthConfigured({ password: '', sessionSecret: 'configured' }), false)
  assert.equal(isAdminAuthConfigured({ password: 'configured', sessionSecret: 'configured' }), true)
})
