// App-owned editorial lifecycle policy; never a pipeline worker entrypoint.
const TABLE_BY_ENTITY = Object.freeze({ pizza: 'pizza_places', taco: 'taco_places' })
const ALLOWED_STATUSES = new Set(['active', 'closed', 'replaced', 'demolished'])

function lifecycleError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function normalizeReason(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 500)
}

function tableForEntity(entity) {
  const tableName = TABLE_BY_ENTITY[String(entity || '').trim().toLowerCase()]
  if (!tableName) throw lifecycleError('Entity must be pizza or taco.')
  return tableName
}

function normalizeLifecycleChange({ entity = 'pizza', placeId, lifecycleStatus, replacementId = null, reason = null } = {}) {
  const normalizedEntity = String(entity || '').trim().toLowerCase()
  const tableName = tableForEntity(normalizedEntity)
  const id = positiveInteger(placeId)
  const status = String(lifecycleStatus || 'active').trim().toLowerCase()
  const successorId = replacementId == null || replacementId === '' ? null : positiveInteger(replacementId)
  const normalizedReason = normalizeReason(reason)

  if (!id) throw lifecycleError('Place id must be a positive integer.')
  if (!ALLOWED_STATUSES.has(status)) throw lifecycleError('Lifecycle status must be active, closed, replaced, or demolished.')
  if (status === 'replaced' && !successorId) throw lifecycleError('A replacement place is required.')
  if (status !== 'replaced' && successorId) throw lifecycleError('A replacement place is only valid for replaced places.')
  if (successorId === id) throw lifecycleError('A place cannot replace itself.')
  if (status !== 'active' && !normalizedReason) {
    throw lifecycleError('A reason is required for lifecycle changes.')
  }

  return {
    entity: normalizedEntity,
    tableName,
    placeId: id,
    lifecycleStatus: status,
    replacementId: successorId,
    reason: normalizedReason || 'Restored to active after manual review.',
  }
}

async function ensureLifecycleHistorySchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS place_lifecycle_history (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
      place_id BIGINT NOT NULL,
      previous_lifecycle_status TEXT,
      previous_replaced_by_id BIGINT,
      lifecycle_status TEXT,
      replaced_by_id BIGINT,
      reason TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_place_lifecycle_history_place
    ON place_lifecycle_history (entity_type, place_id, created_at DESC)
  `)
}

async function readLifecycleTargets(client, input, { lock = false } = {}) {
  const lockClause = lock ? ' FOR UPDATE' : ''
  const current = await client.query(`
    SELECT id, name, lifecycle_status, lifecycle_replaced_by_id
    FROM ${input.tableName}
    WHERE id = $1${lockClause}
  `, [input.placeId])
  const place = current.rows[0]
  if (!place) throw lifecycleError('Place not found.', 404)

  let replacement = null
  if (input.replacementId) {
    const result = await client.query(`
      SELECT id, name, lifecycle_status
      FROM ${input.tableName}
      WHERE id = $1${lockClause}
    `, [input.replacementId])
    replacement = result.rows[0]
    if (!replacement) throw lifecycleError('Replacement place not found.', 404)
    if (replacement.lifecycle_status) {
      throw lifecycleError('Replacement place must be active or unclassified.', 409)
    }
  }

  return { place, replacement }
}

function lifecyclePreview(input, targets) {
  const nextStatus = input.lifecycleStatus === 'active' ? null : input.lifecycleStatus
  const nextReplacementId = input.lifecycleStatus === 'replaced' ? input.replacementId : null
  return {
    entity: input.entity,
    table: input.tableName,
    place: { id: targets.place.id, name: targets.place.name },
    before: {
      lifecycle_status: targets.place.lifecycle_status,
      lifecycle_replaced_by_id: targets.place.lifecycle_replaced_by_id,
    },
    after: {
      lifecycle_status: nextStatus,
      lifecycle_replaced_by_id: nextReplacementId,
    },
    replacement: targets.replacement ? { id: targets.replacement.id, name: targets.replacement.name } : null,
    reason: input.reason,
  }
}

async function previewLifecycleChange(client, rawInput) {
  const input = normalizeLifecycleChange(rawInput)
  return lifecyclePreview(input, await readLifecycleTargets(client, input))
}

async function applyLifecycleChange(client, rawInput, { changedBy = 'admin' } = {}) {
  const input = normalizeLifecycleChange(rawInput)
  await client.query('BEGIN')
  try {
    await ensureLifecycleHistorySchema(client)
    const targets = await readLifecycleTargets(client, input, { lock: true })
    const preview = lifecyclePreview(input, targets)
    const updated = await client.query(`
      UPDATE ${input.tableName}
      SET lifecycle_status = $2,
          lifecycle_replaced_by_id = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, lifecycle_status, lifecycle_replaced_by_id, updated_at
    `, [input.placeId, preview.after.lifecycle_status, preview.after.lifecycle_replaced_by_id])

    await client.query(`
      INSERT INTO place_lifecycle_history (
        entity_type, place_id, previous_lifecycle_status, previous_replaced_by_id,
        lifecycle_status, replaced_by_id, reason, changed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      input.entity,
      input.placeId,
      preview.before.lifecycle_status,
      preview.before.lifecycle_replaced_by_id,
      preview.after.lifecycle_status,
      preview.after.lifecycle_replaced_by_id,
      input.reason,
      String(changedBy || 'admin').slice(0, 120),
    ])

    await client.query('COMMIT')
    return { ...preview, place: { id: updated.rows[0].id, name: updated.rows[0].name }, after: {
      lifecycle_status: updated.rows[0].lifecycle_status,
      lifecycle_replaced_by_id: updated.rows[0].lifecycle_replaced_by_id,
    } }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

module.exports = {
  ALLOWED_STATUSES,
  applyLifecycleChange,
  normalizeLifecycleChange,
  previewLifecycleChange,
}
