import assert from 'node:assert/strict'
import test from 'node:test'

import { guardedPublishArgs, reviewedNewTarget } from './reviewed-new-entity-boundary.mjs'

test('selects distinct reviewed-new canonical tables without a Pizza fallback', () => {
  assert.equal(reviewedNewTarget('pizza').canonicalTable, 'pizza_places')
  assert.equal(reviewedNewTarget('taco').canonicalTable, 'taco_places')
  assert.throws(() => reviewedNewTarget('burger'), /Unsupported/)
  assert.throws(() => reviewedNewTarget(), /Unsupported/)
})

test('fails closed with exact external Taco publication guidance', () => {
  assert.throws(
    () => guardedPublishArgs('taco', [17, 19]),
    error => {
      assert.match(error.message, /externally owned/)
      assert.match(error.message, /FOOD_PIPELINE_WORKSPACE/)
      assert.match(error.message, /guarded-supabase-sync\.mjs --entity taco --ids 17,19/)
      assert.doesNotMatch(error.message, /--entity pizza/)
      return true
    },
  )
  assert.throws(() => guardedPublishArgs('burger', [1]), /Unsupported/)
})
