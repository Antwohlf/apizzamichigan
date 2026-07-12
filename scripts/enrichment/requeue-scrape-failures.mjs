#!/usr/bin/env node
/**
 * Requeue a batch of previously failed scrape jobs that are likely transient.
 *
 * Default behavior:
 * - LIMIT 100
 * - include: network/transient errors + timeouts + HTTP 5xx
 * - exclude: HTTP 403 + obvious permanents (404/410)
 * - resets attempts to 0 so they get a fair re-try under new scrape params
 *
 * Usage:
 *   node scripts/enrichment/requeue-scrape-failures.mjs [--limit 100]
 */

import { getQueue } from './queue.mjs'

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = Math.max(1, Math.min(5000, Number.parseInt(limitIdx >= 0 ? args[limitIdx + 1] : '100', 10) || 100))

const q = getQueue()

const candidates = q.db.prepare(
  `
  SELECT id, osm_id, place_type, last_error
  FROM jobs
  WHERE job_type = 'scrape'
    AND status = 'failed'
    AND last_error IS NOT NULL

    -- include transient-ish
    AND (
      last_error LIKE '%fetch failed%'
      OR last_error LIKE '%This operation was aborted%'
      OR last_error LIKE '%timeout%'
      OR last_error LIKE 'HTTP 5%'
      OR last_error LIKE '%ECONNRESET%'
      OR last_error LIKE '%ETIMEDOUT%'
    )

    -- exclude things we do NOT want to retry right now
    AND last_error NOT LIKE 'HTTP 403%'
    AND last_error NOT LIKE 'HTTP 404%'
    AND last_error NOT LIKE 'HTTP 410%'

  ORDER BY id ASC
  LIMIT ?
  `
).all(limit)

const now = new Date().toISOString()

const byReason = new Map()
for (const c of candidates) {
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

requeueTx(candidates)

console.log(`requeued scrape jobs: ${candidates.length} (limit=${limit})`)
console.log('breakdown (original last_error):')
for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`- ${n}\t${reason}`)
}
