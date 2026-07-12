#!/usr/bin/env node
/**
 * Summarize the append-only "can't scrape" log.
 *
 * Default input: /tmp/openclaw/scrape-cant-scrape.jsonl
 * Usage:
 *   node scripts/enrichment/scrape-cant-scrape-report.mjs [--file <path>] [--limit 25]
 */

import fs from 'node:fs'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const limitIdx = args.indexOf('--limit')
const file = fileIdx >= 0 ? args[fileIdx + 1] : (process.env.SCRAPE_CANT_SCRAPE_LOG || '/tmp/openclaw/scrape-cant-scrape.jsonl')
const limit = Math.max(1, Math.min(200, Number.parseInt(limitIdx >= 0 ? args[limitIdx + 1] : '25', 10) || 25))

if (!fs.existsSync(file)) {
  console.log(`No cant-scrape log found at: ${file}`)
  process.exit(0)
}

const text = fs.readFileSync(file, 'utf8')
const lines = text.split(/\r?\n/).filter(Boolean)

const byReason = new Map()
const byHost = new Map()

for (const line of lines) {
  try {
    const e = JSON.parse(line)
    const reason = String(e.error || e.reason || 'unknown')
    byReason.set(reason, (byReason.get(reason) || 0) + 1)

    const url = e.url ? String(e.url) : ''
    let host = 'unknown'
    try {
      host = new URL(url).hostname || 'unknown'
    } catch {}
    byHost.set(host, (byHost.get(host) || 0) + 1)
  } catch {
    // ignore malformed line
  }
}

function topEntries(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}

console.log(`cant-scrape log: ${file}`)
console.log(`entries: ${lines.length}`)

console.log('\nTop reasons:')
for (const [k, v] of topEntries(byReason)) {
  console.log(`- ${v}\t${k}`)
}

console.log('\nTop hosts:')
for (const [k, v] of topEntries(byHost)) {
  console.log(`- ${v}\t${k}`)
}
