import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizationPrompt, normalizeUnicodeName } from './local-name-normalizer.mjs'

test('normalizes Unicode presentation without changing the business identity', () => {
  assert.equal(normalizeUnicodeName('  Royal  Host  '), 'Royal Host')
  assert.equal(normalizeUnicodeName('ロイヤルホスト'), 'ロイヤルホスト')
})

test('asks the local model to translate or transliterate names with uncertainty', () => {
  const prompt = normalizationPrompt('Royal Host', 'ロイヤルホスト')
  assert.match(prompt, /Translate or transliterate/)
  assert.match(prompt, /A normalized name is supporting evidence only/)
  assert.match(prompt, /ロイヤルホスト/)
})
