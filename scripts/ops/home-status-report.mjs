#!/usr/bin/env node
/**
 * Emit a compact Markdown status report for the home-server enrichment stack.
 *
 * This script is intentionally read-only for the queue and Postgres state. It
 * does not recover jobs, start workers, or sync data.
 */

import Database from 'better-sqlite3'
import pg from 'pg'
import 'dotenv/config'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { execFileSync, spawnSync } from 'child_process'

const args = new Set(process.argv.slice(2))
const MAX_ROWS = parseInt(process.env.HOME_STATUS_MAX_ROWS || '10', 10)
const STALE_MINUTES = parseInt(process.env.HOME_STATUS_STALE_MINUTES || '30', 10)

function run(cmd, cmdArgs = [], options = {}) {
  try {
    const stdout = execFileSync(cmd, cmdArgs, {
      encoding: 'utf8',
      timeout: options.timeout || 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })
    return { ok: true, stdout: stdout.trim(), stderr: '', status: 0 }
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || '').toString().trim(),
      stderr: (error.stderr || error.message || '').toString().trim(),
      status: error.status ?? 1
    }
  }
}

function errorMessage(error) {
  return error?.message || error?.code || String(error)
}

function repoRoot() {
  const result = run('git', ['rev-parse', '--show-toplevel'])
  return result.ok ? result.stdout : process.cwd()
}

function gitStatus(root) {
  return {
    branch: run('git', ['branch', '--show-current'], { cwd: root }).stdout || '(unknown)',
    head: run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).stdout || '(unknown)',
    headFull: run('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout || '(unknown)',
    originMain: run('git', ['rev-parse', '--short', 'origin/main'], { cwd: root }).stdout || '(unknown)',
    status: run('git', ['status', '--short', '--branch'], { cwd: root }).stdout || '(status unavailable)'
  }
}

function queueReport(root) {
  const dbPath = process.env.QUEUE_DB_PATH || join(root, 'scripts/.job-queue.db')
  if (!existsSync(dbPath)) {
    return { ok: false, dbPath, error: 'queue DB not found' }
  }

  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const totals = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM jobs
    `).get()

    const byType = db.prepare(`
      SELECT job_type, status, COUNT(*) as count
      FROM jobs
      GROUP BY job_type, status
      ORDER BY job_type, status
    `).all()

    const processingJobs = db.prepare(`
      SELECT id, job_type, osm_id, worker_id, attempts, max_attempts, started_at, last_error
      FROM jobs
      WHERE status = 'processing'
      ORDER BY started_at
      LIMIT ?
    `).all(MAX_ROWS)

    const staleProcessingJobs = db.prepare(`
      SELECT
        id,
        job_type,
        osm_id,
        worker_id,
        attempts,
        max_attempts,
        started_at,
        ROUND((julianday('now') - julianday(started_at)) * 24 * 60, 1) as minutes_processing,
        last_error
      FROM jobs
      WHERE status = 'processing'
        AND started_at < datetime('now', '-' || ? || ' minutes')
      ORDER BY started_at
      LIMIT ?
    `).all(STALE_MINUTES, MAX_ROWS)

    const workers = db.prepare(`
      SELECT
        worker_id,
        agent_type,
        status,
        current_job_id,
        jobs_completed,
        jobs_failed,
        last_heartbeat,
        ROUND((julianday('now') - julianday(last_heartbeat)) * 24 * 60, 1) as minutes_since_heartbeat
      FROM workers
      ORDER BY status DESC, agent_type, worker_id
      LIMIT ?
    `).all(MAX_ROWS)

    const staleWorkers = db.prepare(`
      SELECT
        worker_id,
        agent_type,
        status,
        current_job_id,
        last_heartbeat,
        ROUND((julianday('now') - julianday(last_heartbeat)) * 24 * 60, 1) as minutes_since_heartbeat
      FROM workers
      WHERE last_heartbeat < datetime('now', '-' || ? || ' minutes')
      ORDER BY last_heartbeat
      LIMIT ?
    `).all(STALE_MINUTES, MAX_ROWS)

    return { ok: true, dbPath, totals, byType, processingJobs, staleProcessingJobs, workers, staleWorkers }
  } catch (error) {
    return { ok: false, dbPath, error: errorMessage(error) }
  } finally {
    if (db) db.close()
  }
}

async function postgresReport() {
  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()
    const health = await client.query('SELECT current_database() as database, now() as checked_at')
    const pizza = await client.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE google_place_id LIKE 'osm:%')::int as osm_rows,
        COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL OR style_confidence IS NOT NULL)::int as classified_or_priced,
        MAX(last_enriched_at) as last_enriched_at
      FROM pizza_places
    `)
    const recent = await client.query(`
      SELECT id, name, state, google_place_id, style, price_range, style_confidence, last_enriched_at
      FROM pizza_places
      WHERE last_enriched_at IS NOT NULL
      ORDER BY last_enriched_at DESC
      LIMIT $1
    `, [Math.min(MAX_ROWS, 5)])

    const placeSourcesExists = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'place_sources'
      ) AS exists
    `)

    const sourceCounts = placeSourcesExists.rows[0].exists
      ? await client.query(`
          SELECT entity_type, source, COUNT(*)::int AS count
          FROM place_sources
          GROUP BY entity_type, source
          ORDER BY entity_type, source
        `)
      : { rows: [] }

    const osmMissing = placeSourcesExists.rows[0].exists
      ? await client.query(`
          SELECT COUNT(*)::int AS count
          FROM pizza_places p
          WHERE p.google_place_id LIKE 'osm:%'
            AND NOT EXISTS (
              SELECT 1
              FROM place_sources ps
              WHERE ps.entity_type = 'pizza'
                AND ps.source = 'osm'
                AND ps.source_id = regexp_replace(p.google_place_id, '^osm:', '')
            )
        `)
      : { rows: [{ count: null }] }

    const reviewQueueExists = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'source_review_queue'
      ) AS exists
    `)

    const reviewQueueStatusCounts = reviewQueueExists.rows[0].exists
      ? await client.query(`
          SELECT entity_type, review_kind, status, COUNT(*)::int AS count
          FROM source_review_queue
          GROUP BY entity_type, review_kind, status
          ORDER BY entity_type, review_kind, status
        `)
      : { rows: [] }

    const reviewQueueReportCounts = reviewQueueExists.rows[0].exists
      ? await client.query(`
          SELECT
            entity_type,
            source,
            report_file,
            review_kind,
            status,
            COUNT(*)::int AS count
          FROM source_review_queue
          GROUP BY entity_type, source, report_file, review_kind, status
          ORDER BY count DESC, report_file, review_kind, status
          LIMIT $1
        `, [MAX_ROWS])
      : { rows: [] }

    return {
      ok: true,
      health: health.rows[0],
      pizza: pizza.rows[0],
      recent: recent.rows,
      provenance: {
        placeSourcesExists: placeSourcesExists.rows[0].exists,
        sourceCounts: sourceCounts.rows,
        missingPizzaOsmSourceRows: osmMissing.rows[0].count,
        sourceReviewQueueExists: reviewQueueExists.rows[0].exists,
        sourceReviewQueueStatusCounts: reviewQueueStatusCounts.rows,
        sourceReviewQueueReportCounts: reviewQueueReportCounts.rows
      }
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  } finally {
    await client.end().catch(() => {})
  }
}

async function ollamaReport() {
  const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
    if (!res.ok) return { ok: false, baseUrl, error: `HTTP ${res.status}` }
    const data = await res.json()
    const models = (data.models || []).map(model => model.name).sort()
    return { ok: true, baseUrl, models }
  } catch (error) {
    return { ok: false, baseUrl, error: error.name === 'AbortError' ? 'timeout' : errorMessage(error) }
  } finally {
    clearTimeout(timeout)
  }
}

function processReport() {
  const ps = spawnSync('ps', ['ax', '-o', 'pid=,command='], { encoding: 'utf8' })
  if (ps.status !== 0) return { ok: false, error: ps.stderr?.trim() || 'ps failed' }

  const patterns = [
    'ollama',
    'llm-classifier.mjs',
    'web-scraper.mjs',
    'osm-extractor.mjs',
    'coordinator.mjs',
    'watchdog.mjs',
    'watchdog-keepalive.mjs',
    'sync-agent.mjs',
    'menu-parse-watchdog.mjs'
  ]

  const ownPid = process.pid.toString()
  const rows = ps.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith(ownPid))
    .filter(line => patterns.some(pattern => line.includes(pattern)))
    .slice(0, MAX_ROWS)

  return { ok: true, rows }
}

function launchdServiceReport(label) {
  const uid = run('id', ['-u']).stdout
  if (!uid) return { label, ok: false, error: 'unable to determine uid' }

  const result = run('launchctl', ['print', `gui/${uid}/${label}`])
  if (!result.ok) return { label, ok: false, error: result.stderr || result.stdout || 'launchctl print failed' }

  const field = name => {
    const match = result.stdout.match(new RegExp(`\\b${name} = ([^\\n]+)`))
    return match ? match[1].trim() : ''
  }

  return {
    label,
    ok: true,
    state: field('state'),
    pid: field('pid'),
    runs: field('runs'),
    lastExitCode: field('last exit code'),
    runInterval: field('run interval')
  }
}

function syncLockReport() {
  const path = process.env.APIZZA_SYNC_LOCK_DIR || '/tmp/apizzamichigan/supabase-sync.lock'
  if (!existsSync(path)) return { path, exists: false }

  try {
    const ageMinutes = (Date.now() - statSync(path).mtimeMs) / 60000
    return { path, exists: true, ageMinutes }
  } catch (error) {
    return { path, exists: true, error: errorMessage(error) }
  }
}

function fsqSampleReport(root) {
  const result = run(process.execPath, ['scripts/ops/fsq-sample-preflight.mjs', '--json'], {
    cwd: root,
    timeout: 10000
  })
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || 'fsq-sample-preflight failed'
    }
  }

  try {
    return { ok: true, ...JSON.parse(result.stdout) }
  } catch (error) {
    return { ok: false, error: `invalid fsq preflight JSON: ${errorMessage(error)}` }
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

function queueByTypeTable(byType) {
  const grouped = new Map()
  for (const row of byType || []) {
    if (!grouped.has(row.job_type)) grouped.set(row.job_type, { job_type: row.job_type, pending: 0, processing: 0, completed: 0, failed: 0 })
    grouped.get(row.job_type)[row.status] = row.count
  }
  return table(['job_type', 'pending', 'processing', 'completed', 'failed'], [...grouped.values()])
}

function formatProcessRows(rows) {
  if (!rows.length) return '_none_'
  return rows.map(row => `- \`${row}\``).join('\n')
}

async function main() {
  const root = repoRoot()
  const git = gitStatus(root)
  const queue = queueReport(root)
  const [postgres, ollama] = await Promise.all([postgresReport(), ollamaReport()])
  const processes = processReport()
  const launchd = [
    launchdServiceReport('com.apizzamichigan.classifier'),
    launchdServiceReport('com.apizzamichigan.supabase-sync')
  ]
  const syncLock = syncLockReport()
  const fsqSample = fsqSampleReport(root)
  const now = new Date().toISOString()

  if (args.has('--json')) {
    console.log(JSON.stringify({ generatedAt: now, root, git, queue, postgres, ollama, launchd, syncLock, fsqSample, processes }, null, 2))
    return
  }

  console.log(`# Home-server status report`)
  console.log(``)
  console.log(`Generated: ${now}`)
  console.log(`Repo: \`${root}\``)
  console.log(``)
  console.log(`## Git`)
  console.log(`- branch: \`${git.branch}\``)
  console.log(`- HEAD: \`${git.head}\``)
  console.log(`- origin/main: \`${git.originMain}\``)
  console.log(``)
  console.log('```text')
  console.log(git.status)
  console.log('```')
  console.log(``)

  console.log(`## Queue`)
  if (!queue.ok) {
    console.log(`- status: failed`)
    console.log(`- db: \`${queue.dbPath}\``)
    console.log(`- error: ${queue.error}`)
  } else {
    console.log(`- db: \`${queue.dbPath}\``)
    console.log(`- totals: pending=${queue.totals.pending}, processing=${queue.totals.processing}, completed=${queue.totals.completed}, failed=${queue.totals.failed}, total=${queue.totals.total}`)
    console.log(``)
    console.log(queueByTypeTable(queue.byType))
    console.log(``)
    console.log(`### Processing Jobs`)
    console.log(table(['id', 'job_type', 'osm_id', 'worker_id', 'attempts', 'max_attempts', 'started_at', 'last_error'], queue.processingJobs))
    console.log(``)
    console.log(`### Stale Processing Jobs (> ${STALE_MINUTES}m)`)
    console.log(table(['id', 'job_type', 'osm_id', 'worker_id', 'attempts', 'max_attempts', 'started_at', 'minutes_processing', 'last_error'], queue.staleProcessingJobs))
    console.log(``)
    console.log(`### Workers`)
    console.log(table(['worker_id', 'agent_type', 'status', 'current_job_id', 'jobs_completed', 'jobs_failed', 'last_heartbeat', 'minutes_since_heartbeat'], queue.workers))
    console.log(``)
    console.log(`### Stale Workers (> ${STALE_MINUTES}m)`)
    console.log(table(['worker_id', 'agent_type', 'status', 'current_job_id', 'last_heartbeat', 'minutes_since_heartbeat'], queue.staleWorkers))
  }
  console.log(``)

  console.log(`## Postgres`)
  if (!postgres.ok) {
    console.log(`- status: failed`)
    console.log(`- error: ${postgres.error}`)
  } else {
    console.log(`- status: ok`)
    console.log(`- database: \`${postgres.health.database}\``)
    console.log(`- pizza rows: total=${postgres.pizza.total}, osm_rows=${postgres.pizza.osm_rows}, classified_or_priced=${postgres.pizza.classified_or_priced}`)
    console.log(`- last_enriched_at: ${postgres.pizza.last_enriched_at || ''}`)
    console.log(``)
    console.log(`### Recent Enrichment Rows`)
    console.log(table(['id', 'name', 'state', 'google_place_id', 'style', 'price_range', 'style_confidence', 'last_enriched_at'], postgres.recent))
    console.log(``)
    console.log(`### Source Provenance`)
    console.log(`- place_sources exists: ${postgres.provenance.placeSourcesExists ? 'yes' : 'no'}`)
    console.log(`- missing pizza OSM source rows: ${postgres.provenance.missingPizzaOsmSourceRows ?? 'n/a'}`)
    console.log(``)
    console.log(table(['entity_type', 'source', 'count'], postgres.provenance.sourceCounts))
    console.log(``)
    console.log(`### Source Review Queue`)
    console.log(`- source_review_queue exists: ${postgres.provenance.sourceReviewQueueExists ? 'yes' : 'no'}`)
    console.log(``)
    console.log(table(['entity_type', 'review_kind', 'status', 'count'], postgres.provenance.sourceReviewQueueStatusCounts || []))
    console.log(``)
    console.log(`### Source Review Queue by Report`)
    console.log(table(['entity_type', 'source', 'report_file', 'review_kind', 'status', 'count'], postgres.provenance.sourceReviewQueueReportCounts || []))
  }
  console.log(``)

  console.log(`## Launchd Services`)
  console.log(table(['label', 'state', 'pid', 'runs', 'lastExitCode', 'runInterval', 'status'], launchd.map(service => ({
    label: service.label,
    state: service.state || '',
    pid: service.pid || '',
    runs: service.runs || '',
    lastExitCode: service.lastExitCode || '',
    runInterval: service.runInterval || '',
    status: service.ok ? 'ok' : `failed: ${service.error}`
  }))))
  console.log(``)

  console.log(`## Sync Lock`)
  console.log(`- path: \`${syncLock.path}\``)
  console.log(`- exists: ${syncLock.exists ? 'yes' : 'no'}`)
  if (syncLock.exists && syncLock.ageMinutes !== undefined) {
    console.log(`- age_minutes: ${syncLock.ageMinutes.toFixed(1)}`)
  }
  if (syncLock.error) {
    console.log(`- error: ${syncLock.error}`)
  }
  console.log(``)

  console.log(`## FSQ Sample Readiness`)
  if (!fsqSample.ok) {
    console.log(`- status: failed`)
    console.log(`- error: ${fsqSample.error}`)
  } else {
    console.log(`- state: \`${fsqSample.state}\``)
    console.log(`- input: ${fsqSample.input || '(missing)'}`)
    console.log(`- input_exists: ${fsqSample.input_exists ? 'yes' : 'no'}`)
    console.log(`- can_export_via_hf: ${fsqSample.can_export_via_hf ? 'yes' : 'no'}`)
    console.log(`- duckdb_cli: ${fsqSample.duckdb_cli}`)
    if (fsqSample.missing?.length) {
      console.log(`- missing:`)
      for (const item of fsqSample.missing) console.log(`  - ${item}`)
    }
  }
  console.log(``)

  console.log(`## Ollama`)
  if (!ollama.ok) {
    console.log(`- status: failed`)
    console.log(`- url: \`${ollama.baseUrl}\``)
    console.log(`- error: ${ollama.error}`)
  } else {
    console.log(`- status: ok`)
    console.log(`- url: \`${ollama.baseUrl}\``)
    console.log(`- models: ${ollama.models.map(model => `\`${model}\``).join(', ') || '_none_'}`)
  }
  console.log(``)

  console.log(`## Related Processes`)
  if (!processes.ok) {
    console.log(`- status: failed`)
    console.log(`- error: ${processes.error}`)
  } else {
    console.log(formatProcessRows(processes.rows))
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
