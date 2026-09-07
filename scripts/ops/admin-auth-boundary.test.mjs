import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createAdminSessionValue } = require('../../shared/admin-session-boundary.cjs')

const passwordEnv = ['ADMIN', 'PORTAL', 'PASSWORD'].join('_')
const sessionEnv = ['ADMIN', 'SESSION', 'SECRET'].join('_')
const serviceRoleEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')
const testPassword = 'test-admin-password-value'
const testSigningValue = 'test-admin-signing-value-with-entropy'

function signedCookie(value, secret) {
  const signature = createHmac('sha256', secret).update(value).digest('base64').replace(/=+$/, '')
  return `admin_auth=${encodeURIComponent(`s:${value}.${signature}`)}`
}

test('status needs a real expiring session but not a Supabase service client', async t => {
  const previous = {
    password: process.env[passwordEnv],
    session: process.env[sessionEnv],
    service: process.env[serviceRoleEnv],
  }
  process.env[passwordEnv] = testPassword
  process.env[sessionEnv] = testSigningValue
  process.env[serviceRoleEnv] = ''
  process.env.NODE_ENV = 'test'

  const app = require('../../server/index.js')
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const [key, value] of [
      [passwordEnv, previous.password],
      [sessionEnv, previous.session],
      [serviceRoleEnv, previous.service],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const origin = `http://127.0.0.1:${server.address().port}`
  const fallbackForgery = signedCookie('1', 'invalid-admin-session-secret')
  assert.equal((await fetch(`${origin}/api/admin/check`, { headers: { Cookie: fallbackForgery } })).status, 401)

  const expired = createAdminSessionValue({ nowMs: Date.now() - 48 * 60 * 60 * 1000 })
  assert.equal((await fetch(`${origin}/api/admin/check`, {
    headers: { Cookie: signedCookie(expired, testSigningValue) },
  })).status, 401)

  const valid = createAdminSessionValue()
  const headers = { Cookie: signedCookie(valid, testSigningValue) }
  const statusResponse = await fetch(`${origin}/api/admin/pipeline-status?entity=pizza`, { headers })
  assert.equal(statusResponse.status, 200)
  assert.match(statusResponse.headers.get('cache-control') || '', /no-store/)
  assert.equal((await statusResponse.json()).data.state, 'missing')

  const supabaseResponse = await fetch(`${origin}/api/admin/reviews?entity=pizza`, { headers })
  assert.equal(supabaseResponse.status, 500)
  assert.deepEqual(await supabaseResponse.json(), { error: 'Supabase service role not configured' })

  const unknownEntity = await fetch(`${origin}/api/admin/pipeline-status?entity=burger`, { headers })
  assert.equal(unknownEntity.status, 400)
})
