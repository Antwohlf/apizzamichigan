#!/usr/bin/env node
/**
 * Publish the app-owned v1 observation snapshot for the entity-safe legacy
 * collector. This is display-only status; it cannot authorize pipeline apply.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const {
  buildLegacyPipelineStatusDocument,
  resolveStatusSelection,
  validatePipelineStatusDocument,
  writePipelineStatusSnapshot,
} = require('../../shared/pipeline-status-boundary.cjs')

const root = process.cwd()
const boundary = JSON.parse(readFileSync(resolve(root, 'config/pipeline-boundary.json'), 'utf8'))
const entityIndex = process.argv.indexOf('--entity')
const entity = String(entityIndex >= 0 ? process.argv[entityIndex + 1] : process.env.PIPELINE_STATUS_ENTITY || 'pizza')
  .trim()
  .toLowerCase()

if (entity !== 'pizza') {
  throw new Error('The legacy status collector is only entity-safe for pizza; Taco status remains disabled')
}

const targetConfig = boundary.status.targets[entity]
const selection = resolveStatusSelection(
  boundary,
  entity,
  { ...process.env, [targetConfig.laneEnvVariable]: 'legacy' },
  root,
)
if (!selection.enabled || selection.lane !== 'legacy') throw new Error('Legacy pipeline status lane is unavailable')

const contractBytes = readFileSync(resolve(root, targetConfig.contract.file))
const targetContract = JSON.parse(contractBytes.toString('utf8'))
const targetContractBinding = {
  name: targetContract.name,
  version: targetContract.version,
  digest: `sha256:${createHash('sha256').update(contractBytes).digest('hex')}`,
}

const result = spawnSync(process.execPath, [resolve(root, 'scripts/ops/pipeline-alert-report.mjs'), '--json'], {
  cwd: root,
  encoding: 'utf8',
  timeout: Number.parseInt(process.env.PIPELINE_STATUS_TIMEOUT_MS || '120000', 10),
  env: process.env,
  maxBuffer: boundary.status.maxBytes,
})

let report
let collectorFailed = Boolean(result.error || result.signal || result.status !== 0)
try {
  report = JSON.parse(result.stdout || '')
} catch {
  collectorFailed = true
  report = {
    generatedAt: new Date().toISOString(),
    state: 'FAIL',
    alerts: ['invalid collector result'],
    warnings: [],
  }
}
if (collectorFailed && (!Array.isArray(report.alerts) || report.alerts.length === 0)) {
  report = { ...report, state: 'FAIL', alerts: ['collector failed'] }
}

const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 5_000,
})
const producerCommit = commitResult.status === 0 ? commitResult.stdout.trim() : 'unavailable'
const document = buildLegacyPipelineStatusDocument(report, {
  entity,
  profile: selection.profile,
  partition: targetContract.partition,
  targetContract: targetContractBinding,
  producerCommit,
  deploymentIdentity: process.env.PIPELINE_DEPLOYMENT_ID || 'legacy-app-runtime',
})
const expected = { ...selection, targetContract: targetContractBinding }
const validation = validatePipelineStatusDocument(document, expected, {
  futureToleranceMinutes: boundary.status.futureToleranceMinutes,
})
if (!validation.ok) throw new Error(`Refusing to publish invalid pipeline status: ${validation.errors.join('; ')}`)

writePipelineStatusSnapshot(selection.path, document)
console.log(`pipeline_status=${document.health.state}`)
console.log(`pipeline_status_entity=${entity}`)
console.log('pipeline_status_lane=legacy')
if (collectorFailed) process.exitCode = 1
