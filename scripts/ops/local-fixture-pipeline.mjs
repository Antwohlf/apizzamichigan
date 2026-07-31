#!/usr/bin/env node

/**
 * Run the source matching contract against checked-in sample data. This is a
 * safe development harness: it never connects to Postgres, writes a queue, or
 * promotes a canonical record.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { scoreFromPlaceRecords } from '../lib/source-review-evidence-score.mjs'
import { routeIdentityCandidate } from '../lib/local-llm-router.mjs'

const fixturePath = resolve(process.cwd(), process.env.SOURCE_FIXTURE || 'data/source-samples/fixtures/fsq-os-places-pizza-fixture.json')

function normalizeSource(row) {
  return {
    name: row.name,
    address: [row.address, row.locality, row.region, row.postcode].filter(Boolean).join(', '),
    phone: row.tel,
    website: row.website,
  }
}

function validate(row) {
  const required = ['fsq_place_id', 'name', 'latitude', 'longitude']
  return required.filter(key => row[key] == null || row[key] === '')
}

async function main() {
  const rows = JSON.parse(await readFile(fixturePath, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('Fixture must contain an array of source rows.')
  const report = rows.map(row => {
    const missing = validate(row)
    const source = normalizeSource(row)
    const score = scoreFromPlaceRecords(source, row.fixture_candidate || {}, {
      relationship: row.fixture_name_relationship || 'uncertain',
    })
    const route = routeIdentityCandidate({
      ...score.signals,
      score: score.score,
      maxScore: score.maxScore,
      replacementRisk: row.fixture_replacement_risk || score.replacementRisk,
    })
    return {
      source_id: row.fsq_place_id,
      name: row.name,
      region: row.region || null,
      closed: Boolean(row.date_closed),
      valid: missing.length === 0,
      missing,
      evidence_score: score.score,
      route: route.route,
    }
  })
  const output = {
    mode: 'fixture_only',
    read_only: true,
    fixture: fixturePath,
    rows: report,
    summary: {
      total: report.length,
      valid: report.filter(row => row.valid).length,
      closed: report.filter(row => row.closed).length,
      human_review: report.filter(row => row.route === 'human').length,
    },
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(output, null, 2))
  else {
    console.log(`Local fixture pipeline (${report.length} rows)`)
    for (const row of report) console.log(`- ${row.name}: ${row.valid ? 'valid' : 'invalid'}; ${row.closed ? 'closed; ' : ''}route=${row.route}`)
    console.log(`Summary: ${output.summary.valid} valid, ${output.summary.closed} closed, ${output.summary.human_review} human review`)
  }
}

main().catch(error => {
  console.error(`Fixture pipeline failed: ${error.message}`)
  process.exitCode = 1
})
