/**
 * SQLite Job Queue for Multi-Agent Enrichment Pipeline
 *
 * Provides atomic job claiming, crash recovery, and priority scheduling.
 * Uses SQLite for simplicity (no Redis required).
 *
 * Usage:
 *   import { JobQueue } from './queue.mjs'
 *   const queue = new JobQueue()
 *   await queue.init()
 *   const job = await queue.claim('osm_extract', 'osm-extractor-1')
 *   await queue.complete(job.id)
 */

import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { calculatePriority } from './priority.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DB_PATH = join(__dirname, '../.job-queue.db')

export class JobQueue {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath
    this.db = null
  }

  /**
   * Initialize the database and create tables
   */
  init() {
    // Ensure directory exists
    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')  // Better concurrency
    this.db.pragma('busy_timeout = 20000')  // Wait up to 20s for locks

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        osm_id TEXT NOT NULL,
        place_type TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        worker_id TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        last_error TEXT,
        data TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(job_type, osm_id)
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(job_type, status, priority DESC, created_at)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_jobs_processing ON jobs(worker_id, status)
        WHERE status = 'processing';
      CREATE INDEX IF NOT EXISTS idx_jobs_osm_id ON jobs(osm_id);

      CREATE TABLE IF NOT EXISTS workers (
        worker_id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL,
        status TEXT DEFAULT 'idle',
        current_job_id INTEGER,
        jobs_completed INTEGER DEFAULT 0,
        jobs_failed INTEGER DEFAULT 0,
        last_heartbeat TEXT DEFAULT (datetime('now')),
        started_at TEXT DEFAULT (datetime('now')),
        config TEXT
      );

      CREATE TABLE IF NOT EXISTS stats (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `)

    return this
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  // =========================================================
  // JOB OPERATIONS
  // =========================================================

  /**
   * Add a job to the queue
   */
  addJob(jobType, osmId, placeType, data = null, priority = null) {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (job_type, osm_id, place_type, priority, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(job_type, osm_id) DO NOTHING
    `)

    const calculatedPriority = priority ?? calculatePriority(data?.state)
    const result = stmt.run(jobType, osmId, placeType, calculatedPriority, JSON.stringify(data))

    return result.changes > 0
  }

  /**
   * Add multiple jobs in a single transaction
   */
  addJobs(jobs) {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (job_type, osm_id, place_type, priority, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(job_type, osm_id) DO NOTHING
    `)

    const insertMany = this.db.transaction((jobs) => {
      let added = 0
      for (const job of jobs) {
        const priority = job.priority ?? calculatePriority(job.data?.state)
        const result = stmt.run(job.jobType, job.osmId, job.placeType, priority, JSON.stringify(job.data))
        if (result.changes > 0) added++
      }
      return added
    })

    return insertMany(jobs)
  }

  /**
   * Atomically claim the next available job
   */
  claim(jobType, workerId) {
    const claim = this.db.transaction(() => {
      // Find next available job
      const job = this.db.prepare(`
        SELECT id, osm_id, place_type, data, attempts
        FROM jobs
        WHERE job_type = ?
          AND status = 'pending'
          AND attempts < max_attempts
        ORDER BY priority DESC, created_at
        LIMIT 1
      `).get(jobType)

      if (!job) return null

      // Claim it atomically
      this.db.prepare(`
        UPDATE jobs
        SET status = 'processing',
            worker_id = ?,
            started_at = datetime('now'),
            attempts = attempts + 1
        WHERE id = ?
      `).run(workerId, job.id)

      // Update worker state
      this.db.prepare(`
        UPDATE workers
        SET status = 'working',
            current_job_id = ?,
            last_heartbeat = datetime('now')
        WHERE worker_id = ?
      `).run(job.id, workerId)

      return {
        id: job.id,
        osmId: job.osm_id,
        placeType: job.place_type,
        data: job.data ? JSON.parse(job.data) : null,
        attempts: job.attempts + 1
      }
    })

    return claim()
  }

  /**
   * Mark a job as completed
   */
  complete(jobId, outputData = null) {
    const complete = this.db.transaction(() => {
      const job = this.db.prepare('SELECT worker_id FROM jobs WHERE id = ?').get(jobId)

      this.db.prepare(`
        UPDATE jobs
        SET status = 'completed',
            completed_at = datetime('now'),
            data = CASE WHEN ? IS NOT NULL THEN ? ELSE data END
        WHERE id = ?
      `).run(outputData ? JSON.stringify(outputData) : null, outputData ? JSON.stringify(outputData) : null, jobId)

      if (job?.worker_id) {
        this.db.prepare(`
          UPDATE workers
          SET status = 'idle',
              current_job_id = NULL,
              jobs_completed = jobs_completed + 1,
              last_heartbeat = datetime('now')
          WHERE worker_id = ?
        `).run(job.worker_id)
      }
    })

    complete()
  }

  /**
   * Mark a job as failed
   */
  fail(jobId, errorMessage) {
    const fail = this.db.transaction(() => {
      const job = this.db.prepare('SELECT worker_id, attempts, max_attempts FROM jobs WHERE id = ?').get(jobId)

      // If still has retries, set back to pending
      const newStatus = job && job.attempts < job.max_attempts ? 'pending' : 'failed'

      this.db.prepare(`
        UPDATE jobs
        SET status = ?,
            worker_id = NULL,
            last_error = ?,
            completed_at = CASE WHEN ? = 'failed' THEN datetime('now') ELSE NULL END
        WHERE id = ?
      `).run(newStatus, errorMessage, newStatus, jobId)

      if (job?.worker_id) {
        this.db.prepare(`
          UPDATE workers
          SET status = 'idle',
              current_job_id = NULL,
              jobs_failed = jobs_failed + 1,
              last_heartbeat = datetime('now')
          WHERE worker_id = ?
        `).run(job.worker_id)
      }
    })

    fail()
  }

  /**
   * Recover orphaned jobs (from crashed workers)
   */
  recoverOrphaned(timeoutMinutes = 10) {
    const result = this.db.prepare(`
      UPDATE jobs
      SET status = 'pending',
          worker_id = NULL,
          started_at = NULL
      WHERE status = 'processing'
        AND started_at < datetime('now', '-' || ? || ' minutes')
    `).run(timeoutMinutes)

    return result.changes
  }

  // =========================================================
  // WORKER OPERATIONS
  // =========================================================

  /**
   * Register a new worker
   */
  registerWorker(workerId, agentType, config = null) {
    this.db.prepare(`
      INSERT INTO workers (worker_id, agent_type, config)
      VALUES (?, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        status = 'idle',
        started_at = datetime('now'),
        config = ?
    `).run(workerId, agentType, JSON.stringify(config), JSON.stringify(config))
  }

  /**
   * Update worker heartbeat
   */
  heartbeat(workerId) {
    this.db.prepare(`
      UPDATE workers
      SET last_heartbeat = datetime('now')
      WHERE worker_id = ?
    `).run(workerId)
  }

  /**
   * Unregister a worker (graceful shutdown)
   */
  unregisterWorker(workerId) {
    const unregister = this.db.transaction(() => {
      // Release any jobs this worker had
      this.db.prepare(`
        UPDATE jobs
        SET status = 'pending',
            worker_id = NULL,
            started_at = NULL
        WHERE worker_id = ?
          AND status = 'processing'
      `).run(workerId)

      // Remove worker
      this.db.prepare('DELETE FROM workers WHERE worker_id = ?').run(workerId)
    })

    unregister()
  }

  /**
   * Get all workers and their status
   */
  getWorkers() {
    return this.db.prepare(`
      SELECT
        worker_id,
        agent_type,
        status,
        current_job_id,
        jobs_completed,
        jobs_failed,
        last_heartbeat,
        (julianday('now') - julianday(last_heartbeat)) * 24 * 60 as minutes_since_heartbeat
      FROM workers
      ORDER BY agent_type, worker_id
    `).all()
  }

  // =========================================================
  // STATISTICS
  // =========================================================

  /**
   * Get queue statistics
   */
  getStats() {
    const byType = this.db.prepare(`
      SELECT
        job_type,
        status,
        COUNT(*) as count
      FROM jobs
      GROUP BY job_type, status
      ORDER BY job_type, status
    `).all()

    const byPriority = this.db.prepare(`
      SELECT
        CASE
          WHEN priority >= 100 THEN 'michigan'
          WHEN priority >= 95 THEN 'major_us'
          WHEN priority >= 80 THEN 'other_us'
          WHEN priority >= 50 THEN 'international'
          ELSE 'rest'
        END as priority_group,
        status,
        COUNT(*) as count
      FROM jobs
      GROUP BY 1, status
      ORDER BY 1, status
    `).all()

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM jobs
    `).get()

    return { byType, byPriority, totals }
  }

  /**
   * Get progress percentage
   */
  getProgress(jobType = null) {
    const where = jobType ? 'WHERE job_type = ?' : ''
    const params = jobType ? [jobType] : []

    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM jobs
      ${where}
    `).get(...params)

    const processed = result.completed + result.failed
    const pct = result.total > 0 ? Math.round((processed / result.total) * 100) : 0

    return {
      total: result.total,
      completed: result.completed,
      failed: result.failed,
      pending: result.total - processed,
      percentage: pct
    }
  }

  /**
   * Save a stat value
   */
  setStat(key, value) {
    this.db.prepare(`
      INSERT INTO stats (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = ?,
        updated_at = datetime('now')
    `).run(key, JSON.stringify(value), JSON.stringify(value))
  }

  /**
   * Get a stat value
   */
  getStat(key) {
    const row = this.db.prepare('SELECT value FROM stats WHERE key = ?').get(key)
    return row ? JSON.parse(row.value) : null
  }
}

// Export singleton for convenience
let defaultQueue = null

export function getQueue(dbPath = DEFAULT_DB_PATH) {
  if (!defaultQueue) {
    defaultQueue = new JobQueue(dbPath)
    defaultQueue.init()
  }
  return defaultQueue
}

// CLI for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const queue = getQueue()

  if (args[0] === 'stats') {
    console.log('=== Queue Statistics ===')
    const stats = queue.getStats()
    console.log('\nBy Type:')
    console.table(stats.byType)
    console.log('\nBy Priority:')
    console.table(stats.byPriority)
    console.log('\nTotals:')
    console.table(stats.totals)
  } else if (args[0] === 'workers') {
    console.log('=== Workers ===')
    const workers = queue.getWorkers()
    console.table(workers)
  } else if (args[0] === 'recover') {
    const recovered = queue.recoverOrphaned()
    console.log(`Recovered ${recovered} orphaned jobs`)
  } else if (args[0] === 'progress') {
    const progress = queue.getProgress(args[1])
    console.log('=== Progress ===')
    console.log(`Total: ${progress.total}`)
    console.log(`Completed: ${progress.completed}`)
    console.log(`Failed: ${progress.failed}`)
    console.log(`Pending: ${progress.pending}`)
    console.log(`Progress: ${progress.percentage}%`)
  } else {
    console.log(`
Usage:
  node queue.mjs stats     - Show queue statistics
  node queue.mjs workers   - Show registered workers
  node queue.mjs recover   - Recover orphaned jobs
  node queue.mjs progress [job_type] - Show progress
    `)
  }

  queue.close()
}
