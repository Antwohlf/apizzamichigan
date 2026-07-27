import test from 'node:test'
import assert from 'node:assert/strict'
import { executionContext, nextActions, repositoryContext, summarizeFailure, summarizeOperationalReadiness } from './project-readiness-report.mjs'

test('includes non-secret execution context so reports are attributable to a machine', () => {
  const context = executionContext({
    hostname: 'Ants-iMac.local',
    platform: 'darwin',
    cwd: '/Users/ant/clawd/projects/apizzamichigan',
  })

  assert.equal(context.hostname, 'Ants-iMac.local')
  assert.equal(context.platform, 'darwin')
  assert.equal(context.cwd, '/Users/ant/clawd/projects/apizzamichigan')
  assert.match(context.node_version, /^v\d+/)
})

test('includes repository identity and dirty state for stale-checkout detection', () => {
  const values = new Map([
    [['rev-parse', '--abbrev-ref', 'HEAD'].join(' '), 'main\n'],
    [['rev-parse', '--short', 'HEAD'].join(' '), '2507ae0\n'],
    [['rev-parse', '--short', 'origin/main'].join(' '), '2507ae0\n'],
    [['rev-list', '--left-right', '--count', 'HEAD...origin/main'].join(' '), '0 0\n'],
    [['status', '--porcelain'].join(' '), ''],
  ])
  const context = repositoryContext({ readGit: args => values.get(args.join(' ')) || '' })

  assert.deepEqual(context, {
    branch: 'main',
    head: '2507ae0',
    origin_main: '2507ae0',
    sync_state: 'aligned',
    clean: true,
  })
})

test('summarizes connection failures without leaking stack traces', () => {
  const message = summarizeFailure('AggregateError [ECONNREFUSED]:\n    at afterConnectMultiple\n    at /Users/ant/project/report.mjs:12:3')
  assert.equal(message, 'required local service unavailable (connection refused)')
})

test('summarizes missing environment credentials', () => {
  assert.equal(
    summarizeFailure('Error: Missing VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local'),
    'required credentials are unavailable in .env.local'
  )
})

test('preserves structured sync failures from a JSON sub-check', () => {
  const result = summarizeOperationalReadiness({
    runtime: { ok: true },
    syncPolicy: { ok: true },
    sync: {
      ok: false,
      value: {
        status: 'UNAVAILABLE',
        publicationReadiness: { status: 'BLOCKED', reason: 'Supabase credentials are unavailable in .env.local' },
      },
      error: 'Supabase credentials are unavailable in .env.local',
    },
    reviewedNew: { ok: false, error: 'not checked' },
    homeStatus: null,
  })

  assert.equal(result.evidence[0], 'sync_status=UNAVAILABLE')
  assert.match(result.remaining.join('\n'), /Supabase credentials are unavailable/)
})

test('keeps actionable source messages concise', () => {
  assert.equal(
    summarizeFailure('reports/osm/mi-pizza.json.manifest.json is incomplete; 948 unprocessed tiles remain'),
    'reports/osm/mi-pizza.json.manifest.json is incomplete; 948 unprocessed tiles remain'
  )
})

test('does not report operations ready when required local services are unavailable', () => {
  const result = summarizeOperationalReadiness({
    runtime: { ok: true },
    syncPolicy: { ok: true },
    sync: { ok: true, value: { status: 'OK', bulkRpc: { state: 'ready' } } },
    reviewedNew: { ok: true, value: { missing_count: 0 } },
    homeStatus: {
      launchd: [
        { label: 'com.apizzamichigan.source-pipeline', ok: false },
        { label: 'com.apizzamichigan.classifier', ok: true, operationalState: 'running' },
        { label: 'com.apizzamichigan.backup', ok: false },
      ],
      backup: { ok: false, error: 'no backup manifests found' },
    },
  })

  assert.equal(result.ready, false)
  assert.match(result.remaining.join('\n'), /source pipeline service is unavailable/)
  assert.match(result.remaining.join('\n'), /backup service is unavailable/)
  assert.match(result.remaining.join('\n'), /local backups: no backup manifests found/)
})

test('accepts scheduled source and backup jobs plus a running classifier', () => {
  const result = summarizeOperationalReadiness({
    runtime: { ok: true },
    syncPolicy: { ok: true },
    sync: { ok: true, value: { status: 'OK', bulkRpc: { state: 'ready' } } },
    reviewedNew: { ok: true, value: { missing_count: 0 } },
    homeStatus: {
      launchd: [
        { label: 'com.apizzamichigan.source-pipeline', ok: true, operationalState: 'scheduled_idle' },
        { label: 'com.apizzamichigan.classifier', ok: true, operationalState: 'running' },
        { label: 'com.apizzamichigan.backup', ok: true, operationalState: 'scheduled_idle' },
      ],
      backup: { ok: true },
    },
  })

  assert.equal(result.ready, true)
  assert.deepEqual(result.remaining, [])
})

test('accepts scheduled source and backup jobs reported under schedulers', () => {
  const result = summarizeOperationalReadiness({
    runtime: { ok: true },
    syncPolicy: { ok: true },
    sync: { ok: true, value: { status: 'OK', bulkRpc: { state: 'ready' } } },
    reviewedNew: { ok: true, value: { missing_count: 0 } },
    homeStatus: {
      launchd: [
        { label: 'com.apizzamichigan.classifier', ok: true, operationalState: 'running' },
      ],
      schedulers: [
        { label: 'com.apizzamichigan.source-pipeline', ok: true, operationalState: 'scheduled_idle' },
        { label: 'com.apizzamichigan.backup', ok: true, operationalState: 'scheduled_idle' },
      ],
      backup: { ok: true },
    },
  })

  assert.equal(result.ready, true)
  assert.deepEqual(result.remaining, [])
})

test('orders actionable handoff items by the next production gate and removes duplicates', () => {
  const actions = nextActions([
    { workstream: '5. Product/UI', status: 'partial', remaining: ['check the rendered mobile layout'] },
    { workstream: '6. Operations', status: 'partial', remaining: ['apply the bulk RPC migration', 'apply the bulk RPC migration'] },
    { workstream: '7. Public schema and search performance', status: 'partial', remaining: ['enable lifecycle sync after readiness'] },
  ])

  assert.deepEqual(actions, [
    { workstream: '6. Operations', action: 'apply the bulk RPC migration' },
    { workstream: '7. Public schema and search performance', action: 'enable lifecycle sync after readiness' },
    { workstream: '5. Product/UI', action: 'check the rendered mobile layout' },
  ])
})
