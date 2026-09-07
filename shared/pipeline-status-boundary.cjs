'use strict'

const {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const { dirname, isAbsolute, resolve, sep } = require('node:path')

const SCHEMA_NAME = 'map-data-pipeline.status'
const SCHEMA_VERSION = 1
const PURPOSE = 'operations-display-only'
const LANES = new Set(['legacy', 'shadow', 'apply'])
const HEALTH_STATES = new Set(['ok', 'warn', 'fail'])
const ISSUE_CODES = new Set([
  'pipeline.operational-failure',
  'pipeline.operational-warning',
  'source.feeder-unavailable',
  'source.stale',
  'classifier.unavailable',
  'publication.unavailable',
])
const SOURCE_FEEDER_STATES = new Set([
  'running', 'idle', 'stopped', 'missing', 'not_found', 'unsupported', 'unavailable', 'unknown',
])
const CLASSIFIER_STATES = new Set(['ok', 'warn', 'fail', 'unknown'])
const BACKLOG_STATES = new Set(['queued', 'partial_retry_pending', 'manual_review', 'unfed', 'clear', 'unknown'])
const ACTIVATION_STATES = new Set(['ready', 'disabled', 'incomplete', 'unknown'])
const EXECUTION_STATES = new Set(['scheduler', 'manual', 'not-implemented'])
const SUPPORTED_LEGACY_STATUS_IDENTITIES = new Set(['pizza:apizzamichigan:legacy'])
const SHA256 = /^sha256:[a-f0-9]{64}$/
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]*$/
const PARTITION = /^[A-Za-z0-9][A-Za-z0-9._:/,-]*$/
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const STATUS_FILE_MODE_MASK = 0o077
const MAX_JSON_DEPTH = 12
const MAX_JSON_NODES = 2_000

const ISSUE_COPY = Object.freeze({
  'pipeline.operational-failure': 'The pipeline reported an operational failure.',
  'pipeline.operational-warning': 'The pipeline reported an operational warning.',
  'source.feeder-unavailable': 'The configured source feeder is unavailable.',
  'source.stale': 'One or more source snapshots need a fresh observation.',
  'classifier.unavailable': 'Classification status is unavailable.',
  'publication.unavailable': 'Publication status is unavailable.',
})

const SOURCE_FEEDER_COPY = Object.freeze({
  running: 'The source feeder is running.',
  idle: 'The source feeder is loaded and waiting for its next scheduled run.',
  stopped: 'The source feeder is stopped.',
  missing: 'The source feeder is not installed.',
  not_found: 'The source feeder is not loaded.',
  unsupported: 'Source feeder status is unsupported on this host.',
  unavailable: 'Source feeder status is unavailable.',
  unknown: 'Source feeder state is unknown.',
})

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, required, allowed, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`)
  }
  return true
}

function boundedString(value, { min = 1, max, pattern = null } = {}, path, errors) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    errors.push(`${path} is invalid`)
    return false
  }
  return true
}

function boundedNumber(value, { min = 0, max = 1_000_000_000_000, integer = false } = {}, path, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    errors.push(`${path} is invalid`)
    return false
  }
  return true
}

function isoTime(value, path, errors) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    errors.push(`${path} must be a UTC ISO timestamp`)
    return null
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    errors.push(`${path} must be a valid timestamp`)
    return null
  }
  return milliseconds
}

function measureJson(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1
  if (depth > MAX_JSON_DEPTH || state.nodes > MAX_JSON_NODES) return false
  if (!value || typeof value !== 'object') return true
  const children = Array.isArray(value) ? value : Object.values(value)
  return children.every(child => measureJson(child, depth + 1, state))
}

function validateDigestOrNull(value, path, errors) {
  if (value !== null && (typeof value !== 'string' || !SHA256.test(value))) errors.push(`${path} is invalid`)
}

function validateBindings(value, expected, errors) {
  if (!exactKeys(
    value,
    ['targetContract', 'definitionDigest', 'profileDigest', 'catalogDigest', 'hostPolicyDigest', 'deploymentIdentity'],
    ['targetContract', 'definitionDigest', 'profileDigest', 'catalogDigest', 'hostPolicyDigest', 'deploymentIdentity'],
    'status.bindings',
    errors,
  )) return

  const target = value.targetContract
  if (exactKeys(target, ['name', 'version', 'digest'], ['name', 'version', 'digest'], 'status.bindings.targetContract', errors)) {
    if (target.name !== expected.targetContract.name) errors.push('status.bindings.targetContract.name does not match the selected app contract')
    if (target.version !== expected.targetContract.version) errors.push('status.bindings.targetContract.version does not match the selected app contract')
    if (target.digest !== expected.targetContract.digest) errors.push('status.bindings.targetContract.digest does not match the selected app contract')
  }

  for (const key of ['definitionDigest', 'profileDigest', 'catalogDigest', 'hostPolicyDigest']) {
    validateDigestOrNull(value[key], `status.bindings.${key}`, errors)
  }
  boundedString(value.deploymentIdentity, { max: 100, pattern: DEPLOYMENT_ID }, 'status.bindings.deploymentIdentity', errors)

  const executionDigests = ['definitionDigest', 'profileDigest', 'catalogDigest', 'hostPolicyDigest']
  if (expected.lane === 'legacy') {
    for (const key of executionDigests) {
      if (value[key] !== null) errors.push(`status.bindings.${key} must be null for the legacy lane`)
    }
  } else {
    for (const key of executionDigests) {
      if (typeof value[key] !== 'string' || !SHA256.test(value[key])) {
        errors.push(`status.bindings.${key} is required for the ${expected.lane} lane`)
      }
    }
  }
}

function validateProducer(value, expected, errors) {
  if (!exactKeys(
    value,
    ['kind', 'repository', 'component', 'version', 'commit'],
    ['kind', 'repository', 'component', 'version', 'commit'],
    'status.producer',
    errors,
  )) return
  if (value.kind !== expected.producerKind) errors.push('status.producer.kind does not match the selected lane')
  if (value.repository !== expected.producerRepository) errors.push('status.producer.repository does not match the selected lane')
  boundedString(value.repository, { min: 3, max: 120 }, 'status.producer.repository', errors)
  boundedString(value.component, { max: 100 }, 'status.producer.component', errors)
  boundedString(value.version, { max: 80 }, 'status.producer.version', errors)
  if (typeof value.commit !== 'string' || !/^(?:[a-f0-9]{40}|unavailable)$/.test(value.commit)) {
    errors.push('status.producer.commit is invalid')
  }
}

function validateRun(value, expected, publishedAtMs, errors) {
  if (!exactKeys(value, ['id', 'mode', 'state'], ['id', 'mode', 'state', 'startedAt', 'finishedAt'], 'status.run', errors)) return
  boundedString(value.id, { max: 128 }, 'status.run.id', errors)
  const requiredMode = expected.lane === 'legacy' ? 'observe' : expected.lane === 'shadow' ? 'preview' : 'apply'
  if (value.mode !== requiredMode) errors.push('status.run.mode does not match the selected lane')
  if (!['running', 'succeeded', 'failed'].includes(value.state)) errors.push('status.run.state is invalid')
  const startedAtMs = value.startedAt === undefined ? null : isoTime(value.startedAt, 'status.run.startedAt', errors)
  const finishedAtMs = value.finishedAt === undefined ? null : isoTime(value.finishedAt, 'status.run.finishedAt', errors)
  if (startedAtMs !== null && finishedAtMs !== null && finishedAtMs < startedAtMs) {
    errors.push('status.run.finishedAt precedes status.run.startedAt')
  }
  if (finishedAtMs !== null && publishedAtMs !== null && finishedAtMs > publishedAtMs) {
    errors.push('status.run.finishedAt follows status.publishedAt')
  }
  if (value.state === 'running' && value.finishedAt !== undefined) errors.push('a running status cannot have status.run.finishedAt')
  if (value.state !== 'running' && value.finishedAt === undefined) errors.push('a completed status requires status.run.finishedAt')
}

function validateHealth(value, errors) {
  if (!exactKeys(value, ['state', 'issues'], ['state', 'issues'], 'status.health', errors)) return
  if (!HEALTH_STATES.has(value.state)) errors.push('status.health.state is invalid')
  if (!Array.isArray(value.issues) || value.issues.length > 20) {
    errors.push('status.health.issues is invalid')
    return
  }
  const seen = new Set()
  let errorCount = 0
  let warningCount = 0
  value.issues.forEach((issue, index) => {
    const path = `status.health.issues[${index}]`
    if (!exactKeys(issue, ['severity', 'code', 'count'], ['severity', 'code', 'count'], path, errors)) return
    if (!['error', 'warning'].includes(issue.severity)) errors.push(`${path}.severity is invalid`)
    if (!ISSUE_CODES.has(issue.code)) errors.push(`${path}.code is invalid`)
    if (seen.has(issue.code)) errors.push(`${path}.code is duplicated`)
    seen.add(issue.code)
    boundedNumber(issue.count, { min: 1, max: 1_000_000_000, integer: true }, `${path}.count`, errors)
    if (issue.severity === 'error') errorCount += issue.count
    if (issue.severity === 'warning') warningCount += issue.count
  })
  if (value.state === 'ok' && value.issues.length) errors.push('an ok status cannot contain issues')
  if (value.state === 'warn' && (warningCount < 1 || errorCount > 0)) errors.push('a warn status requires warnings and no errors')
  if (value.state === 'fail' && errorCount < 1) errors.push('a fail status requires an error')
}

function validateBacklog(value, path, errors) {
  const allowed = ['candidates', 'retryablePartial', 'exhaustedPartial', 'state', 'estimatedHours', 'estimatedDays']
  if (!exactKeys(value, ['candidates', 'retryablePartial', 'exhaustedPartial', 'state'], allowed, path, errors)) return
  for (const key of ['candidates', 'retryablePartial', 'exhaustedPartial']) {
    boundedNumber(value[key], {}, `${path}.${key}`, errors)
  }
  if (!BACKLOG_STATES.has(value.state)) errors.push(`${path}.state is invalid`)
  for (const key of ['estimatedHours', 'estimatedDays']) {
    if (value[key] !== undefined && value[key] !== null) boundedNumber(value[key], {}, `${path}.${key}`, errors)
  }
  if (value.retryablePartial + value.exhaustedPartial > value.candidates) {
    errors.push(`${path} partial counts exceed candidates`)
  }
}

function validateUi(value, errors) {
  const allowed = ['sourceFeeder', 'classifier', 'freshness', 'sourceActivation']
  if (!exactKeys(value, [], allowed, 'status.ui', errors)) return
  if (value.sourceFeeder !== undefined) {
    if (exactKeys(value.sourceFeeder, ['state'], ['state'], 'status.ui.sourceFeeder', errors)
      && !SOURCE_FEEDER_STATES.has(value.sourceFeeder.state)) {
      errors.push('status.ui.sourceFeeder.state is invalid')
    }
  }
  if (value.classifier !== undefined) {
    if (exactKeys(value.classifier, ['state'], ['state', 'backlog'], 'status.ui.classifier', errors)) {
      if (!CLASSIFIER_STATES.has(value.classifier.state)) errors.push('status.ui.classifier.state is invalid')
      if (value.classifier.backlog !== undefined) validateBacklog(value.classifier.backlog, 'status.ui.classifier.backlog', errors)
    }
  }
  if (value.freshness !== undefined) {
    if (!Array.isArray(value.freshness) || value.freshness.length > 20) errors.push('status.ui.freshness is invalid')
    else {
      const seen = new Set()
      value.freshness.forEach((row, index) => {
        const path = `status.ui.freshness[${index}]`
        if (!exactKeys(row, ['source', 'freshRatioPercent', 'staleRows', 'eligibleRows'], ['source', 'freshRatioPercent', 'staleRows', 'eligibleRows'], path, errors)) return
        boundedString(row.source, { max: 80, pattern: SOURCE_ID }, `${path}.source`, errors)
        if (seen.has(row.source)) errors.push(`${path}.source is duplicated`)
        seen.add(row.source)
        boundedNumber(row.freshRatioPercent, { max: 100 }, `${path}.freshRatioPercent`, errors)
        boundedNumber(row.staleRows, {}, `${path}.staleRows`, errors)
        boundedNumber(row.eligibleRows, {}, `${path}.eligibleRows`, errors)
      })
    }
  }
  if (value.sourceActivation !== undefined) {
    if (!Array.isArray(value.sourceActivation) || value.sourceActivation.length > 20) errors.push('status.ui.sourceActivation is invalid')
    else {
      const seen = new Set()
      value.sourceActivation.forEach((row, index) => {
        const path = `status.ui.sourceActivation[${index}]`
        if (!exactKeys(row, ['source', 'status', 'execution', 'lastSuccess'], ['source', 'status', 'execution', 'lastSuccess'], path, errors)) return
        boundedString(row.source, { max: 80, pattern: SOURCE_ID }, `${path}.source`, errors)
        if (seen.has(row.source)) errors.push(`${path}.source is duplicated`)
        seen.add(row.source)
        if (!ACTIVATION_STATES.has(row.status)) errors.push(`${path}.status is invalid`)
        if (!EXECUTION_STATES.has(row.execution)) errors.push(`${path}.execution is invalid`)
        if (row.lastSuccess !== null) isoTime(row.lastSuccess, `${path}.lastSuccess`, errors)
      })
    }
  }
}

function validatePipelineStatusDocument(value, expected, {
  nowMs = Date.now(),
  futureToleranceMinutes = 5,
} = {}) {
  const errors = []
  if (!measureJson(value)) return { ok: false, errors: ['status exceeds structural limits'] }
  const topKeys = ['schema', 'purpose', 'lane', 'bindings', 'profile', 'entity', 'partition', 'observedAt', 'publishedAt', 'producer', 'run', 'health', 'ui']
  if (!exactKeys(value, topKeys, topKeys, 'status', errors)) return { ok: false, errors }

  if (exactKeys(value.schema, ['name', 'version'], ['name', 'version'], 'status.schema', errors)) {
    if (value.schema.name !== SCHEMA_NAME) errors.push('status.schema.name is unsupported')
    if (value.schema.version !== SCHEMA_VERSION) errors.push('status.schema.version is unsupported')
  }
  if (value.purpose !== PURPOSE) errors.push('status.purpose is invalid')
  if (!LANES.has(value.lane) || value.lane !== expected.lane) errors.push('status.lane does not match the selected lane')
  if (value.profile !== expected.profile) errors.push('status.profile does not match the selected entity')
  if (value.entity !== expected.entity) errors.push('status.entity does not match the selected entity')
  boundedString(value.partition, { max: 80, pattern: PARTITION }, 'status.partition', errors)

  const observedAtMs = isoTime(value.observedAt, 'status.observedAt', errors)
  const publishedAtMs = isoTime(value.publishedAt, 'status.publishedAt', errors)
  const futureLimit = nowMs + Math.max(0, futureToleranceMinutes) * 60_000
  if (observedAtMs !== null && observedAtMs > futureLimit) errors.push('status.observedAt is in the future')
  if (publishedAtMs !== null && publishedAtMs > futureLimit) errors.push('status.publishedAt is in the future')
  if (observedAtMs !== null && publishedAtMs !== null && publishedAtMs < observedAtMs) {
    errors.push('status.publishedAt precedes status.observedAt')
  }

  validateBindings(value.bindings, expected, errors)
  validateProducer(value.producer, expected, errors)
  validateRun(value.run, expected, publishedAtMs, errors)
  validateHealth(value.health, errors)
  if (value.run?.state === 'failed' && value.health?.state !== 'fail') {
    errors.push('a failed run requires failed health')
  }
  validateUi(value.ui, errors)
  return { ok: errors.length === 0, errors, observedAtMs, publishedAtMs }
}

function presenterIssue(issue) {
  const base = ISSUE_COPY[issue.code]
  return issue.count === 1 ? base : `${base} (${issue.count})`
}

function presentPipelineStatus(value, expected, options = {}) {
  const validation = validatePipelineStatusDocument(value, expected, options)
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      data: {
        available: false,
        entity: expected.entity,
        state: 'invalid',
        label: 'Pipeline status unavailable',
        detail: 'The latest pipeline snapshot failed contract validation. No pipeline work was started.',
        checkedAt: null,
      },
    }
  }

  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMinutes = options.maxAgeMinutes ?? 360
  const ageMinutes = Math.max(0, Math.round((nowMs - validation.observedAtMs) / 60_000))
  const stale = ageMinutes > maxAgeMinutes
  const state = stale
    ? 'stale'
    : value.run.state === 'running' ? 'running' : value.health.state
  const errorIssues = value.health.issues.filter(issue => issue.severity === 'error')
  const warningIssues = value.health.issues.filter(issue => issue.severity === 'warning')
  const label = stale
    ? 'Pipeline check is out of date'
    : state === 'running' ? 'Pipeline observation in progress'
    : state === 'ok' ? 'Pipeline healthy'
      : state === 'warn' ? 'Pipeline needs attention'
        : 'Pipeline needs repair'
  const detail = stale
    ? `Last observed ${ageMinutes} minutes ago.`
    : state === 'running'
      ? 'The selected runtime is still producing this read-only observation.'
    : state === 'ok'
      ? 'The latest read-only observation found no active issues.'
      : `${errorIssues.reduce((sum, issue) => sum + issue.count, 0)} issue${errorIssues.reduce((sum, issue) => sum + issue.count, 0) === 1 ? '' : 's'} and ${warningIssues.reduce((sum, issue) => sum + issue.count, 0)} warning${warningIssues.reduce((sum, issue) => sum + issue.count, 0) === 1 ? '' : 's'} need attention.`

  const sourceFeeder = value.ui.sourceFeeder
    ? { state: value.ui.sourceFeeder.state, detail: SOURCE_FEEDER_COPY[value.ui.sourceFeeder.state] }
    : null
  const sourceActivation = value.ui.sourceActivation
    ? {
      sources: value.ui.sourceActivation.map(row => ({
        source: row.source,
        status: row.status,
        execution: row.execution === 'scheduler' ? 'Scheduled' : row.execution === 'manual' ? 'Manual' : 'Not implemented',
        last_success: row.lastSuccess,
      })),
    }
    : null

  return {
    ok: true,
    errors: [],
    data: {
      available: true,
      entity: value.entity,
      state,
      label,
      detail,
      checkedAt: value.observedAt,
      publishedAt: value.publishedAt,
      ageMinutes,
      operationalLane: value.lane,
      authorityLabel: value.lane === 'shadow'
        ? 'Shadow only — non-authoritative'
        : value.lane === 'legacy' ? 'Legacy runtime observation' : 'External apply observation',
      alerts: errorIssues.map(presenterIssue),
      warnings: warningIssues.map(presenterIssue),
      sourcePipeline: sourceFeeder ? { scheduler: sourceFeeder } : null,
      classifier: value.ui.classifier || null,
      freshness: value.ui.freshness?.map(row => ({
        source: row.source,
        fresh_ratio_percent: row.freshRatioPercent,
        stale_rows: row.staleRows,
        eligible_rows: row.eligibleRows,
      })) || null,
      sourceActivation,
    },
  }
}

function normalizeState(value) {
  const state = String(value || '').trim().toLowerCase()
  return HEALTH_STATES.has(state) ? state : 'fail'
}

function safeNonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.min(number, 1_000_000_000_000) : 0
}

function buildLegacyPipelineStatusDocument(report, {
  entity,
  profile,
  partition,
  targetContract,
  producerCommit = 'unavailable',
  deploymentIdentity = 'legacy-app-runtime',
  publishedAt = new Date().toISOString(),
} = {}) {
  if (entity !== 'pizza' || profile !== 'apizzamichigan') {
    throw new Error('The legacy status collector is only entity-safe for the APizza profile')
  }
  const reportObject = isPlainObject(report) ? report : {}
  const rawAlerts = Array.isArray(reportObject.alerts) ? reportObject.alerts.length : 1
  const rawWarnings = Array.isArray(reportObject.warnings) ? reportObject.warnings.length : 0
  const state = rawAlerts > 0 ? 'fail' : rawWarnings > 0 ? 'warn' : normalizeState(reportObject.state)
  const issues = []
  if (rawAlerts > 0) issues.push({ severity: 'error', code: 'pipeline.operational-failure', count: Math.min(rawAlerts, 1_000_000_000) })
  if (rawWarnings > 0) issues.push({ severity: 'warning', code: 'pipeline.operational-warning', count: Math.min(rawWarnings, 1_000_000_000) })
  if (state === 'fail' && !issues.some(issue => issue.severity === 'error')) {
    issues.push({ severity: 'error', code: 'pipeline.operational-failure', count: 1 })
  }
  if (state === 'warn' && !issues.some(issue => issue.severity === 'warning')) {
    issues.push({ severity: 'warning', code: 'pipeline.operational-warning', count: 1 })
  }

  const reportObservedAt = isoTime(reportObject.generatedAt, 'legacy.generatedAt', []) === null
    ? publishedAt
    : reportObject.generatedAt
  const ui = {}
  const feederState = String(reportObject.sourcePipeline?.scheduler?.state || 'unknown').toLowerCase()
  ui.sourceFeeder = { state: SOURCE_FEEDER_STATES.has(feederState) ? feederState : 'unknown' }

  if (Array.isArray(reportObject.freshness)) {
    ui.freshness = reportObject.freshness.slice(0, 20).map(row => ({
      source: SOURCE_ID.test(String(row?.source || '')) ? String(row.source) : 'unknown',
      freshRatioPercent: Math.min(100, safeNonNegative(row?.fresh_ratio_percent)),
      staleRows: safeNonNegative(row?.stale_rows),
      eligibleRows: safeNonNegative(row?.eligible_rows),
    })).filter((row, index, rows) => rows.findIndex(candidate => candidate.source === row.source) === index)
  }

  if (reportObject.sourceActivation?.entity === entity && Array.isArray(reportObject.sourceActivation.sources)) {
    ui.sourceActivation = reportObject.sourceActivation.sources.slice(0, 20).map(row => ({
      source: SOURCE_ID.test(String(row?.source || '')) ? String(row.source) : 'unknown',
      status: ACTIVATION_STATES.has(row?.status) ? row.status : 'unknown',
      execution: String(row?.execution || '').includes('scheduler') ? 'scheduler' : 'manual',
      lastSuccess: isoTime(row?.last_success, 'legacy.lastSuccess', []) === null ? null : row.last_success,
    })).filter((row, index, rows) => rows.findIndex(candidate => candidate.source === row.source) === index)
  }

  return {
    schema: { name: SCHEMA_NAME, version: SCHEMA_VERSION },
    purpose: PURPOSE,
    lane: 'legacy',
    bindings: {
      targetContract,
      definitionDigest: null,
      profileDigest: null,
      catalogDigest: null,
      hostPolicyDigest: null,
      deploymentIdentity,
    },
    profile,
    entity,
    partition,
    observedAt: reportObservedAt,
    publishedAt,
    producer: {
      kind: 'legacy-app',
      repository: 'Antwohlf/apizzamichigan',
      component: 'write-pipeline-status.mjs',
      version: '1',
      commit: /^(?:[a-f0-9]{40})$/.test(producerCommit) ? producerCommit : 'unavailable',
    },
    run: {
      id: `legacy-pizza-${publishedAt.replace(/[^0-9]/g, '').slice(0, 17)}`,
      mode: 'observe',
      state: state === 'fail' ? 'failed' : 'succeeded',
      finishedAt: publishedAt,
    },
    health: { state, issues },
    ui,
  }
}

function resolveStatusSelection(boundary, entity, env = process.env, repositoryRoot = process.cwd()) {
  const targets = boundary?.status?.targets
  if (!isPlainObject(targets) || !Object.hasOwn(targets, entity)) throw new Error(`Unsupported pipeline status entity: ${entity}`)
  const target = targets[entity]
  const lane = String(env[target.laneEnvVariable] || target.defaultLane || '').trim().toLowerCase()
  if (lane === 'disabled') return { enabled: false, entity, profile: target.profile, lane }
  if (!LANES.has(lane) || !Object.hasOwn(target.lanes || {}, lane)) throw new Error(`Unsupported pipeline status lane for ${entity}`)
  const laneConfig = target.lanes[lane]
  if (!isPlainObject(laneConfig.registration)
    || Object.keys(laneConfig.registration).length !== 1
    || !['registered', 'unregistered'].includes(laneConfig.registration.state)) {
    throw new Error(`Invalid pipeline status registration for ${entity}/${lane}`)
  }
  if (lane === 'apply' && boundary.externalPipeline?.writeEnabled !== true) {
    return { enabled: false, entity, profile: target.profile, lane, reason: 'external_apply_disabled' }
  }
  const statusIdentity = `${entity}:${target.profile}:${lane}`
  if (lane === 'legacy'
    && laneConfig.registration.state === 'registered'
    && !SUPPORTED_LEGACY_STATUS_IDENTITIES.has(statusIdentity)) {
    throw new Error(`Legacy pipeline status registration is unsupported for ${entity}/${target.profile}`)
  }
  if (lane !== 'legacy' && laneConfig.registration.state === 'registered') {
    throw new Error(`External pipeline status registration is unsupported without exact runtime bindings: ${entity}/${lane}`)
  }
  if (laneConfig.registration.state !== 'registered') {
    return { enabled: false, entity, profile: target.profile, lane, reason: 'pipeline_lane_unregistered' }
  }
  const rootValue = env[boundary.status.root.envPathVariable] || boundary.status.root.defaultPath
  const statusRoot = isAbsolute(rootValue) ? resolve(rootValue) : resolve(repositoryRoot, rootValue)
  const path = resolve(statusRoot, laneConfig.relativePath)
  if (!path.startsWith(`${statusRoot}${sep}`)) throw new Error('Pipeline status path escapes the configured status root')
  return {
    enabled: true,
    entity,
    profile: target.profile,
    lane,
    path,
    producerKind: laneConfig.producerKind,
    producerRepository: laneConfig.producerRepository,
    targetContract: target.contract,
  }
}

function readPipelineStatusSnapshot(path, { maxBytes = 131_072 } = {}) {
  if (!existsSync(path)) return { state: 'missing' }
  const before = lstatSync(path)
  if (before.isSymbolicLink()) throw new Error('Pipeline status path must not be a symlink')
  if (!before.isFile()) throw new Error('Pipeline status path must be a regular file')
  if ((before.mode & STATUS_FILE_MODE_MASK) !== 0) throw new Error('Pipeline status file permissions are too broad')
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) throw new Error('Pipeline status file owner is unexpected')
  if (before.size > maxBytes) throw new Error('Pipeline status file exceeds the byte limit')

  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const opened = fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Pipeline status file changed before read')
    if (opened.size > maxBytes) throw new Error('Pipeline status file exceeds the byte limit')
    const bytes = readFileSync(fd)
    const after = fstatSync(fd)
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Pipeline status file changed during read')
    const current = lstatSync(path)
    if (current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('Pipeline status file was replaced during read')
    if (bytes.length > maxBytes) throw new Error('Pipeline status file exceeds the byte limit')
    return { state: 'read', text: bytes.toString('utf8') }
  } finally {
    closeSync(fd)
  }
}

function writePipelineStatusSnapshot(path, value) {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = statSync(directory)
  if (!directoryStat.isDirectory() || (directoryStat.mode & STATUS_FILE_MODE_MASK) !== 0) {
    throw new Error('Pipeline status directory permissions are too broad')
  }
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
  let fd = null
  try {
    fd = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(temporaryPath, path)
    const directoryFd = openSync(directory, constants.O_RDONLY)
    try {
      fsyncSync(directoryFd)
    } finally {
      closeSync(directoryFd)
    }
  } catch (error) {
    if (fd !== null) closeSync(fd)
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }
}

module.exports = {
  buildLegacyPipelineStatusDocument,
  presentPipelineStatus,
  readPipelineStatusSnapshot,
  resolveStatusSelection,
  validatePipelineStatusDocument,
  writePipelineStatusSnapshot,
}
