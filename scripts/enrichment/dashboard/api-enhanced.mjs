/**
 * Enhanced API endpoint for enrichment dashboard
 * Provides comprehensive metrics for monitoring pipeline health
 */

import Database from 'better-sqlite3'
import pg from 'pg'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const QUEUE_DB_PATH = join(__dirname, '../../.job-queue.db')
const SNAPSHOT_PATH = join(__dirname, '../../../.status_hourly.json')
const METRICS_CACHE_PATH = join(__dirname, '../../../.dashboard_metrics.json')

// Cache metrics for 10 seconds to avoid excessive computation
let metricsCache = null
let metricsCacheTime = 0
const CACHE_TTL_MS = 10000

export async function getEnhancedStatus() {
  const now = Date.now()
  
  // Return cached metrics if still fresh
  if (metricsCache && (now - metricsCacheTime) < CACHE_TTL_MS) {
    return { ...metricsCache, cached: true, cacheAge: now - metricsCacheTime }
  }

  const db = new Database(QUEUE_DB_PATH, { readonly: true })
  
  // === QUEUE STATS ===
  const queueStats = db.prepare(`
    SELECT job_type, status, COUNT(*) as count
    FROM jobs
    GROUP BY job_type, status
    ORDER BY job_type, status
  `).all()

  // === WORKER STATUS ===
  const workers = db.prepare(`
    SELECT 
      worker_id,
      agent_type,
      status,
      current_job_id,
      jobs_completed,
      jobs_failed,
      last_heartbeat,
      started_at,
      ROUND((julianday('now') - julianday(last_heartbeat)) * 1440, 1) as minutes_since_heartbeat,
      ROUND((julianday('now') - julianday(started_at)) * 1440, 1) as uptime_minutes
    FROM workers
    WHERE agent_type IN ('osm_extract', 'scrape', 'classify')
    ORDER BY agent_type, worker_id
  `).all()

  // === RECENT ACTIVITY (last 20 completions + failures) ===
  const recentCompletions = db.prepare(`
    SELECT 
      id,
      job_type,
      osm_id,
      status,
      worker_id,
      completed_at,
      data
    FROM jobs
    WHERE status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 20
  `).all()

  const recentFailures = db.prepare(`
    SELECT 
      id,
      job_type,
      osm_id,
      status,
      worker_id,
      last_error,
      completed_at,
      attempts,
      max_attempts
    FROM jobs
    WHERE status = 'failed'
    ORDER BY completed_at DESC
    LIMIT 20
  `).all()

  // === ERROR ANALYSIS ===
  const errorBreakdown = db.prepare(`
    SELECT 
      last_error,
      COUNT(*) as count
    FROM jobs
    WHERE status = 'failed'
    GROUP BY last_error
    ORDER BY count DESC
    LIMIT 10
  `).all()

  const nearMaxAttempts = db.prepare(`
    SELECT 
      id,
      job_type,
      osm_id,
      attempts,
      max_attempts,
      last_error
    FROM jobs
    WHERE status = 'pending'
      AND attempts >= (max_attempts - 1)
    LIMIT 50
  `).all()

  // === PROCESSING RATE (completions in last hour) ===
  const lastHourCompletions = db.prepare(`
    SELECT 
      job_type,
      COUNT(*) as count
    FROM jobs
    WHERE status = 'completed'
      AND completed_at > datetime('now', '-1 hour')
    GROUP BY job_type
  `).all()

  // === TIME-SERIES DATA (last 24h, grouped by hour) ===
  const timeSeries = db.prepare(`
    SELECT 
      strftime('%Y-%m-%d %H:00:00', completed_at) as hour,
      job_type,
      status,
      COUNT(*) as count
    FROM jobs
    WHERE completed_at > datetime('now', '-24 hours')
    GROUP BY hour, job_type, status
    ORDER BY hour DESC
  `).all()

  db.close()

  // === POSTGRES STATS ===
  const pgClient = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await pgClient.connect()

  // Overall stats
  const overallStats = await pgClient.query(`
    SELECT
      COUNT(*) as total_places,
      COUNT(*) FILTER (WHERE osm_tags IS NOT NULL) as osm_tags_populated,
      COUNT(*) FILTER (WHERE scrape_method='fetch') as scraped,
      COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL) as classified,
      COUNT(*) FILTER (WHERE style IS NOT NULL) as with_style,
      COUNT(*) FILTER (WHERE price_range IS NOT NULL) as with_price_range
    FROM pizza_places
  `)

  // Michigan stats
  const michiganStats = await pgClient.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE osm_tags IS NOT NULL) as osm_tags_populated,
      COUNT(*) FILTER (WHERE scrape_method='fetch') as scraped,
      COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL) as classified
    FROM pizza_places
    WHERE state = 'MI'
  `)

  // Geographic coverage
  const geoCoverage = await pgClient.query(`
    SELECT
      state,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE osm_tags IS NOT NULL) as osm_enriched,
      COUNT(*) FILTER (WHERE scrape_method='fetch') as scraped,
      COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL) as classified,
      ROUND(100.0 * COUNT(*) FILTER (WHERE osm_tags IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as pct_osm,
      ROUND(100.0 * COUNT(*) FILTER (WHERE scrape_method='fetch') / NULLIF(COUNT(*), 0), 1) as pct_scraped,
      ROUND(100.0 * COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as pct_classified
    FROM pizza_places
    WHERE state IS NOT NULL
    GROUP BY state
    ORDER BY total DESC
    LIMIT 20
  `)

  // Style distribution
  const styleDistribution = await pgClient.query(`
    SELECT
      style,
      COUNT(*) as count
    FROM pizza_places
    WHERE style IS NOT NULL
    GROUP BY style
    ORDER BY count DESC
    LIMIT 15
  `)

  // Handoff success rates
  const handoffStats = await pgClient.query(`
    SELECT
      COUNT(*) as total_with_osm,
      COUNT(*) FILTER (WHERE website_url IS NOT NULL) as with_website,
      COUNT(*) FILTER (WHERE scrape_method='fetch') as scraped,
      COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL) as classified,
      ROUND(100.0 * COUNT(*) FILTER (WHERE scrape_method='fetch') / NULLIF(COUNT(*) FILTER (WHERE website_url IS NOT NULL), 0), 1) as scrape_conversion,
      ROUND(100.0 * COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE scrape_method='fetch'), 0), 1) as classify_conversion
    FROM pizza_places
  `)

  await pgClient.end()

  // === SYSTEM HEALTH ===
  let systemHealth = null
  try {
    const top = execSync('top -l 1 | head -10', { encoding: 'utf-8' })
    const loadLine = top.split('\n').find(l => l.includes('Load Avg'))
    const cpuLine = top.split('\n').find(l => l.includes('CPU usage'))
    const memLine = top.split('\n').find(l => l.includes('PhysMem'))

    const loadMatch = loadLine?.match(/Load Avg: ([\d.]+), ([\d.]+), ([\d.]+)/)
    const idleMatch = cpuLine?.match(/([\d.]+)% idle/)
    const memMatch = memLine?.match(/([\d.]+)([GM]) used.*?([\d.]+)([GM]) unused/)

    let memUsedGB = 0
    let memUnusedGB = 0
    if (memMatch) {
      memUsedGB = parseFloat(memMatch[1]) * (memMatch[2] === 'G' ? 1 : 0.001)
      memUnusedGB = parseFloat(memMatch[3]) * (memMatch[4] === 'G' ? 1 : 0.001)
    }

    systemHealth = {
      load: {
        '1min': loadMatch ? parseFloat(loadMatch[1]) : 0,
        '5min': loadMatch ? parseFloat(loadMatch[2]) : 0,
        '15min': loadMatch ? parseFloat(loadMatch[3]) : 0
      },
      cpu: {
        idle: idleMatch ? parseFloat(idleMatch[1]) : 100,
        pressure: idleMatch ? parseFloat(idleMatch[1]) < 10 : false
      },
      memory: {
        usedGB: memUsedGB,
        unusedGB: memUnusedGB,
        totalGB: memUsedGB + memUnusedGB,
        usedPct: memUsedGB + memUnusedGB > 0 ? (memUsedGB / (memUsedGB + memUnusedGB)) * 100 : 0,
        pressure: (memUsedGB / (memUsedGB + memUnusedGB)) * 100 > 90
      }
    }

    // Disk space for logs
    try {
      const logDir = '/tmp/openclaw'
      const stat = statSync(logDir)
      systemHealth.logDirSizeMB = stat.size / 1024 / 1024
    } catch {}
  } catch (err) {
    systemHealth = { error: err.message }
  }

  // === COMPUTE TOTALS & PROGRESS ===
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

  // === PROCESSING RATE & ETA ===
  const processingRates = {}
  for (const jobType of ['osm_extract', 'scrape', 'classify']) {
    const hourly = lastHourCompletions.find(c => c.job_type === jobType)?.count || 0
    const pending = totals[jobType].pending
    const etaHours = hourly > 0 ? pending / hourly : null
    
    processingRates[jobType] = {
      perHour: hourly,
      perMinute: Math.round((hourly / 60) * 10) / 10,
      etaHours: etaHours ? Math.round(etaHours * 10) / 10 : null,
      etaFormatted: etaHours ? formatETA(etaHours) : 'N/A'
    }
  }

  // Active workers
  const activeWorkers = workers.filter(w => w.minutes_since_heartbeat < 5)
  const staleWorkers = workers.filter(w => w.minutes_since_heartbeat >= 5)

  // Load previous snapshot
  let previousSnapshot = null
  if (existsSync(SNAPSHOT_PATH)) {
    try {
      previousSnapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    } catch {}
  }

  // Build response
  const metrics = {
    timestamp: new Date().toISOString(),
    
    queue: {
      stats: queueStats,
      totals,
      progress
    },

    workers: {
      all: workers,
      active: activeWorkers,
      stale: staleWorkers,
      byType: {
        osm_extract: activeWorkers.filter(w => w.agent_type === 'osm_extract').length,
        scrape: activeWorkers.filter(w => w.agent_type === 'scrape').length,
        classify: activeWorkers.filter(w => w.agent_type === 'classify').length
      }
    },

    performance: {
      rates: processingRates,
      recentCompletions: recentCompletions.map(formatRecentActivity),
      recentFailures: recentFailures.map(formatRecentFailure)
    },

    postgres: {
      overall: overallStats.rows[0],
      michigan: michiganStats.rows[0],
      geography: geoCoverage.rows,
      styles: styleDistribution.rows,
      handoff: handoffStats.rows[0]
    },

    errors: {
      breakdown: errorBreakdown,
      nearMaxAttempts: nearMaxAttempts.length,
      topErrors: errorBreakdown.slice(0, 5)
    },

    timeSeries: groupTimeSeries(timeSeries),

    systemHealth,

    previousSnapshot,

    cached: false
  }

  // Cache metrics
  metricsCache = metrics
  metricsCacheTime = now

  return metrics
}

// === HELPER FUNCTIONS ===

function formatETA(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`
  } else if (hours < 24) {
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return `${h}h ${m}m`
  } else {
    const d = Math.floor(hours / 24)
    const h = Math.round(hours % 24)
    return `${d}d ${h}h`
  }
}

function formatRecentActivity(job) {
  let description = job.osm_id
  try {
    const data = JSON.parse(job.data)
    if (data.state) description = `${job.osm_id} (${data.state})`
  } catch {}

  return {
    id: job.id,
    type: job.job_type,
    description,
    completedAt: job.completed_at,
    workerId: job.worker_id
  }
}

function formatRecentFailure(job) {
  let description = job.osm_id
  try {
    const data = JSON.parse(job.data)
    if (data.state) description = `${job.osm_id} (${data.state})`
  } catch {}

  return {
    id: job.id,
    type: job.job_type,
    description,
    error: job.last_error,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    completedAt: job.completed_at
  }
}

function groupTimeSeries(data) {
  const grouped = {}
  
  for (const row of data) {
    if (!grouped[row.hour]) {
      grouped[row.hour] = {}
    }
    if (!grouped[row.hour][row.job_type]) {
      grouped[row.hour][row.job_type] = {}
    }
    grouped[row.hour][row.job_type][row.status] = row.count
  }

  return grouped
}
