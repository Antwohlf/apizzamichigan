#!/usr/bin/env node
/**
 * Requeue a batch of previously failed scrape jobs that are likely transient.
 *
 * Default behavior:
 * - dry-run; use --apply to mutate the queue
 * - LIMIT 100
 * - include: network/transient errors + timeouts + HTTP 5xx
 * - exclude: HTTP 403 + obvious permanents (404/410)
 * - resets attempts to 0 so they get a fair re-try under new scrape params
 *
 * Usage:
 *   node scripts/enrichment/requeue-scrape-failures.mjs [--limit 100] [--apply]
 */

import { getQueue } from './queue.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`Usage: node scripts/enrichment/requeue-scrape-failures.mjs [options]

Options:
  --limit <n>   Maximum transient failures to inspect/requeue (default 100, max 5000)
  --apply       Requeue the selected jobs; default is a read-only preview
  --help        Show this help without opening the queue database
`)
  process.exit(0)
}
const limitIdx = args.indexOf('--limit')
const limit = Math.max(1, Math.min(5000, Number.parseInt(limitIdx >= 0 ? args[limitIdx + 1] : '100', 10) || 100))
const apply = args.includes('--apply')

const q = getQueue()

function normalizedError(error) {
  return String(error || '').replace(/^Cached error:\s*/i, '').trim()
}

function isTransient(error) {
  const value = normalizedError(error).toLowerCase()
  if (/^http (401|403|404|410)\b/.test(value) || /forbidden|access denied|not found|no website|invalid url/.test(value)) return false
  return /fetch failed|this operation was aborted|timeout|^http 5\d\d\b|econnreset|etimedout|econnrefused|network/.test(value)
}

const candidates = q.db.prepare(
  `
  SELECT id, osm_id, place_type, last_error
  FROM jobs
  WHERE job_type = 'scrape'
    AND status = 'failed'
    AND last_error IS NOT NULL

  ORDER BY id ASC
  `
).all()

const transientCandidates = candidates.filter(candidate => isTransient(candidate.last_error)).slice(0, limit)
const now = new Date().toISOString()

const byReason = new Map()
for (const c of transientCandidates) {
  const k = String(c.last_error || 'unknown')
  byReason.set(k, (byReason.get(k) || 0) + 1)
}

const requeueTx = q.db.transaction((rows) => {
  const stmt = q.db.prepare(
    `
    UPDATE jobs
    SET status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        completed_at = NULL,
        attempts = 0,
        last_error = ?,
        data = json_set(COALESCE(data, '{}'), '$.skipCache', 1)
    WHERE id = ?
    `
  )

  for (const r of rows) {
    stmt.run(`requeued ${now} (was: ${String(r.last_error).slice(0, 120)})`, r.id)
  }
})

if (apply) requeueTx(transientCandidates)

console.log(`${apply ? 'requeued' : 'would requeue'} scrape jobs: ${transientCandidates.length} (limit=${limit}, scanned=${candidates.length})`)
if (!apply) console.log('dry-run: pass --apply to mutate the queue')
console.log('breakdown (original last_error):')
for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`- ${n}\t${reason}`)
}
