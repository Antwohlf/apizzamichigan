#!/usr/bin/env node
/**
 * Run a bounded classifier batch and emit a Markdown report.
 *
 * This intentionally mutates local queue/Postgres state by running the
 * classifier. It does not start scraper, sync, cron, keepalive, or coordinator.
 */

import Database from 'better-sqlite3'
import pg from 'pg'
import 'dotenv/config'
import { existsSync } from 'fs'
import { join } from 'path'
import { execFileSync, spawn } from 'child_process'

function parseArgs(argv) {
  const out = {
    maxJobs: 5,
    timeoutMs: 240000,
    numPredict: 80,
    temperature: 0,
    numThreads: null,
    model: null,
    showLog: false,
    stream: true
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--max-jobs') out.maxJobs = parseInt(argv[++i], 10)
    else if (arg === '--timeout-ms') out.timeoutMs = parseInt(argv[++i], 10)
    else if (arg === '--num-predict') out.numPredict = parseInt(argv[++i], 10)
    else if (arg === '--temperature') out.temperature = Number(argv[++i])
    else if (arg === '--num-threads') out.numThreads = parseInt(argv[++i], 10)
    else if (arg === '--model') out.model = argv[++i]
    else if (arg === '--show-log') out.showLog = true
    else if (arg === '--no-stream') out.stream = false
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/classifier-batch-report.mjs [options]

Options:
  --max-jobs <n>       Number of classifier jobs to process (default 5)
  --timeout-ms <n>     Ollama request timeout per job (default 240000)
  --num-predict <n>    Ollama output token cap (default 80)
  --temperature <n>    Ollama temperature (default 0)
  --num-threads <n>    Optional Ollama num_thread override
  --model <name>       Optional OLLAMA_MODEL override; omit to use repo default
  --show-log           Include full classifier stdout/stderr in the report
  --no-stream          Do not stream classifier output to stderr during the run
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(out.maxJobs) || out.maxJobs <= 0) throw new Error('Invalid --max-jobs')
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) throw new Error('Invalid --timeout-ms')
  if (!Number.isFinite(out.numPredict) || out.numPredict <= 0) throw new Error('Invalid --num-predict')
  if (!Number.isFinite(out.temperature)) throw new Error('Invalid --temperature')
  if (out.numThreads !== null && (!Number.isFinite(out.numThreads) || out.numThreads <= 0)) throw new Error('Invalid --num-threads')

  return out
}

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
    status: run('git', ['status', '--short', '--branch'], { cwd: root }).stdout || '(status unavailable)'
  }
}

function openQueueDb(root) {
  const dbPath = process.env.QUEUE_DB_PATH || join(root, 'scripts/.job-queue.db')
  if (!existsSync(dbPath)) throw new Error(`queue DB not found: ${dbPath}`)
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

function queueStats(root) {
  const db = openQueueDb(root)
  try {
    const rows = db.prepare(`
      SELECT job_type, status, COUNT(*) as count
      FROM jobs
      GROUP BY job_type, status
      ORDER BY job_type, status
    `).all()

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM jobs
    `).get()

    const grouped = new Map()
    for (const row of rows) {
      if (!grouped.has(row.job_type)) grouped.set(row.job_type, { job_type: row.job_type, pending: 0, processing: 0, completed: 0, failed: 0 })
      grouped.get(row.job_type)[row.status] = row.count
    }

    return { totals, byType: [...grouped.values()] }
  } finally {
    db.close()
  }
}

function queueRows(root, jobIds) {
  if (!jobIds.length) return []
  const db = openQueueDb(root)
  try {
    const placeholders = jobIds.map(() => '?').join(',')
    return db.prepare(`
      SELECT id, job_type, osm_id, status, worker_id, attempts, max_attempts, started_at, completed_at, last_error
      FROM jobs
      WHERE id IN (${placeholders})
      ORDER BY id
    `).all(...jobIds)
  } finally {
    db.close()
  }
}

async function postgresRows(osmIds) {
  if (!osmIds.length) return { ok: true, rows: [] }
  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()
    const result = await client.query(`
      SELECT id, name, state, google_place_id, style, price_range, style_confidence, enrichment_status, last_enriched_at
      FROM pizza_places
      WHERE google_place_id = ANY($1)
      ORDER BY array_position($1, google_place_id)
    `, [osmIds])
    return { ok: true, rows: result.rows }
  } catch (error) {
    return { ok: false, error: errorMessage(error), rows: [] }
  } finally {
    await client.end().catch(() => {})
  }
}

function parseClassifierOutput(output) {
  const claimed = []
  const promptSizes = new Map()
  let model = null
  let exitedByMaxJobs = false
  let stopped = false

  for (const line of output.split('\n')) {
    const modelMatch = line.match(/LLM Classifier started \(model=([^)]+)\)/)
    if (modelMatch) model = modelMatch[1]

    const claimedMatch = line.match(/Claimed classify job (\d+) \(([^)]+)\)/)
    if (claimedMatch) claimed.push({ id: Number(claimedMatch[1]), osm_id: claimedMatch[2] })

    const promptMatch = line.match(/Prompt size for job (\d+): (\d+) chars/)
    if (promptMatch) promptSizes.set(Number(promptMatch[1]), Number(promptMatch[2]))

    if (line.includes('Reached max jobs')) exitedByMaxJobs = true
    if (line.includes('LLM Classifier stopped')) stopped = true
  }

  return {
    model,
    claimed,
    promptSizes,
    exitedByItself: exitedByMaxJobs && stopped
  }
}

function runClassifier(root, options) {
  return new Promise(resolve => {
    const env = {
      ...process.env,
      CLASSIFY_MAX_JOBS: String(options.maxJobs),
      OLLAMA_TIMEOUT_MS: String(options.timeoutMs),
      OLLAMA_NUM_PREDICT: String(options.numPredict),
      OLLAMA_TEMPERATURE: String(options.temperature)
    }
    if (options.model) env.OLLAMA_MODEL = options.model
    if (options.numThreads !== null) env.OLLAMA_NUM_THREADS = String(options.numThreads)

    const child = spawn(process.execPath, ['scripts/enrichment/agents/llm-classifier.mjs', '--max-jobs', String(options.maxJobs)], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    const startedAt = Date.now()

    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      if (options.stream) process.stderr.write(text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      if (options.stream) process.stderr.write(text)
    })
    child.on('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
        wallClockSeconds: Math.round((Date.now() - startedAt) / 1000)
      })
    })
  })
}

function delta(before, after, jobType) {
  const beforeRow = before.byType.find(row => row.job_type === jobType) || {}
  const afterRow = after.byType.find(row => row.job_type === jobType) || {}
  return {
    job_type: jobType,
    pending: (afterRow.pending || 0) - (beforeRow.pending || 0),
    processing: (afterRow.processing || 0) - (beforeRow.processing || 0),
    completed: (afterRow.completed || 0) - (beforeRow.completed || 0),
    failed: (afterRow.failed || 0) - (beforeRow.failed || 0)
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

function classifyRow(stats) {
  return stats.byType.find(row => row.job_type === 'classify') || { job_type: 'classify', pending: 0, processing: 0, completed: 0, failed: 0 }
}

async function main() {
  const options = parseArgs(process.argv)
  const root = repoRoot()
  const git = gitStatus(root)
  const startedAtIso = new Date().toISOString()
  const before = queueStats(root)
  const classifier = await runClassifier(root, options)
  const endedAtIso = new Date().toISOString()
  const after = queueStats(root)
  const parsed = parseClassifierOutput(`${classifier.stdout}\n${classifier.stderr}`)
  const jobIds = parsed.claimed.map(job => job.id)
  const osmIds = parsed.claimed.map(job => job.osm_id)
  const finalJobRows = queueRows(root, jobIds).map(row => ({
    ...row,
    prompt_size: parsed.promptSizes.get(row.id) ?? ''
  }))
  const pgRows = await postgresRows(osmIds)
  const failures = finalJobRows.filter(row => row.status !== 'completed' || row.last_error)
  const classifyDelta = delta(before, after, 'classify')

  console.log(`# Classifier batch report`)
  console.log(``)
  console.log(`Started: ${startedAtIso}`)
  console.log(`Ended: ${endedAtIso}`)
  console.log(`Wall-clock runtime: ${classifier.wallClockSeconds}s`)
  console.log(``)
  console.log(`## Git`)
  console.log(`- branch: \`${git.branch}\``)
  console.log(`- HEAD: \`${git.head}\``)
  console.log(``)
  console.log('```text')
  console.log(git.status)
  console.log('```')
  console.log(``)

  console.log(`## Run`)
  console.log(`- max_jobs: ${options.maxJobs}`)
  console.log(`- model: ${parsed.model ? `\`${parsed.model}\`` : options.model ? `\`${options.model}\`` : 'repo default (not observed)'}`)
  console.log(`- timeout_ms: ${options.timeoutMs}`)
  console.log(`- num_predict: ${options.numPredict}`)
  console.log(`- temperature: ${options.temperature}`)
  if (options.numThreads !== null) console.log(`- num_threads: ${options.numThreads}`)
  console.log(`- exit_code: ${classifier.code}`)
  console.log(`- signal: ${classifier.signal || ''}`)
  console.log(`- exited_by_itself: ${parsed.exitedByItself ? 'yes' : 'no'}`)
  console.log(``)

  console.log(`## Queue Delta`)
  console.log(`### Start classify counts`)
  console.log(table(['job_type', 'pending', 'processing', 'completed', 'failed'], [classifyRow(before)]))
  console.log(``)
  console.log(`### End classify counts`)
  console.log(table(['job_type', 'pending', 'processing', 'completed', 'failed'], [classifyRow(after)]))
  console.log(``)
  console.log(`### Classify delta`)
  console.log(table(['job_type', 'pending', 'processing', 'completed', 'failed'], [classifyDelta]))
  console.log(``)
  console.log(`- final overall processing: ${after.totals.processing}`)
  console.log(``)

  console.log(`## Claimed Jobs`)
  console.log(table(['id', 'osm_id'], parsed.claimed))
  console.log(``)
  console.log(`## Final Job Rows`)
  console.log(table(['id', 'job_type', 'osm_id', 'status', 'worker_id', 'attempts', 'max_attempts', 'started_at', 'completed_at', 'prompt_size', 'last_error'], finalJobRows))
  console.log(``)
  console.log(`## Timeout / Requeue / Failure Rows`)
  console.log(table(['id', 'job_type', 'osm_id', 'status', 'attempts', 'max_attempts', 'last_error'], failures))
  console.log(``)
  console.log(`## Postgres Rows`)
  if (!pgRows.ok) {
    console.log(`Postgres lookup failed: ${pgRows.error}`)
  } else {
    console.log(table(['id', 'name', 'state', 'google_place_id', 'style', 'price_range', 'style_confidence', 'enrichment_status', 'last_enriched_at'], pgRows.rows))
  }
  console.log(``)

  if (options.showLog || classifier.code !== 0) {
    console.log(`## Classifier stdout`)
    console.log('```text')
    console.log(classifier.stdout.trim())
    console.log('```')
    console.log(``)
    console.log(`## Classifier stderr`)
    console.log('```text')
    console.log(classifier.stderr.trim())
    console.log('```')
  }

  if (classifier.code !== 0) process.exitCode = classifier.code
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
