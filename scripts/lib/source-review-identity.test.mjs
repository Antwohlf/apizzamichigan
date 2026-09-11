import test from 'node:test'
import assert from 'node:assert/strict'
import { deterministicDecision, evidenceFor } from '../../server/product/source-review-identity.mjs'

function row(overrides = {}) {
  return {
    source: 'official_website',
    source_id: 'store-8742',
    source_name: 'Little Caesars',
    source_data: {
      website: 'https://littlecaesars.com/en-us/store/8742',
      phone: '(209) 466-5555',
      address: '2491 E Fremont St, Stockton, CA',
    },
    nearest_place_name: 'Little Caesars',
    nearest_distance_m: 0,
    nearest_phone: '+1 209-466-5555',
    nearest_website_url: 'https://www.littlecaesars.com/en-us/store/8742/',
    nearest_address: '2491 E. Fremont St., Stockton, CA',
    nearest_status: 'unvisited',
    nearest_rating: null,
    nearest_notes: null,
    ...overrides,
  }
}

test('treats exact official website, phone, and location as a human-gated same-place suggestion', () => {
  const candidate = row()
  const evidence = evidenceFor(candidate)
  assert.equal(evidence.source_website_matches, true)
  assert.equal(evidence.source_phone_matches, true)
  assert.equal(evidence.location_is_close, true)
  assert.equal(deterministicDecision(candidate, evidence)?.decision, 'same_place')
  assert.equal(deterministicDecision(candidate, evidence)?.confidence, 0.99)
  assert.equal(deterministicDecision(candidate, evidence)?.needs_human_review, true)
})

test('does not infer a same-place match from a generic brand homepage', () => {
  const candidate = row({
    source_data: { website: 'https://littlecaesars.com', phone: null },
    nearest_website_url: 'https://littlecaesars.com/en-us/store/8742',
  })
  const evidence = evidenceFor(candidate)
  assert.equal(evidence.source_website_matches, false)
  assert.equal(deterministicDecision(candidate, evidence), null)
})

test('keeps conflicting names human-gated and asks the reviewer to check replacement', () => {
  const candidate = row({ source_name: 'Homeslice Pizzeria', nearest_place_name: 'Tunnel Pizza & Subs' })
  const evidence = evidenceFor(candidate)
  const decision = deterministicDecision(candidate, evidence)
  assert.equal(decision?.decision, 'same_place')
  assert.equal(decision?.needs_human_review, true)
  assert.match(decision?.reason || '', /replacement/i)
})

test('uses matching phone and normalized name when the official URL is absent', () => {
  const candidate = row({
    source_data: { phone: '(209) 466-5555', address: '2491 E Fremont St' },
    nearest_website_url: null,
  })
  const evidence = evidenceFor(candidate)
  assert.equal(evidence.source_phone_matches, true)
  assert.equal(deterministicDecision(candidate, evidence)?.decision, 'same_place')
})
