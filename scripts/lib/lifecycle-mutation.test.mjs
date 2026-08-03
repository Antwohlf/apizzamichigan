import { createRequire } from 'module'
import test from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { applyLifecycleChange, normalizeLifecycleChange } = require('./lifecycle-mutation.cjs')

test('requires a reason for historical lifecycle changes', () => {
  assert.throws(
    () => normalizeLifecycleChange({ entity: 'pizza', placeId: 1, lifecycleStatus: 'closed' }),
    /reason is required/i,
  )
})

test('requires an active successor for replacement changes', () => {
  assert.throws(
    () => normalizeLifecycleChange({ entity: 'taco', placeId: 1, lifecycleStatus: 'replaced', reason: 'New tenant' }),
    /replacement place is required/i,
  )
})

test('normalizes valid replacement and active restoration inputs', () => {
  assert.deepEqual(normalizeLifecycleChange({
    entity: 'pizza',
    placeId: '11',
    lifecycleStatus: 'replaced',
    replacementId: '12',
    reason: '  Confirmed  by  owner  ',
  }), {
    entity: 'pizza',
    tableName: 'pizza_places',
    placeId: 11,
    lifecycleStatus: 'replaced',
    replacementId: 12,
    reason: 'Confirmed by owner',
  })
  assert.equal(
    normalizeLifecycleChange({ entity: 'taco', placeId: 5, lifecycleStatus: 'active' }).reason,
    'Restored to active after manual review.',
  )
})

test('updates lifecycle fields and appends an audit event in one transaction', async () => {
  const statements = []
  const client = {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ').trim()
      statements.push(text)
      if (text.startsWith('SELECT id, name, lifecycle_status')) {
        return { rows: [{ id: 11, name: 'Old Pizza', lifecycle_status: null, lifecycle_replaced_by_id: null }] }
      }
      if (text.startsWith('UPDATE pizza_places')) {
        return { rows: [{ id: 11, name: 'Old Pizza', lifecycle_status: 'closed', lifecycle_replaced_by_id: null }] }
      }
      return { rows: [] }
    },
  }

  const result = await applyLifecycleChange(client, {
    entity: 'pizza',
    placeId: 11,
    lifecycleStatus: 'closed',
    reason: 'Owner confirmed closure.',
  }, { changedBy: 'test' })

  assert.equal(result.after.lifecycle_status, 'closed')
  assert.equal(statements[0], 'BEGIN')
  assert.ok(statements.some(statement => statement.includes('FOR UPDATE')))
  assert.ok(statements.some(statement => statement.startsWith('INSERT INTO place_lifecycle_history')))
  assert.equal(statements.at(-1), 'COMMIT')
})

test('rolls back when lifecycle validation cannot find the place', async () => {
  const statements = []
  const client = {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ').trim()
      statements.push(text)
      if (text.startsWith('SELECT id, name, lifecycle_status')) return { rows: [] }
      return { rows: [] }
    },
  }

  await assert.rejects(
    applyLifecycleChange(client, {
      entity: 'pizza',
      placeId: 11,
      lifecycleStatus: 'closed',
      reason: 'Owner confirmed closure.',
    }),
    /place not found/i,
  )
  assert.equal(statements.at(-1), 'ROLLBACK')
})
