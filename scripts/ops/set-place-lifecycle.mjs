#!/usr/bin/env node

/**
 * Explicit local lifecycle action for a canonical place.
 *
 * This is intentionally dry-run by default. Lifecycle is a human/editorial
 * decision, not an inference that source adapters are allowed to promote.
 */

import pg from 'pg'

const { Pool } = pg
const tableByEntity = { pizza: 'pizza_places', taco: 'taco_places' }
const allowedStatuses = new Set(['active', 'closed', 'replaced', 'demolished'])

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
const tableName = tableByEntity[entity]

if (!tableName) throw new Error('--entity must be pizza or taco')
if (!Number.isInteger(placeId) || placeId < 1) throw new Error('--id must be a positive integer')
if (!allowedStatuses.has(lifecycleStatus)) throw new Error('--status must be active, closed, replaced, or demolished')
if (lifecycleStatus === 'replaced' && (!Number.isInteger(replacementId) || replacementId < 1)) {
  throw new Error('--replaced-by-id is required when --status=replaced')
}
if (lifecycleStatus !== 'replaced' && replacementId != null) {
  throw new Error('--replaced-by-id is only valid with --status=replaced')
}
if (replacementId === placeId) throw new Error('A place cannot replace itself')

const pool = new Pool({
  host: process.env.LOCAL_DB_HOST || process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.LOCAL_DB_PORT || process.env.PGPORT || 5432),
  database: process.env.LOCAL_DB_NAME || process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.LOCAL_DB_USER || process.env.PGUSER || process.env.USER,
  password: process.env.LOCAL_DB_PASSWORD || process.env.PGPASSWORD || '',
})

try {
  const result = await pool.query(`
    SELECT id, name, lifecycle_status, lifecycle_replaced_by_id
    FROM ${tableName}
    WHERE id = $1
  `, [placeId])
  const place = result.rows[0]
  if (!place) throw new Error(`Place ${placeId} was not found in ${tableName}`)

  let replacement = null
  if (replacementId != null) {
    const replacementResult = await pool.query(`
      SELECT id, name, lifecycle_status
      FROM ${tableName}
      WHERE id = $1
    `, [replacementId])
    replacement = replacementResult.rows[0]
    if (!replacement) throw new Error(`Replacement place ${replacementId} was not found in ${tableName}`)
    if (replacement.lifecycle_status && replacement.lifecycle_status !== 'active') {
      throw new Error(`Replacement place ${replacementId} is already marked ${replacement.lifecycle_status}`)
    }
  }

  const nextStatus = lifecycleStatus === 'active' ? null : lifecycleStatus
  const nextReplacementId = lifecycleStatus === 'replaced' ? replacementId : null
  const preview = {
    entity,
    table: tableName,
    place: { id: place.id, name: place.name },
    before: { lifecycle_status: place.lifecycle_status, lifecycle_replaced_by_id: place.lifecycle_replaced_by_id },
    after: { lifecycle_status: nextStatus, lifecycle_replaced_by_id: nextReplacementId },
    replacement: replacement ? { id: replacement.id, name: replacement.name } : null,
    reason,
    applied: false,
  }

  if (apply) {
    const updated = await pool.query(`
      UPDATE ${tableName}
      SET lifecycle_status = $2,
          lifecycle_replaced_by_id = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, lifecycle_status, lifecycle_replaced_by_id
    `, [placeId, nextStatus, nextReplacementId])
    preview.applied = true
    preview.place = { id: updated.rows[0].id, name: updated.rows[0].name }
    preview.after = {
      lifecycle_status: updated.rows[0].lifecycle_status,
      lifecycle_replaced_by_id: updated.rows[0].lifecycle_replaced_by_id,
    }
  }

  if (process.argv.includes('--json')) console.log(JSON.stringify(preview, null, 2))
  else {
    console.log(`${apply ? 'Applied' : 'Dry run'} lifecycle change for ${place.name} (#${place.id})`)
    console.log(`  ${place.lifecycle_status || 'active'} -> ${nextStatus || 'active'}`)
    if (replacement) console.log(`  replacement: ${replacement.name} (#${replacement.id})`)
    if (reason) console.log(`  reason: ${reason}`)
    if (!apply) console.log('  no changes made; add --apply to save')
  }
} finally {
  await pool.end()
}
