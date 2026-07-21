#!/usr/bin/env node

/**
 * Requeue transient scrape failures in small batches. This deliberately does
 * not select blocked, dead-link, or unknown failures.
 */

import { getQueue } from '../enrichment/queue.mjs'

const args = parseArgs(process.argv.slice(2))
const queue = getQueue()

function parseArgs(argv) {
  const out = {
    limit: 100,
    batchSize: 25,
    delayMs: 15000,
    backoff: 1.5,
    maxDelayMs: 120000,
    apply: false,
    source: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--limit') out.limit = Number.parseInt(argv[++i], 10)
    else if (arg === '--batch-size') out.batchSize = Number.parseInt(argv[++i], 10)
    else if (arg === '--delay-ms') out.delayMs = Number.parseInt(argv[++i], 10)
    else if (arg === '--backoff') out.backoff = Number.parseFloat(argv[++i])
    else if (arg === '--max-delay-ms') out.maxDelayMs = Number.parseInt(argv[++i], 10)
    else if (arg === '--source') out.source = argv[++i]
    else if (arg === '--apply') out.apply = true
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/retry-scrape-failures-batched.mjs [options]

Options:
  --limit <n>          Maximum jobs to retry (default 100)
  --batch-size <n>     Jobs per batch (default 25)
  --delay-ms <n>       Delay between batches (default 15000)
  --backoff <n>        Delay multiplier (default 1.5)
  --max-delay-ms <n>   Maximum inter-batch delay (default 120000)
  --source <name>      Limit to an input source prefix
  --apply              Apply changes; otherwise preview only
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 10000) throw new Error('--limit must be 1-10000')
  if (!Number.isInteger(out.batchSize) || out.batchSize < 1 || out.batchSize > 500) throw new Error('--batch-size must be 1-500')
  if (!Number.isInteger(out.delayMs) || out.delayMs < 0) throw new Error('--delay-ms must be >= 0')
  if (!Number.isFinite(out.backoff) || out.backoff < 1) throw new Error('--backoff must be >= 1')
  if (!Number.isInteger(out.maxDelayMs) || out.maxDelayMs < out.delayMs) throw new Error('--max-delay-ms must be >= --delay-ms')
  return out
}

function classify(message) {
  const value = String(message || '').replace(/^cached error:\s*/i, '').toLowerCase()
  if (/http (401|403|404|410)\b|forbidden|access denied|not found|no website|invalid url|failed to parse url|enotfound/.test(value)) return null
  if (/fetch failed|aborted|timeout|^http 5\d\d\b|econnreset|etimedout|econnrefused|network|database is locked|sqlite_busy|busy_snapshot/.test(value)) return 'transient'
  return null
}

const candidates = queue.db.prepare(`
  SELECT id, osm_id, last_error
  FROM jobs
  WHERE job_type = 'scrape'
    AND status = 'failed'
    AND attempts >= max_attempts
  ORDER BY id
`).all()
  .filter(row => classify(row.last_error) === 'transient')
  .filter(row => !args.source || String(row.osm_id || '').startsWith(`${args.source}:`))
  .slice(0, args.limit)

const result = {
  mode: args.apply ? 'apply' : 'dry-run',
  selected: candidates.length,
  limit: args.limit,
  batchSize: args.batchSize,
  source: args.source || 'all',
  batches: Math.ceil(candidates.length / args.batchSize),
}

if (!args.apply) {
  console.log(JSON.stringify(result, null, 2))
  queue.close()
  process.exit(0)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let delay = args.delayMs
for (let offset = 0; offset < candidates.length; offset += args.batchSize) {
  const batch = candidates.slice(offset, offset + args.batchSize)
  for (const row of batch) {
    queue.retry(row.id, `Bounded transient retry: ${row.last_error || 'transient failure'}`, { refundAttempt: true })
  }
  console.log(`requeued batch ${Math.floor(offset / args.batchSize) + 1}/${result.batches}: ${batch.length} jobs`)
  if (offset + args.batchSize < candidates.length && delay > 0) {
    await sleep(delay)
    delay = Math.min(args.maxDelayMs, Math.max(delay, Math.round(delay * args.backoff)))
  }
}

queue.close()
console.log(JSON.stringify(result, null, 2))

