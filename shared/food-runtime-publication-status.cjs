const { closeSync, constants, lstatSync, openSync, readFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')

const DEFAULT_MAX_AGE_MINUTES = 360
const MAX_STATUS_BYTES = 64 * 1024
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const STATUS_FILES = Object.freeze({
  pizza: '.supabase-sync-status.json',
  taco: '.taco-supabase-sync-status.json',
})
const RUN_STATES = new Set(['running', 'succeeded', 'skipped', 'failed'])

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function checkedEntity(entity) {
  const normalized = String(entity || '').trim().toLowerCase()
  if (!Object.hasOwn(STATUS_FILES, normalized)) throw new Error(`Unsupported food runtime status entity: ${entity}`)
  return normalized
}

function checkedTimestamp(value, { nullable = false } = {}) {
  if (nullable && value == null) return null
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('Status timestamp is invalid')
  }
  return value
}

function sanitizeRunState(document, entity) {
  if (!isPlainObject(document)) throw new Error('Status document must be an object')
  if (!RUN_STATES.has(document.state)) throw new Error('Status state is invalid')
  if (!isPlainObject(document.scope) || document.scope.entity !== entity) {
    throw new Error('Status entity does not match the selected product')
  }

  const startedAt = checkedTimestamp(document.started_at)
  const finishedAt = checkedTimestamp(document.finished_at, { nullable: true })
  if (document.state === 'running' && finishedAt !== null) throw new Error('Running status cannot be finished')
  if (document.state !== 'running' && finishedAt === null) throw new Error('Terminal status must have a finish time')
  if (typeof document.scope.reconciliation !== 'boolean') throw new Error('Status reconciliation scope is invalid')

  const durationMs = document.duration_ms == null ? null : document.duration_ms
  if (durationMs !== null && (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 7 * 24 * 60 * 60 * 1000)) {
    throw new Error('Status duration is invalid')
  }
  const exitCode = document.exit_code == null ? null : document.exit_code
  if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255)) {
    throw new Error('Status exit code is invalid')
  }
  if (document.state === 'running' && (durationMs !== null || exitCode !== null)) {
    throw new Error('Running status cannot have terminal metrics')
  }
  if (document.state !== 'running') {
    const elapsed = Date.parse(finishedAt) - Date.parse(startedAt)
    if (elapsed < 0 || durationMs !== elapsed) throw new Error('Terminal status duration is inconsistent')
    if (exitCode === null) throw new Error('Terminal status must have an exit code')
    if (['succeeded', 'skipped'].includes(document.state) && exitCode !== 0) {
      throw new Error('Successful status must have a zero exit code')
    }
    if (document.state === 'failed' && exitCode === 0) throw new Error('Failed status must have a nonzero exit code')
  }

  return {
    state: document.state,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    exit_code: exitCode,
    scope: {
      entity,
      reconciliation: document.scope.reconciliation,
    },
  }
}

function readExactFile(path, maxBytes) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Status path is not a regular file')
  if (stat.size > maxBytes) throw new Error('Status file is oversized')
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const bytes = readFileSync(descriptor)
    if (bytes.byteLength > maxBytes) throw new Error('Status file is oversized')
    return bytes.toString('utf8')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function statusResult(kind, run = null) {
  return { kind, ...(run ? { run } : {}) }
}

function readFoodRuntimePublicationStatus(root, entity, {
  nowMs = Date.now(),
  maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES,
} = {}) {
  const selectedEntity = checkedEntity(entity)
  if (!root) return statusResult('not_configured')
  if (typeof root !== 'string' || !isAbsolute(root)) return statusResult('invalid_configuration')
  if (!Number.isFinite(nowMs)) return statusResult('invalid_configuration')
  const ageMinutes = Number(maxAgeMinutes)
  if (!Number.isFinite(ageMinutes) || ageMinutes <= 0) return statusResult('invalid_configuration')

  const path = join(root, STATUS_FILES[selectedEntity])
  let document
  try {
    document = JSON.parse(readExactFile(path, MAX_STATUS_BYTES))
  } catch (error) {
    if (error?.code === 'ENOENT') return statusResult('missing')
    return statusResult('invalid')
  }

  let run
  try {
    run = sanitizeRunState(document, selectedEntity)
  } catch {
    return statusResult('invalid')
  }
  const observedAtMs = Date.parse(run.finished_at || run.started_at)
  if (observedAtMs > nowMs + FUTURE_TOLERANCE_MS) return statusResult('invalid')
  if (nowMs - observedAtMs > ageMinutes * 60 * 1000) return statusResult('stale', run)
  return statusResult('ok', run)
}

function foodRuntimePublicationStatusResponse(root, entity, options = {}) {
  const selectedEntity = checkedEntity(entity)
  const nowMs = options.nowMs ?? Date.now()
  const generatedAt = new Date(nowMs).toISOString()
  const result = readFoodRuntimePublicationStatus(root, selectedEntity, { ...options, nowMs })
  const product = selectedEntity === 'taco' ? 'Taco' : 'Pizza'

  if (result.kind === 'not_configured') {
    return {
      available: false,
      state: 'not_configured',
      label: 'External status not configured',
      detail: `${product} publication runs externally; configure FOOD_PIPELINE_STATUS_ROOT to display its status.`,
      generatedAt,
    }
  }
  if (result.kind === 'missing') {
    return {
      available: false,
      state: 'missing',
      label: 'No external publish status',
      detail: `No ${product} compatibility-runtime publication status has been recorded yet.`,
      generatedAt,
    }
  }
  if (result.kind === 'stale') {
    return {
      available: false,
      state: 'stale',
      label: 'External publish status is stale',
      detail: `The last ${product} compatibility-runtime publication status is too old to present as current.`,
      generatedAt,
      lastRun: result.run,
    }
  }
  if (result.kind !== 'ok') {
    return {
      available: false,
      state: 'unavailable',
      label: 'External publish status unavailable',
      detail: `The ${product} compatibility-runtime publication status could not be safely read.`,
      generatedAt,
    }
  }

  const labels = {
    running: 'Publishing in progress',
    succeeded: 'Last publish succeeded',
    skipped: 'Last publish skipped',
    failed: 'Last publish failed',
  }
  const details = {
    running: `The external ${product} compatibility publisher is running.`,
    succeeded: `The external ${product} compatibility publisher completed successfully.`,
    skipped: `The external ${product} compatibility publisher skipped its latest bounded run.`,
    failed: `The external ${product} compatibility publisher reported a failed run.`,
  }
  return {
    available: true,
    state: result.run.state,
    label: labels[result.run.state],
    detail: details[result.run.state],
    generatedAt,
    lastRun: result.run,
  }
}

module.exports = {
  DEFAULT_MAX_AGE_MINUTES,
  MAX_STATUS_BYTES,
  STATUS_FILES,
  foodRuntimePublicationStatusResponse,
  readFoodRuntimePublicationStatus,
}
