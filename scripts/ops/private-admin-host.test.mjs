import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { request } from 'node:http'

const require = createRequire(import.meta.url)
const express = require('express')
const { createPrivateHost, privateTlsSettings } = require('../../server/private-host.cjs')
const { requireReviewHistory, requireLifecycleHistory } = require('../../server/product/schema-readiness.cjs')
const origin = 'https://admin.example.test'

test('direct private HTTPS rejects public interfaces and incomplete settings', () => {
  assert.equal(privateTlsSettings({}), null)
  assert.throws(() => privateTlsSettings({ ADMIN_TLS_HOST: '100.71.1.1' }), /supplied together/)
  const env = { ADMIN_TLS_HOST: '100.71.1.1', ADMIN_TLS_PORT: '8443', ADMIN_TLS_CERT: '/missing/cert', ADMIN_TLS_KEY: '/missing/key', ADMIN_PUBLIC_ORIGIN: `${origin}:8443` }
  for (const host of ['0.0.0.0', '::', '127.0.0.1', '203.0.113.10', '100.63.1.1', '100.128.1.1', '8.8.8.8']) {
    assert.throws(() => privateTlsSettings({ ...env, ADMIN_TLS_HOST: host }), /Tailscale IPv4/)
  }
  assert.throws(() => privateTlsSettings({ ...env, ADMIN_TLS_PORT: '443' }), /port must match/)
  assert.throws(() => privateTlsSettings({ ...env, ADMIN_TLS_CERT: 'relative.crt' }), /absolute paths/)
})

test('private host serves the built app without masking unknown APIs or exposing source/config', async t => {
  const root = mkdtempSync(join(tmpdir(), 'private-admin-host-'))
  const webRoot = join(root, 'build')
  mkdirSync(webRoot)
  writeFileSync(join(webRoot, 'index.html'), '<html>Pizza/Taco admin</html>')
  writeFileSync(join(webRoot, '.env'), 'PRIVATE_SETTING=not-for-clients')
  writeFileSync(join(root, 'private.txt'), 'private state')
  const api = express()
  api.get('/api/admin/check', (_req, res) => res.status(401).json({ authorized: false }))
  api.post('/api/admin/login', (_req, res) => res.json({ reached: true }))
  const app = createPrivateHost({ api, webRoot, origin, release: 'test-release' })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  for (const path of ['/admin/reviews', '/admin/reviews/data', '/tacos', '/tacos/places/42']) {
    const response = await fetch(base + path)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Pizza\/Taco admin/)
    assert.match(response.headers.get('cache-control'), /no-store/)
  }
  for (const path of ['/api/unknown', '/.env', '/server/index.js', '/private.txt']) {
    const response = await fetch(base + path)
    assert.equal(response.status, 404)
    assert.doesNotMatch(await response.text(), /not-for-clients|private state|Pizza\/Taco admin/)
  }
  assert.equal((await fetch(base + '/api/admin/check')).status, 401)
  assert.deepEqual(await (await fetch(base + '/healthz')).json(), { status: 'ok', release: 'test-release' })
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = request(base + '/healthz', { headers: { Host: 'untrusted.example' } }, res => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(wrongHostStatus, 421)
  for (const headers of [{}, { Origin: 'https://untrusted.example' }]) {
    assert.equal((await fetch(base + '/api/admin/login', { method: 'POST', headers })).status, 403)
  }
  assert.equal((await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: origin } })).status, 200)
  assert.throws(() => createPrivateHost({ api, webRoot, origin: 'http://admin.example.test' }), /HTTPS origin/)
  assert.throws(() => createPrivateHost({ api, webRoot, origin: `${origin}/unexpected` }), /HTTPS origin/)
  assert.throws(() => createPrivateHost({ api, webRoot: root, origin }), /built website/)
})

test('schema readiness only reads and fails closed without doing request-time migrations', async () => {
  for (const check of [requireReviewHistory, requireLifecycleHistory]) {
    const statements = []
    await check({ query: async sql => { statements.push(sql); return { rows: [] } } })
    assert.equal(statements.length, 1)
    assert.match(statements[0], /^SELECT/)
    assert.match(statements[0], /LIMIT 0$/)
    await assert.rejects(check({ query: async () => { throw new Error('database detail') } }), error => {
      assert.equal(error.status, 503)
      assert.match(error.message, /schema is unavailable/)
      assert.doesNotMatch(error.message, /database detail/)
      return true
    })
  }
  for (const file of ['server/index.js', 'server/product/lifecycle-mutation.cjs', 'server/product/schema-readiness.cjs']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|SCHEMA)\b/)
  }
  const grants = readFileSync('infra/admin/local-role.sql', 'utf8')
  assert.doesNotMatch(grants, /\bGRANT\s+(?:ALL|DELETE|TRUNCATE|CREATE)|\bOWNER\s+TO/i)
  assert.doesNotMatch(grants, /GRANT[^;]*(?:enrichment_queue|classification_cache|website_cache|agent_state)/i)
  const migration = readFileSync('scripts/enrichment/source-review-decision-history-schema.sql', 'utf8')
  assert.match(migration, /ADD COLUMN IF NOT EXISTS canonical_before JSONB/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS canonical_after JSONB/)
})
