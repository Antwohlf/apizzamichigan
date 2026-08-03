#!/usr/bin/env node

/**
 * Explicit local lifecycle action for a canonical place.
 *
 * This is intentionally dry-run by default. Lifecycle is a human/editorial
 * decision, not an inference that source adapters are allowed to promote.
 */

import pg from 'pg'
import { createRequire } from 'module'

const { Pool } = pg
const require = createRequire(import.meta.url)
const { applyLifecycleChange, normalizeLifecycleChange, previewLifecycleChange } = require('../lib/lifecycle-mutation.cjs')

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

const entity = valueAfter('--entity') || 'pizza'
const placeId = Number(valueAfter('--id'))
const lifecycleStatus = String(valueAfter('--status') || '').trim().toLowerCase()
const replacementIdValue = valueAfter('--replaced-by-id')
const replacementId = replacementIdValue == null || replacementIdValue === '' ? null : Number(replacementIdValue)
const reason = String(valueAfter('--reason') || '').trim().slice(0, 500) || null
const apply = process.argv.includes('--apply')
const input = normalizeLifecycleChange({
  entity,
  placeId,
  lifecycleStatus,
  replacementId,
  reason,
})

const pool = new Pool({
  host: process.env.LOCAL_DB_HOST || process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.LOCAL_DB_PORT || process.env.PGPORT || 5432),
  database: process.env.LOCAL_DB_NAME || process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.LOCAL_DB_USER || process.env.PGUSER || process.env.USER,
  password: process.env.LOCAL_DB_PASSWORD || process.env.PGPASSWORD || '',
})

try {
  const client = await pool.connect()
  let preview
  try {
    preview = apply
      ? await applyLifecycleChange(client, input, { changedBy: 'cli:set-place-lifecycle' })
      : await previewLifecycleChange(client, input)
  } finally {
    client.release()
  }
  preview.applied = apply

  if (process.argv.includes('--json')) console.log(JSON.stringify(preview, null, 2))
  else {
    console.log(`${apply ? 'Applied' : 'Dry run'} lifecycle change for ${preview.place.name} (#${preview.place.id})`)
    console.log(`  ${preview.before.lifecycle_status || 'active'} -> ${preview.after.lifecycle_status || 'active'}`)
    if (preview.replacement) console.log(`  replacement: ${preview.replacement.name} (#${preview.replacement.id})`)
    console.log(`  reason: ${preview.reason}`)
    if (!apply) console.log('  no changes made; add --apply to save')
  }
} finally {
  await pool.end()
}
