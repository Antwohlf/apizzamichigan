#!/usr/bin/env node
// Read-only live contract check. Never prints credentials or returned records.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const contract = JSON.parse(readFileSync(new URL('../../config/canonical-contract.json', import.meta.url)))
const baseUrl = process.env.PUBLIC_SUPABASE_URL
const publicKey = process.env.PUBLIC_SUPABASE_ANON_KEY
assert(baseUrl && publicKey, 'Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY')
const base = new URL(baseUrl)
assert(base.protocol === 'https:' && !base.username && !base.password, 'Use an HTTPS project URL')
assert(base.pathname === '/', 'Use the project origin, not an API path')
if (!publicKey.startsWith('sb_publishable_')) {
  let claims
  try { claims = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()) } catch {}
  assert.equal(claims?.role, 'anon', 'Only a public anonymous/publishable key is permitted')
}

async function query(table, columns, { denied = false } = {}) {
  const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, base)
  url.searchParams.set('select', columns)
  url.searchParams.set('limit', denied ? '0' : '1')
  const response = await fetch(url, {
    headers: {
      apikey: publicKey,
      ...(!publicKey.startsWith('sb_publishable_') ? { Authorization: `Bearer ${publicKey}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.json()
  if (denied) {
    assert([401, 403].includes(response.status) && body.code === '42501',
      `${table}: ${columns} must be permission-denied (got ${response.status})`)
  } else {
    assert(response.ok && Array.isArray(body), `${table}: public read failed (${response.status})`)
    assert(body.length > 0, `${table}: no visible rows; public read availability is unproven`)
  }
  console.log(`PASS ${table}: ${denied ? 'private read denied' : 'public read available'}`)
}

for (const entity of contract.entities) {
  const table = contract.canonical_tables[entity]
  const fields = [...new Set(Object.values(contract.public_fields[entity]).flat())]
  await query(table, fields.join(','))
  await query(table, '*', { denied: true })
  for (const field of ['email', 'notes', 'scrape_notes', 'enrichment_agent', 'osm_tags']) {
    await query(table, field, { denied: true })
  }
}
for (const table of ['pizza_places_backup', 'pizza_suggestions', 'taco_suggestions']) {
  await query(table, 'id', { denied: true })
}
console.log('Read-only anonymous API contract verified; no insert/update/delete/RPC requests were sent.')
