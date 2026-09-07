'use strict'

const SESSION_VERSION = 'v1'
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

function isAdminAuthConfigured({ password, sessionSecret } = {}) {
  return typeof password === 'string' && password.length > 0
    && typeof sessionSecret === 'string' && sessionSecret.length > 0
}

function createAdminSessionValue({
  nowMs = Date.now(),
  ttlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Invalid session issue time')
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_SESSION_TTL_MS) {
    throw new Error('Invalid session lifetime')
  }
  return `${SESSION_VERSION}.${nowMs}.${nowMs + ttlMs}`
}

function validateAdminSessionValue(value, {
  nowMs = Date.now(),
  maxTtlMs = DEFAULT_SESSION_TTL_MS,
  futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
} = {}) {
  if (typeof value !== 'string') return { ok: false, reason: 'missing' }
  const match = /^([a-z0-9]+)\.(\d{13})\.(\d{13})$/.exec(value)
  if (!match) return { ok: false, reason: 'malformed' }
  if (match[1] !== SESSION_VERSION) return { ok: false, reason: 'unsupported_version' }

  const issuedAtMs = Number(match[2])
  const expiresAtMs = Number(match[3])
  if (!Number.isSafeInteger(issuedAtMs) || !Number.isSafeInteger(expiresAtMs)) {
    return { ok: false, reason: 'invalid_timestamp' }
  }
  if (issuedAtMs > nowMs + futureToleranceMs) return { ok: false, reason: 'future_issued' }
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > maxTtlMs) {
    return { ok: false, reason: 'invalid_lifetime' }
  }
  if (expiresAtMs <= nowMs) return { ok: false, reason: 'expired' }
  return { ok: true, issuedAtMs, expiresAtMs }
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  createAdminSessionValue,
  isAdminAuthConfigured,
  validateAdminSessionValue,
}
