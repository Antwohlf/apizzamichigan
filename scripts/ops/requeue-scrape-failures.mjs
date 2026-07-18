#!/usr/bin/env node

/**
 * Requeue a bounded set of exhausted transient scrape failures.
 *
 * Dry-run by default. Blocked, dead-link, and unknown failures are never
 * selected because they require a different operator decision.
 */

import { getQueue } from '../enrichment/queue.mjs'

const args = parseArgs(process.argv.slice(2))
const queue = getQueue()

function parseArgs(argv) {
  const out = { category: 'transient', source: null, limit: 100, apply: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--category') out.category = argv[++i]
    else if (argv[i] === '--source') out.source = argv[++i]
    else if (argv[i] === '--limit') out.limit = Number.parseInt(argv[++i], 10)
    else if (argv[i] === '--apply') out.apply = true
    else if (argv[i] === '--json') out.json = true
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/ops/requeue-scrape-failures.mjs [--category transient] [--source osm|fsq_os_places|all_the_places|overture_places] [--limit 100] [--apply] [--json]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (out.category !== 'transient') throw new Error('Only --category transient is supported.')
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 1000) throw new Error('--limit must be between 1 and 1000.')
  return out
}

function classify(message) {
  const value = String(message || '').toLowerCase()
  if (/http 403|http 401|forbidden|access denied|robots/.test(value)) return 'blocked'
  if (/http 404|http 410|not found|no website|invalid url|failed to parse url|parse url|enotfound/.test(value)) return 'dead_link'
  if (/http 408|http 409|http 429|http 5\d\d|fetch failed|timeout|aborted|econnreset|etimedout|econnrefused|network|database is locked|sqlite_busy|busy_snapshot/.test(value)) return 'transient'
  return 'unknown'
}

try {
  const candidates = queue.db.prepare(`
    SELECT id, osm_id, attempts, max_attempts, last_error
    FROM jobs
    WHERE job_type = 'scrape'
      AND status = 'failed'
      AND attempts >= max_attempts
    ORDER BY id
  `).all().filter(row => classify(row.last_error) === args.category)
    .filter(row => !args.source || String(row.osm_id || '').startsWith(`${args.source}:`))
    .slice(0, args.limit)

  if (args.apply) {
    for (const row of candidates) {
      queue.retry(row.id, `Requeued bounded transient scrape recovery: ${row.last_error || 'transient failure'}`, { refundAttempt: true })
    }
  }

  const result = {
    mode: args.apply ? 'apply' : 'dry-run',
    category: args.category,
    source: args.source || 'all',
    limit: args.limit,
    selected: candidates.length,
    job_ids: candidates.map(row => row.id),
  }
  console.log(args.json ? JSON.stringify(result, null, 2) : `requeue scrape failures: mode=${result.mode} category=${result.category} selected=${result.selected}`)
} finally {
  queue.close()
}
