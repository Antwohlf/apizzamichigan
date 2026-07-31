import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreFromPlaceRecords, scoreIdentityEvidence } from './source-review-evidence-score.mjs'

test('auto-accepts three corroborating signals', () => {
  const score = scoreIdentityEvidence({ location: true, phone: true, normalizedName: true })
  assert.equal(score.score, 3)
  assert.equal(score.route, 'auto_accept')
})

test('keeps translated name plus location in human review', () => {
  const score = scoreIdentityEvidence({ location: true, normalizedName: true })
  assert.equal(score.score, 2)
  assert.equal(score.route, 'human_review')
})

test('keeps a replacement human-gated even with continuity evidence', () => {
  const withoutContinuity = scoreIdentityEvidence({ location: true, normalizedName: false, replacementRisk: true })
  const withContinuity = scoreIdentityEvidence({ location: true, phone: true, website: true, replacementRisk: true })
  assert.equal(withoutContinuity.route, 'human_review')
  assert.equal(withContinuity.route, 'human_review')
})

test('treats an appended postal code as the same location signal', () => {
  const score = scoreFromPlaceRecords(
    { address: '732 Goyeau Street, Windsor' },
    { address: '732 Goyeau Street, Windsor, N9A 1H6' },
    { relationship: 'different' },
  )
  assert.equal(score.signals.location, true)
  assert.equal(score.route, 'human_review')
})

test('does not treat a shared address prefix as the same location', () => {
  const score = scoreFromPlaceRecords(
    { address: '10 Main Street' },
    { address: '10 Main Street North' },
    { relationship: 'uncertain' },
  )
  assert.equal(score.signals.location, false)
})
