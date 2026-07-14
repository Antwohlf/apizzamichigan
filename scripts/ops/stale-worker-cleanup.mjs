#!/usr/bin/env node
/**
 * Clean stale SQLite worker registry rows.
 *
 * Default mode is dry-run. Use --apply to delete rows. This does not requeue or
 * mutate jobs; if a stale worker still owns a processing job, the script reports
 * it as blocked and leaves it untouched.
 */

import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

function parseArgs(argv) {
  const out = {
    apply: false,
    minutes: 30,
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') out.apply = true
    else if (arg === '--minutes') out.minutes = parseInt(argv[++i], 10)
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/stale-worker-cleanup.mjs [options]

Options:
  --minutes <n>  Worker heartbeat age threshold (default 30)
  --apply        Delete safe stale worker rows. Omit for dry-run.
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(out.minutes) || out.minutes <= 0) {
    throw new Error('Invalid --minutes')
  }

  return out
}

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return process.cwd()
  }
}

function table(headers, rows) {
  if (!rows.length) return '_none_'
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

function main() {
  const args = parseArgs(process.argv)
  const root = repoRoot()
  const dbPath = process.env.QUEUE_DB_PATH || join(root, 'scripts/.job-queue.db')

  if (!existsSync(dbPath)) {
    throw new Error(`queue DB not found: ${dbPath}`)
  }

  const db = new Database(dbPath)
  db.pragma('busy_timeout = 20000')

  try {
    const stale = db.prepare(`
      SELECT
        w.worker_id,
        w.agent_type,
        w.status,
        w.current_job_id,
        w.jobs_completed,
        w.jobs_failed,
        w.last_heartbeat,
        ROUND((julianday('now') - julianday(w.last_heartbeat)) * 24 * 60, 1) as minutes_since_heartbeat,
        j.id as processing_job_id,
        j.status as processing_job_status
      FROM workers w
      LEFT JOIN jobs j
        ON j.worker_id = w.worker_id
       AND j.status = 'processing'
      WHERE w.last_heartbeat < datetime('now', '-' || ? || ' minutes')
      ORDER BY w.last_heartbeat, w.worker_id
    `).all(args.minutes)

    const blocked = stale.filter(row => row.processing_job_id)
    const deletable = stale.filter(row => !row.processing_job_id)

    if (args.apply && deletable.length) {
      const deleteWorker = db.prepare('DELETE FROM workers WHERE worker_id = ?')
      const tx = db.transaction((rows) => {
        for (const row of rows) deleteWorker.run(row.worker_id)
      })
      tx(deletable)
    }

    console.log(`# Stale worker cleanup ${args.apply ? 'apply' : 'dry-run'}`)
    console.log('')
    console.log(`Generated: ${new Date().toISOString()}`)
    console.log(`Queue DB: \`${dbPath}\``)
    console.log(`Threshold: ${args.minutes} minutes`)
    console.log('')
    console.log(`- stale rows found: ${stale.length}`)
    console.log(`- safe to delete: ${deletable.length}`)
    console.log(`- blocked by active processing job: ${blocked.length}`)
    console.log(`- rows deleted: ${args.apply ? deletable.length : 0}`)
    console.log('')
    console.log('## Safe stale rows')
    console.log(table([
      'worker_id',
      'agent_type',
      'status',
      'current_job_id',
      'jobs_completed',
      'jobs_failed',
      'last_heartbeat',
      'minutes_since_heartbeat'
    ], deletable))
    console.log('')
    console.log('## Blocked rows')
    console.log(table([
      'worker_id',
      'agent_type',
      'status',
      'current_job_id',
      'last_heartbeat',
      'minutes_since_heartbeat',
      'processing_job_id',
      'processing_job_status'
    ], blocked))

    if (!args.apply && deletable.length) {
      console.log('')
      console.log(`Run with \`--apply\` to delete the ${deletable.length} safe stale worker rows.`)
    }
  } finally {
    db.close()
  }
}

main()
