import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTOMATION_POLICIES, buildAutomationReport, parseAutomationReportArgs, summarizeAutomationResults } from './source-review-automation-report.mjs'

test('defines only the approved deterministic source policies', () => {
  assert.deepEqual(AUTOMATION_POLICIES.map(policy => policy.source), ['osm', 'wikidata', 'all_the_places'])
})

test('summarizes available candidates without counting unavailable policies', () => {
  const summary = summarizeAutomationResults([
    { state: 'ready', candidates: 12 },
    { state: 'ready', candidates: 4 },
    { state: 'unavailable', candidates: 0 },
  ])

  assert.deepEqual(summary, {
    state: 'unavailable',
    policies: 3,
    available_policies: 2,
    candidates: 16,
  })
})

test('builds a read-only report from bounded policy runners', () => {
  const calls = []
  const report = buildAutomationReport({
    entity: 'pizza',
    limit: 25,
    runner: (entity, policy, limit) => {
      calls.push({ entity, source: policy.source, limit })
      return { state: 'ready', source: policy.source, candidates: policy.source === 'osm' ? 3 : 0, inspected: 3, reasons: {} }
    },
  })

  assert.equal(report.read_only, true)
  assert.equal(report.summary.candidates, 3)
  assert.deepEqual(calls, AUTOMATION_POLICIES.map(policy => ({ entity: 'pizza', source: policy.source, limit: 25 })))
})

test('defaults the CLI report to pizza when only output format is supplied', () => {
  assert.deepEqual(parseAutomationReportArgs(['--json']), {
    entity: 'pizza',
    limit: 1000,
    json: true,
  })
})
