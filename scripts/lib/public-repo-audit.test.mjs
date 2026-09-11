import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { pathViolations, textViolations } from './public-repo-audit.mjs'

test('rejects generated data and local runtime paths', () => {
  assert.ok(pathViolations('.taco-metadata-progress.json').length)
  assert.ok(pathViolations('.taco-metadata-progress.json', { release: true }).length)
  assert.ok(pathViolations('scripts/.address-enrichment-pizza_places.json').length)
  assert.ok(pathViolations('scripts/.new-import-progress.json').length)
  assert.ok(pathViolations('output/browser.png').length)
  assert.ok(pathViolations('reports/source-review/export.json').length)
  assert.ok(pathViolations('scripts/queue.sqlite-wal').length)
  assert.ok(pathViolations('scripts/.pipeline-status/pizza/legacy.json').length)
  assert.deepEqual(pathViolations('data/source-samples/fixtures/fsq-os-places-pizza-fixture.json'), [])
})

test('permits owner-approved site content without weakening privacy checks', () => {
  const privatePath = ['', 'Users', 'alice', 'private', 'state'].join('/')
  for (const path of ['src/data.js', 'src/data/frozenTacos.js', 'src/data/tacoPlaces.js']) {
    assert.deepEqual(pathViolations(path, { release: true }), [])
    assert.ok(textViolations(path, privatePath, { release: true }).length)
    assert.ok(textViolations(path, "const ADMIN_PASSWORD = 'private-value'", { release: true }).length)
  }
  assert.ok(pathViolations('scripts/osm-pizza-import.sql', { release: true }).length)
})

test('rejects pipeline status snapshots at default and custom host paths', () => {
  const snapshot = JSON.stringify({
    schema: { name: 'map-data-pipeline.status', version: 1 },
    purpose: 'operations-display-only',
    bindings: { deploymentIdentity: 'private-host-runtime' },
  })
  assert.ok(pathViolations('scripts/.pipeline-status/taco/shadow.json').length)
  assert.ok(textViolations('runtime/pizza/legacy.json', snapshot).length)
  assert.ok(textViolations('runtime/pizza/legacy.json', snapshot, { release: true }).length)
  assert.deepEqual(
    textViolations('config/pipeline-boundary.json', readFileSync(resolve('config/pipeline-boundary.json'), 'utf8')),
    [],
  )
  assert.deepEqual(
    textViolations('contracts/pipeline-status.v1.schema.json', readFileSync(resolve('contracts/pipeline-status.v1.schema.json'), 'utf8')),
    [],
  )
})

test('permits the blank environment template and rejects real environment files', () => {
  assert.deepEqual(pathViolations('.env.example'), [])
  assert.ok(pathViolations('.env').length)
  assert.ok(pathViolations('.env.production.local').length)
})

test('rejects private credential assignments but permits placeholders', () => {
  assert.deepEqual(textViolations('.env.example', 'SUPABASE_SERVICE_ROLE_KEY=\nPGPASSWORD=<set-on-host>\n'), [])
  const assignment = `${['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')}=super-secret-value`
  const postgresUri = ['postgres', '://reader', ':password', '@example.invalid/db'].join('')
  assert.ok(textViolations('notes.txt', assignment).length)
  assert.ok(textViolations('notes.txt', postgresUri).length)
})

test('does not mistake identifier-shaped credential literals for placeholders', () => {
  assert.ok(textViolations('.env', 'FSQ_PLACES_TOKEN=deadbeef').length)
  assert.ok(textViolations('.env', 'SUPABASE_SERVICE_ROLE_KEY=abc123').length)
  assert.ok(textViolations('config.yml', 'GOOGLE_PLACES_API_KEY: abc123').length)
  assert.ok(textViolations('config.js', "const SUPABASE_SERVICE_ROLE_KEY = 'abc123'").length)
  assert.deepEqual(
    textViolations('config.js', 'const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY'),
    [],
  )
})

test('release checks reject private host topology', () => {
  const privateAlias = ['private', 'build', 'host'].join('-')
  const privatePath = ['', 'Users', 'alice', 'projects', 'app'].join('/')
  const linuxPrivatePath = ['', 'home', 'alice', 'projects', 'app'].join('/')
  const privateAddress = ['192', '168', '1', '20'].join('.')
  assert.deepEqual(textViolations('docs/example.md', 'ssh example-host'), [])
  assert.ok(textViolations('docs/runbook.md', `ssh ${privateAlias}`, { release: true }).length)
  assert.ok(textViolations('docs/runbook.md', privatePath, { release: true }).length)
  assert.ok(textViolations('docs/runbook.md', linuxPrivatePath, { release: true }).length)
  assert.ok(textViolations('docs/runbook.md', privateAddress, { release: true }).length)
})

test('normal CI rejects host topology even at former exception paths', () => {
  // The deleted runbook path is intentional: restoring an old filename must
  // not restore its former exception to the public-repository audit.
  const privatePath = ['', 'Users', 'alice', 'projects', 'app'].join('/')
  assert.ok(textViolations('docs/new-runbook.md', privatePath).length)
  assert.ok(textViolations('docs/IMAC_PIPELINE_RUNBOOK.md', privatePath).length)
  assert.ok(textViolations('docs/IMAC_PIPELINE_RUNBOOK.md', privatePath, { release: true }).length)
  assert.ok(textViolations('infra/local/launchd/example.plist.template', privatePath).length)
})

test('rejects broad secret assignments and private keys', () => {
  const awsAssignment = `${['AWS', 'SECRET', 'ACCESS', 'KEY'].join('_')}=real-secret`
  const jsAssignment = `const ${['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')} = 'real-secret'`
  const yamlAssignment = `${['GOOGLE', 'PLACES', 'API', 'KEY'].join('_')}: real-secret`
  const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
  assert.ok(textViolations('notes.txt', awsAssignment).length)
  assert.ok(textViolations('config.js', jsAssignment).length)
  assert.ok(textViolations('config.yml', yamlAssignment).length)
  assert.ok(textViolations('notes.txt', privateKey).length)
  assert.deepEqual(textViolations('config.yml', 'GOOGLE_PLACES_API_KEY: <set-on-host>'), [])
  assert.ok(textViolations('config.yml', 'GOOGLE_PLACES_API_KEY: <unterminated').length)
})

test('rejects JWTs outside the reviewed anon-key locations', () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`
  assert.ok(textViolations('src/example.js', token).length)
})
