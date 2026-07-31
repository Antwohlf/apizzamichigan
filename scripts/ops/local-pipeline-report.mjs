#!/usr/bin/env node

/** Compact read-only report for local development while the home server is unavailable. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'

const root = process.cwd()
const json = process.argv.includes('--json')

function command(command, args) {
  try {
    return { ok: true, value: execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 10_000 }).trim() }
  } catch (error) {
    return { ok: false, value: String(error.stderr || error.message || error).trim().split('\n')[0] }
  }
}

function fixtureSummary() {
  const result = command(process.execPath, ['scripts/ops/local-fixture-pipeline.mjs', '--json'])
  return result.ok ? JSON.parse(result.value).summary : { error: result.value }
}

function queueSummary() {
  const db = resolve(root, 'scripts/.job-queue.db')
  if (!existsSync(db)) return { available: false, reason: 'local queue database not present' }
  let connection
  try {
    connection = new Database(db, { readonly: true, fileMustExist: true })
    const totals = connection.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM jobs
    `).get()
    return { available: true, totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)])) }
  } catch (error) {
    return { available: false, reason: error.message }
  } finally {
    connection?.close()
  }
}

const report = {
  generated_at: new Date().toISOString(),
  read_only: true,
  git: {
    branch: command('git', ['branch', '--show-current']).value,
    head: command('git', ['rev-parse', '--short', 'HEAD']).value,
    status: command('git', ['status', '--short', '--branch']).value,
  },
  fixture: fixtureSummary(),
  queue: queueSummary(),
  ollama: command('curl', ['-fsS', '--max-time', '3', 'http://127.0.0.1:11434/api/tags']).ok ? 'reachable' : 'unavailable',
  postgres: process.env.PGHOST || process.env.PGDATABASE ? 'configured, not queried by this report' : 'not configured',
}

if (json) console.log(JSON.stringify(report, null, 2))
else {
  console.log('Local APizzaMichigan development report')
  console.log(`Git: ${report.git.branch} @ ${report.git.head}`)
  console.log(`Fixture: ${report.fixture.valid ?? 'n/a'} valid / ${report.fixture.total ?? 'n/a'} total`)
  console.log(`Queue: ${report.queue.available ? 'available' : report.queue.reason}`)
  console.log(`Ollama: ${report.ollama}`)
  console.log(`Postgres: ${report.postgres}`)
  console.log('Mode: read-only; no sync or canonical writes')
}
