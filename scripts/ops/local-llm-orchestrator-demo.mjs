#!/usr/bin/env node

import { normalizeNamesWithOllama } from '../lib/local-name-normalizer.mjs'
import { scoreFromPlaceRecords } from '../lib/source-review-evidence-score.mjs'
import { routeIdentityCandidate } from '../lib/local-llm-router.mjs'

const PRIMARY_MODEL = process.env.PRIMARY_MODEL || 'llama3.2:latest'
const CRITIC_MODEL = process.env.CRITIC_MODEL || 'qwen2.5:3b'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate'
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000)

const cases = [
  {
    id: 'exact-franchise-match',
    source: { name: '2491 E. Fremont St. Stockton CA 95205', address: '2491 E. Fremont St., Stockton, CA', phone: '+1 209-466-5555', website: 'https://littlecaesars.com/en-us/store/8742' },
    candidate: { name: 'Little Caesars', address: '2491 E. Fremont St., Stockton, CA', phone: '+1 209-466-5555', website: 'https://littlecaesars.com/en-us/store/8742' },
  },
  {
    id: 'business-replacement',
    source: { name: 'Homeslice Pizzeria', address: '732 Goyeau Street, Windsor', phone: null, website: null },
    candidate: { name: 'Tunnel Pizza & Subs', address: '732 Goyeau Street, Windsor, N9A 1H6', phone: null, website: null },
  },
  {
    id: 'multilingual-match',
    source: { name: 'Royal Host', address: null, phone: null, website: 'https://www.royalhost.jp/' },
    candidate: { name: 'ロイヤルホスト', address: null, phone: null, website: null },
  },
]

const system = `You are a place-identity reviewer. Compare a source record with an existing place.
Return JSON only with this exact shape:
{"decision":"same_place|replacement|different_place|insufficient_evidence","confidence":0,"reason":"short explanation","evidence":["field that supports the decision"]}
Use replacement when the source represents a new business that took over the same location. Use same_place for the same business under a translated, abbreviated, or alternate name. Confidence must be between 0 and 1. A normalized name is supporting evidence only, never proof by itself.`

async function generate(model, record) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        system,
        prompt: JSON.stringify(record),
        format: 'json',
        stream: false,
        options: { temperature: 0, num_predict: 120 },
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
    const payload = JSON.parse(text)
    return { model, elapsedMs: Date.now() - started, result: validateModelResult(JSON.parse(payload.response)) }
  } finally {
    clearTimeout(timer)
  }
}

function validateModelResult(raw) {
  const allowed = new Set(['same_place', 'replacement', 'different_place', 'insufficient_evidence'])
  const result = raw && typeof raw === 'object' ? raw : {}
  return {
    decision: allowed.has(result.decision) ? result.decision : 'insufficient_evidence',
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    reason: String(result.reason || '').slice(0, 300),
    evidence: Array.isArray(result.evidence) ? result.evidence.map(String).slice(0, 5) : [],
  }
}

function agreement(primary, critic) {
  return primary.result.decision === critic.result.decision
}

function routerDecision(testCase, normalization, primary, critic) {
  const score = scoreFromPlaceRecords(testCase.source, testCase.candidate, normalization)
  const routed = routeIdentityCandidate({
    ...score.signals,
    score: score.score,
    maxScore: score.maxScore,
    replacementRisk: score.replacementRisk,
    modelAgreement: agreement(primary, critic),
  })
  if (routed.route === 'auto_accept' && primary.result.decision === 'same_place' && critic.result.decision === 'same_place') {
    return `auto-accept (${score.score}/${score.maxScore} evidence signals; models agree)`
  }
  return `${routed.route === 'judge' ? 'judge model' : 'human review'} (${score.score}/${score.maxScore} evidence signals; ${routed.reason})`
}

async function main() {
  console.log(`Local LLM orchestrator demo: name-normalizer -> ${PRIMARY_MODEL} -> ${CRITIC_MODEL}`)
  console.log('No queue, Postgres, or production APIs are used.\n')
  const report = []

  for (const testCase of cases) {
    console.log(`Case: ${testCase.id}`)
    const normalization = await normalizeNamesWithOllama(
      testCase.source.name,
      testCase.candidate.name,
      { model: PRIMARY_MODEL, timeoutMs: TIMEOUT_MS },
    )
    const normalizedCase = {
      ...testCase,
      normalized_names: normalization,
    }
    const primary = await generate(PRIMARY_MODEL, normalizedCase)
    const critic = await generate(CRITIC_MODEL, normalizedCase)
    const row = {
      id: testCase.id,
      normalization,
      evidenceScore: scoreFromPlaceRecords(testCase.source, testCase.candidate, normalization),
      agreement: agreement(primary, critic),
      routed: routerDecision(testCase, normalization, primary, critic),
      primary,
      critic,
    }
    report.push(row)
    console.log(`  normalized: ${normalization.source_normalized} ↔ ${normalization.candidate_normalized} (${normalization.relationship}, ${normalization.confidence})`)
    console.log(`  ${PRIMARY_MODEL}: ${primary.result.decision} (${primary.result.confidence}) in ${primary.elapsedMs}ms`)
    console.log(`  ${CRITIC_MODEL}: ${critic.result.decision} (${critic.result.confidence}) in ${critic.elapsedMs}ms`)
    console.log(`  evidence: ${row.evidenceScore.supportingEvidence.join(', ') || 'none'}`)
    console.log(`  router: ${row.routed}\n`)
  }

  const accepted = report.filter(row => row.routed.startsWith('auto-accept')).length
  console.log(`Summary: ${accepted}/${report.length} cases auto-accepted; ${report.length - accepted} require review.`)
}

main().catch((error) => {
  console.error(`Demo failed: ${error.message}`)
  process.exitCode = 1
})
