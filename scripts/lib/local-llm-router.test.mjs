import test from 'node:test'
import assert from 'node:assert/strict'
import { modelPlan, routeIdentityCandidate } from './local-llm-router.mjs'

test('auto-accepts a corroborated non-replacement match', () => {
  const result = routeIdentityCandidate({ score: 3, maxScore: 5, location: true, phone: true })
  assert.equal(result.route, 'auto_accept')
})

test('sends borderline matches to the judge model', () => {
  const result = routeIdentityCandidate({ score: 2, maxScore: 5, location: true, normalizedName: true })
  assert.equal(result.route, 'judge')
})

test('keeps replacements human-gated even with strong evidence', () => {
  const result = routeIdentityCandidate({ score: 5, maxScore: 5, location: true, phone: true, website: true, replacementRisk: true })
  assert.equal(result.route, 'human')
})

test('describes the local model plan', () => {
  const plan = modelPlan({ primary: 'small-model', judge: 'larger-model' })
  assert.equal(plan.fast.model, 'small-model')
  assert.equal(plan.judge.model, 'larger-model')
  assert.equal(plan.human.model, null)
})

test('blocks auto-acceptance when models disagree', () => {
  const result = routeIdentityCandidate({ score: 3, maxScore: 5, location: true, phone: true, modelAgreement: false })
  assert.equal(result.route, 'judge')
})
