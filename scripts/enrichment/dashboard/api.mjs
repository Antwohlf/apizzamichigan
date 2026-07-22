/**
 * API endpoint for enrichment dashboard
 * Queries SQLite queue + Postgres to return current status
 */

import Database from 'better-sqlite3'
import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const QUEUE_DB_PATH = join(__dirname, '../../.job-queue.db')
const SNAPSHOT_PATH = join(__dirname, '../../../.status_hourly.json')

export async function getStatus() {
  const db = new Database(QUEUE_DB_PATH, { readonly: true })

  // Queue stats by type
  const queueStats = db.prepare(`
    SELECT job_type, status, COUNT(*) as count
    FROM jobs
    GROUP BY job_type, status
    ORDER BY job_type, status
  `).all()

  // Worker status
  const workers = db.prepare(`
    SELECT
      worker_id,
      agent_type,
      status,
      current_job_id,
      jobs_completed,
      jobs_failed,
      last_heartbeat,
      ROUND((julianday('now') - julianday(last_heartbeat)) * 1440, 1) as minutes_since_heartbeat
    FROM workers
    WHERE agent_type IN ('osm_extract', 'scrape', 'classify')
    ORDER BY agent_type, worker_id
  `).all()

  db.close()

  // Postgres stats
  const pgClient = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await pgClient.connect()

  const pgStats = await pgClient.query(`
    SELECT
      COUNT(*) FILTER (WHERE state='MI') as mi_total,
      COUNT(*) FILTER (WHERE state='MI' AND scrape_method IN ('fetch', 'browser')) as mi_scraped,
      COUNT(*) FILTER (WHERE state='MI' AND (style IS NOT NULL OR price_range IS NOT NULL)) as mi_classified,
      COUNT(*) FILTER (WHERE osm_tags IS NOT NULL) as osm_tags_total,
      COUNT(*) FILTER (WHERE scrape_method IN ('fetch', 'browser')) as scraped_total,
      COUNT(*) FILTER (WHERE style IS NOT NULL) as style_total,
      COUNT(*) FILTER (WHERE price_range IS NOT NULL) as price_range_total
    FROM pizza_places
  `)

  await pgClient.end()

  // Load previous snapshot for deltas
  let previousSnapshot = null
  if (existsSync(SNAPSHOT_PATH)) {
    try {
      previousSnapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    } catch {}
  }

  // Compute totals and progress
  const totals = {}
  const progress = {}

  for (const jobType of ['osm_extract', 'scrape', 'classify']) {
    const pending = queueStats.find(s => s.job_type === jobType && s.status === 'pending')?.count || 0
    const processing = queueStats.find(s => s.job_type === jobType && s.status === 'processing')?.count || 0
    const completed = queueStats.find(s => s.job_type === jobType && s.status === 'completed')?.count || 0
    const failed = queueStats.find(s => s.job_type === jobType && s.status === 'failed')?.count || 0
    const total = pending + processing + completed + failed

    totals[jobType] = { pending, processing, completed, failed, total }
    progress[jobType] = total > 0 ? Math.round((completed / total) * 100) : 0
  }

  const activeWorkers = workers.filter(w => w.minutes_since_heartbeat < 5)

  return {
    timestamp: new Date().toISOString(),
    queue: {
      stats: queueStats,
      totals,
      progress
    },
    workers: {
      all: workers,
      active: activeWorkers.length,
      byType: {
        osm_extract: activeWorkers.filter(w => w.agent_type === 'osm_extract').length,
        scrape: activeWorkers.filter(w => w.agent_type === 'scrape').length,
        classify: activeWorkers.filter(w => w.agent_type === 'classify').length
      }
    },
    postgres: pgStats.rows[0],
    previousSnapshot
  }
}
