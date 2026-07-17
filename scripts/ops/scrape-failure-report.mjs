#!/usr/bin/env node
/**
 * Read-only taxonomy for failed website scrape jobs.
 *
 * This report separates transient failures worth retrying from permanent
 * blocks/dead links and unknown errors that need review before requeueing.
 */

import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join } from 'path'

const argv = new Set(process.argv.slice(2))
const root = process.cwd()
const dbPath = process.env.QUEUE_DB_PATH || join(root, 'scripts/.job-queue.db')
const limit = positiveInt(process.env.SCRAPE_FAILURE_REPORT_LIMIT, 20)

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function classify(message) {
  const value = String(message || '').toLowerCase()
  if (/http 403|http 401|forbidden|access denied|robots/.test(value)) return 'blocked'
  if (/http 404|http 410|not found|no website|invalid url|enotfound/.test(value)) return 'dead_link'
  if (/http 429|http 5\d\d|fetch failed|timeout|aborted|econnreset|etimedout|econnrefused|network/.test(value)) return 'transient'
  return 'unknown'
}

function main() {
  if (!existsSync(dbPath)) throw new Error(`Queue DB not found: ${dbPath}`)
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare(`
      SELECT id, osm_id, attempts, max_attempts, last_error
      FROM jobs
      WHERE job_type = 'scrape' AND status = 'failed'
      ORDER BY id DESC
    `).all()

    const classified = rows.map(row => ({ ...row, category: classify(row.last_error) }))
    const counts = new Map()
    for (const row of classified) counts.set(row.category, (counts.get(row.category) || 0) + 1)
    const nearMax = classified.filter(row => row.attempts >= row.max_attempts)
    const atMaxAttemptsByCategory = new Map()
    for (const row of nearMax) atMaxAttemptsByCategory.set(row.category, (atMaxAttemptsByCategory.get(row.category) || 0) + 1)
    const summary = {
      total: rows.length,
      categories: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
      retryable: counts.get('transient') || 0,
      blocked: counts.get('blocked') || 0,
      deadLink: counts.get('dead_link') || 0,
      unknown: counts.get('unknown') || 0,
      atMaxAttempts: nearMax.length,
      atMaxAttemptsByCategory: Object.fromEntries([...atMaxAttemptsByCategory.entries()].sort((a, b) => b[1] - a[1])),
      transientAtMaxAttempts: atMaxAttemptsByCategory.get('transient') || 0,
    }

    if (argv.has('--json')) {
      console.log(JSON.stringify({ dbPath, summary, samples: classified.slice(0, limit) }, null, 2))
      return
    }

    console.log('# Scrape Failure Report')
    console.log(`db=${dbPath}`)
    console.log(`total_failed=${summary.total}`)
    console.log(`retryable_transient=${summary.retryable}`)
    console.log(`blocked=${summary.blocked}`)
    console.log(`dead_link=${summary.deadLink}`)
    console.log(`unknown=${summary.unknown}`)
    console.log(`at_max_attempts=${summary.atMaxAttempts}`)
    console.log('')
    console.log('category | count')
    for (const [category, count] of Object.entries(summary.categories)) console.log(`${category} | ${count}`)
    console.log('')
    console.log(`Recent failures (max ${limit})`)
    for (const row of classified.slice(0, limit)) {
      console.log(`${row.id} | ${row.category} | attempts=${row.attempts}/${row.max_attempts} | ${row.last_error || '(no error)'}`)
    }
  } finally {
    db.close()
  }
}

main()
