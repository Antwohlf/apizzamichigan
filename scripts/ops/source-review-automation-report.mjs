#!/usr/bin/env node
/**
 * Read-only summary of source-review rows eligible for deterministic linking.
 *
 * This composes the existing auto-link runner in dry-run mode. It never
 * changes source_review_queue, place_sources, canonical places, or Supabase.
 */

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { sourceAutoLinkArguments } from '../lib/source-auto-link-policy.mjs'

const ROOT = process.cwd()
const RUNNER = join(ROOT, 'scripts/ops/auto-link-source-review-queue.mjs')

export const AUTOMATION_POLICIES = Object.freeze([
  { source: 'osm', label: 'OSM exact source identity' },
  { source: 'wikidata', label: 'Wikidata brand identity' },
  { source: 'all_the_places', label: 'Official chain identifiers' },
])

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function summarizeAutomationResults(results) {
  const rows = Array.isArray(results) ? results : []
  const available = rows.filter(row => row.state === 'ready')
  const candidates = available.reduce((total, row) => total + row.candidates, 0)
  return {
    state: rows.some(row => row.state === 'unavailable') ? 'unavailable' : 'ready',
    policies: rows.length,
    available_policies: available.length,
    candidates,
  }
}

function runPolicy(entity, policy, limit) {
  const args = [
    RUNNER,
    '--entity', entity,
    '--source', policy.source,
    ...sourceAutoLinkArguments(policy.source),
    '--max-distance-m', policy.source === 'all_the_places' ? '10' : '100',
    '--limit', String(limit),
    '--json',
  ]

  try {
    const output = execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    const report = JSON.parse(output)
    return {
      state: 'ready',
      source: policy.source,
      label: policy.label,
      candidates: Number(report.candidates) || 0,
      inspected: Array.isArray(report.rows) ? report.rows.length : 0,
      reasons: Object.fromEntries(
        (report.rows || []).reduce((counts, row) => {
          const reason = row.auto_link_reason || 'unknown'
          counts[reason] = (counts[reason] || 0) + 1
          return counts
        }, {})
      ),
    }
  } catch (error) {
    return {
      state: 'unavailable',
      source: policy.source,
      label: policy.label,
      candidates: 0,
      inspected: 0,
      error: String(error.stderr || error.message || error).trim().split('\n')[0].slice(0, 240),
    }
  }
}

export function buildAutomationReport({ entity = 'pizza', limit = 1000, runner = runPolicy } = {}) {
  const results = AUTOMATION_POLICIES.map(policy => runner(entity, policy, limit))
  return {
    generated_at: new Date().toISOString(),
    read_only: true,
    entity,
    limit,
    summary: summarizeAutomationResults(results),
    policies: results,
  }
}

export function parseAutomationReportArgs(argv = []) {
  const entityIndex = argv.indexOf('--entity')
  const limitIndex = argv.indexOf('--limit')
  return {
    entity: entityIndex === -1 ? 'pizza' : (argv[entityIndex + 1] || ''),
    limit: parsePositiveInt(limitIndex === -1 ? undefined : argv[limitIndex + 1], 1000),
    json: argv.includes('--json'),
  }
}

function main() {
  const argv = process.argv.slice(2)
  const { entity, limit, json } = parseAutomationReportArgs(argv)
  if (!['pizza', 'taco'].includes(entity)) throw new Error('Invalid --entity. Use pizza or taco.')

  const report = buildAutomationReport({ entity, limit })
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`# Source review automation: ${entity}`)
  console.log(`Generated: ${report.generated_at}`)
  console.log('Mode: read-only dry run')
  console.log(`Candidates eligible for deterministic linking: ${report.summary.candidates}`)
  console.log('')
  for (const policy of report.policies) {
    console.log(`- ${policy.label}: ${policy.state}; candidates=${policy.candidates}`)
    if (policy.error) console.log(`  error: ${policy.error}`)
    for (const [reason, count] of Object.entries(policy.reasons || {})) {
      console.log(`  ${reason}: ${count}`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
