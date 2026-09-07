#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  CANONICAL_MIRROR_COLS,
  OVERWRITE_COLS,
  QA_DEFAULT_COLS,
  syncColumnsForEntity,
} from '../lib/supabase-sync-policy.mjs'
import { supabaseSyncProfile } from '../lib/supabase-sync-profiles.mjs'

const ROOT = process.cwd()
const read = path => readFileSync(resolve(ROOT, path), 'utf8')
const readJson = path => JSON.parse(read(path))
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const digest = path => `sha256:${createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex')}`
const sorted = values => [...values].sort()

const boundary = readJson('config/pipeline-boundary.json')
const statusSchema = readJson(boundary.status.schema.file)
const canonical = readJson('config/canonical-contract.json')
const profiles = readJson('config/entity-profiles.json')
const server = read('server/index.js')
const statusBoundary = read('shared/pipeline-status-boundary.cjs')
const writer = read('scripts/ops/write-pipeline-status.mjs')

assert(boundary.version === 1, 'pipeline boundary version must be 1')
assert(boundary.externalPipeline?.writeEnabled === false, 'external pipeline writes must remain disabled')
assert(Array.isArray(boundary.externalPipeline.effectAllowlist) && boundary.externalPipeline.effectAllowlist.length === 0, 'external effect allowlist must remain empty')
assert(Array.isArray(boundary.externalPipeline.operationAllowlist) && boundary.externalPipeline.operationAllowlist.length === 0, 'external operation allowlist must remain empty')

const expected = {
  pizza: {
    name: 'apizza-pipeline-write-contract',
    profile: 'apizzamichigan',
    table: 'pizza_places',
    rpc: 'apply_pizza_places_sync_batch',
    role: 'map_pipeline_apizza_writer',
    defaultLane: 'legacy',
    registeredLane: 'legacy',
  },
  taco: {
    name: 'taco-pipeline-write-contract',
    profile: 'tacoboutmichigan',
    table: 'taco_places',
    rpc: 'apply_taco_places_sync_batch',
    role: 'map_pipeline_taco_writer',
    defaultLane: 'disabled',
    registeredLane: null,
  },
}
const paths = new Set()
const digests = new Set()

for (const [entity, expectation] of Object.entries(expected)) {
  const statusTarget = boundary.status.targets?.[entity]
  assert(statusTarget, `status target missing: ${entity}`)
  assert(statusTarget.profile === expectation.profile, `status profile mismatch: ${entity}`)
  assert(statusTarget.defaultLane === expectation.defaultLane, `unsafe default status lane: ${entity}`)
  assert(statusTarget.contract.name === expectation.name && statusTarget.contract.version === 1, `status contract binding mismatch: ${entity}`)

  const contract = readJson(statusTarget.contract.file)
  assert(contract.contractSchemaVersion === 1 && contract.version === 1, `target contract version mismatch: ${entity}`)
  assert(contract.ownerRepository === 'Antwohlf/apizzamichigan', `target contract owner mismatch: ${entity}`)
  assert(contract.name === expectation.name, `target contract name mismatch: ${entity}`)
  assert(contract.profile === expectation.profile && contract.entity === entity, `target contract identity mismatch: ${entity}`)
  assert(contract.localCanonical?.table === expectation.table, `local target table mismatch: ${entity}`)
  assert(contract.publicMirror?.table === expectation.table, `public target table mismatch: ${entity}`)
  assert(contract.localCanonical?.primaryKey?.column === 'id' && contract.publicMirror?.primaryKey?.column === 'id', `primary key mismatch: ${entity}`)
  assert(contract.deployment?.externalApplyEnabled === false && contract.deployment?.verifiedOnProduction === false, `target contract must remain unverified and inert: ${entity}`)
  assert(contract.externalAuthorization?.enabled === false, `external target authorization must remain disabled: ${entity}`)
  assert(contract.externalAuthorization.requiredPrincipal === expectation.role, `narrow external role mismatch: ${entity}`)
  assert(contract.externalAuthorization.requiredPrincipal !== 'service_role', `external role must not be service_role: ${entity}`)
  assert(contract.externalAuthorization.allowedEffects.length === 0 && contract.externalAuthorization.allowedOperations.length === 0, `external authorization allowlists must remain empty: ${entity}`)
  assert(contract.legacyCapability?.rpc?.name === expectation.rpc, `legacy RPC mismatch: ${entity}`)
  assert(contract.legacyCapability?.rpc?.currentExecuteRole === 'service_role', `legacy credential class must be recorded honestly: ${entity}`)
  assert(contract.legacyCapability?.deploymentState.startsWith('unverified'), `legacy deployment state must remain unverified: ${entity}`)
  assert(contract.legacyCapability?.kind === 'update-existing', `legacy capability must remain update-existing only: ${entity}`)
  assert(!contract.legacyCapability.allowedPatchFields.includes('name'), `identity field became patchable: ${entity}`)
  assert(!contract.legacyCapability.allowedPatchFields.includes('rating'), `editorial field became patchable: ${entity}`)

  const expectedPatchFields = sorted([
    ...syncColumnsForEntity(OVERWRITE_COLS, entity),
    ...syncColumnsForEntity(CANONICAL_MIRROR_COLS, entity),
    ...syncColumnsForEntity(QA_DEFAULT_COLS, entity),
    'lifecycle_status',
    'lifecycle_replaced_by_id',
  ])
  assert(
    JSON.stringify(sorted(contract.legacyCapability.allowedPatchFields)) === JSON.stringify(expectedPatchFields),
    `legacy patch fields drifted from entity sync policy: ${entity}`,
  )
  assert(supabaseSyncProfile(entity).targetTable === expectation.table, `sync profile table mismatch: ${entity}`)
  assert(supabaseSyncProfile(entity).bulkRpc === expectation.rpc, `sync profile RPC mismatch: ${entity}`)
  assert(profiles.profiles?.[entity]?.canonical_table === expectation.table, `entity profile table mismatch: ${entity}`)
  assert(canonical.canonical_tables?.[entity] === expectation.table, `canonical table registry mismatch: ${entity}`)

  const contractDigest = digest(statusTarget.contract.file)
  assert(!digests.has(contractDigest), 'Pizza and Taco target contracts must have distinct digests')
  digests.add(contractDigest)
  for (const [lane, laneConfig] of Object.entries(statusTarget.lanes || {})) {
    assert(['legacy', 'shadow', 'apply'].includes(lane), `unknown status lane: ${entity}/${lane}`)
    assert(!paths.has(laneConfig.relativePath), `status path is shared across identities: ${laneConfig.relativePath}`)
    assert(laneConfig.relativePath.startsWith(`${entity}/`), `status path is not entity-scoped: ${entity}/${lane}`)
    assert(laneConfig.relativePath.endsWith(`/${lane}.json`), `status path is not lane-scoped: ${entity}/${lane}`)
    assert(laneConfig.registration && Object.keys(laneConfig.registration).length === 1, `status registration must be explicit and exact: ${entity}/${lane}`)
    assert(
      laneConfig.registration.state === (lane === expectation.registeredLane ? 'registered' : 'unregistered'),
      `status lane has unsafe registration state: ${entity}/${lane}`,
    )
    paths.add(laneConfig.relativePath)
  }
}

assert(statusSchema.additionalProperties === false, 'status schema must reject unknown top-level fields')
for (const key of ['purpose', 'lane', 'bindings', 'profile', 'entity', 'observedAt', 'publishedAt', 'producer', 'run', 'health', 'ui']) {
  assert(statusSchema.required.includes(key), `status schema is missing required field: ${key}`)
}
assert(statusSchema.properties?.health?.properties?.issues?.maxItems <= 20, 'status issues must remain bounded')
assert(!Object.hasOwn(statusSchema.properties.health.properties.issues.items.properties, 'message'), 'status issues must not transport raw messages')
assert(statusSchema.properties.ui.additionalProperties === false, 'status UI projection must reject unknown fields')

assert(!server.includes("'invalid-admin-session-secret'"), 'admin server must not use a public signing fallback')
assert(server.includes('validateAdminSessionValue'), 'admin server must validate server-side session expiry')
assert(/app\.get\('\/api\/admin\/pipeline-status', requireSignedAdminSession,/.test(server), 'pipeline status must require only a valid signed admin session')
assert(!/app\.get\('\/api\/admin\/pipeline-status', requireAdminAuth,/.test(server), 'pipeline status must not require the Supabase service client')
assert(server.includes("res.set('Cache-Control', 'no-store')"), 'pipeline status must disable response caching')
assert(server.includes("return res.status(400).json({ error: 'Pipeline status entity must be pizza or taco' })"), 'pipeline status must reject unknown entities')
assert(!server.includes('process.env.PIPELINE_STATUS_PATH'), 'server must not fall back to the shared legacy status path')
assert(statusBoundary.includes("reason: 'pipeline_lane_unregistered'"), 'status resolver must fail closed for unregistered lanes')
assert(statusBoundary.includes('unsupported without exact runtime bindings'), 'external status registration must require a future exact-binding implementation')
assert(statusBoundary.includes("SUPPORTED_LEGACY_STATUS_IDENTITIES = new Set(['pizza:apizzamichigan:legacy'])"), 'legacy status registration must be code-bound to the entity-safe APizza collector')
assert(writer.includes("entity !== 'pizza'"), 'legacy status writer must reject entity-unsafe Taco collection')
assert(!writer.includes('process.exitCode = 0'), 'legacy status writer must not hide collector failure')
assert(writer.includes('validatePipelineStatusDocument'), 'legacy status writer must validate before publish')

console.log('# Pipeline Boundary Contract Verification')
console.log('')
console.log(`contracts=${Object.keys(expected).length}`)
console.log(`contract_digests=${[...digests].join(',')}`)
console.log(`status_paths=${paths.size}`)
console.log('external_apply=disabled')
console.log('status=ok')
