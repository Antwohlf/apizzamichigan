#!/usr/bin/env node
/**
 * Coordinator Agent - Multi-Agent Pipeline Orchestrator
 *
 * Manages the enrichment pipeline with multiple worker agents.
 * Handles job dispatch, monitoring, crash recovery, and graceful shutdown.
 *
 * Can be run standalone. Production service management should use launchd.
 *
 * Usage:
 *   node scripts/enrichment/agents/coordinator.mjs
 *   node scripts/enrichment/agents/coordinator.mjs --status
 *   node scripts/enrichment/agents/coordinator.mjs --populate --type pizza
 */

import { fork } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { getQueue } from '../queue.mjs'
import { calculatePriority } from '../priority.mjs'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Worker script paths
const WORKERS = {
  osm_extract: join(__dirname, 'osm-extractor.mjs'),
  scrape: join(__dirname, 'web-scraper.mjs'),
  classify: join(__dirname, 'llm-classifier.mjs'),
  sync: join(__dirname, 'sync-agent.mjs')
}

// Worker concurrency limits
const WORKER_LIMITS = {
  // Start conservatively to avoid Overpass 429s; raise once stable.
  osm_extract: parseInt(process.env.OSM_EXTRACT_WORKERS || '1', 10),
  scrape: parseInt(process.env.SCRAPE_WORKERS || '3', 10),
  classify: parseInt(process.env.CLASSIFY_WORKERS || '2', 10),
  // Supabase sync is intentionally opt-in. Run manual dry-runs before enabling.
  sync: parseInt(process.env.SYNC_WORKERS || '0', 10)
}

// Configuration
const CONFIG = {
  heartbeatInterval: 30000,      // 30 seconds
  orphanTimeout: 10,             // 10 minutes
  statusCheckInterval: 60000,    // 1 minute
  maxJobsPerWorker: 100,         // Process 100 jobs then restart
  batchSize: 50                  // Jobs to dispatch at once
}

class Coordinator {
  constructor() {
    this.queue = getQueue()
    this.workers = new Map()  // workerId -> { process, type, jobsProcessed }
    this.running = false
    this.pgClient = null
  }

  /**
   * Initialize the coordinator
   */
  async init() {
    // Connect to PostgreSQL for agent state tracking
    this.pgClient = new pg.Client({
      host: 'localhost',
      database: 'pizza_enrichment',
      user: process.env.PGUSER || process.env.USER,
      password: process.env.PGPASSWORD || ''
    })

    try {
      await this.pgClient.connect()
      console.log('Connected to local PostgreSQL')
    } catch (error) {
      console.warn('PostgreSQL not available, using SQLite only')
      this.pgClient = null
    }

    // Register coordinator as a worker
    this.queue.registerWorker('coordinator', 'coordinator', CONFIG)

    // Recover any orphaned jobs from previous runs
    const recovered = this.queue.recoverOrphaned(CONFIG.orphanTimeout)
    if (recovered > 0) {
      console.log(`Recovered ${recovered} orphaned jobs`)
    }

    // Setup signal handlers
    this.setupSignalHandlers()
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupSignalHandlers() {
    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`)
      this.running = false

      // Stop all workers
      for (const [workerId, worker] of this.workers) {
        console.log(`Stopping worker ${workerId}...`)
        worker.process.kill('SIGTERM')
      }

      // Wait for workers to finish (max 30s)
      const timeout = setTimeout(() => {
        console.log('Timeout waiting for workers, forcing exit')
        process.exit(1)
      }, 30000)

      while (this.workers.size > 0) {
        await new Promise(r => setTimeout(r, 1000))
      }

      clearTimeout(timeout)

      // Unregister coordinator
      this.queue.unregisterWorker('coordinator')
      this.queue.close()

      if (this.pgClient) {
        await this.pgClient.end()
      }

      console.log('Shutdown complete')
      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  }

  /**
   * Spawn a worker process
   */
  spawnWorker(workerType, workerId) {
    const workerPath = WORKERS[workerType]
    if (!workerPath || !existsSync(workerPath)) {
      console.error(`Worker script not found: ${workerPath}`)
      return null
    }

    console.log(`Spawning ${workerType} worker: ${workerId}`)

    const child = fork(workerPath, ['--worker-id', workerId], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, WORKER_ID: workerId }
    })

    child.stdout.on('data', (data) => {
      process.stdout.write(`[${workerId}] ${data}`)
    })

    child.stderr.on('data', (data) => {
      process.stderr.write(`[${workerId}] ${data}`)
    })

    child.on('message', (msg) => {
      this.handleWorkerMessage(workerId, msg)
    })

    child.on('exit', (code, signal) => {
      console.log(`Worker ${workerId} exited (code=${code}, signal=${signal})`)
      this.workers.delete(workerId)
      this.queue.unregisterWorker(workerId)

      // Don't restart if worker type is paused
      const pauseStatus = this.queue.getPauseStatus()
      if (pauseStatus[workerType]) {
        console.log(`Not restarting ${workerType} worker (paused)`)
        return
      }

      // Restart worker if still running and exit wasn't clean
      if (this.running && code !== 0) {
        console.log(`Restarting ${workerType} worker...`)
        setTimeout(() => {
          if (this.running) {
            this.spawnWorker(workerType, workerId)
          }
        }, 5000)
      }
    })

    const worker = {
      process: child,
      type: workerType,
      jobsProcessed: 0,
      startedAt: new Date()
    }

    this.workers.set(workerId, worker)
    this.queue.registerWorker(workerId, workerType)

    return worker
  }

  /**
   * Handle message from worker
   */
  handleWorkerMessage(workerId, msg) {
    const worker = this.workers.get(workerId)
    if (!worker) return

    switch (msg.type) {
      case 'heartbeat':
        this.queue.heartbeat(workerId)
        break

      case 'job_complete':
        worker.jobsProcessed++
        this.queue.complete(msg.jobId, msg.output)

        // Restart worker if it's processed too many jobs (prevent memory leaks)
        if (worker.jobsProcessed >= CONFIG.maxJobsPerWorker) {
          console.log(`Worker ${workerId} reached max jobs, restarting...`)
          worker.process.send({ type: 'shutdown' })
        }
        break

      case 'job_failed':
        this.queue.fail(msg.jobId, msg.error)
        break

      case 'ready':
        console.log(`Worker ${workerId} ready`)
        break

      case 'stats':
        // Update PostgreSQL agent state
        this.updateAgentState(workerId, msg.stats)
        break
    }
  }

  /**
   * Update agent state in PostgreSQL
   */
  async updateAgentState(workerId, stats) {
    if (!this.pgClient) return

    try {
      await this.pgClient.query(`
        INSERT INTO agent_state (agent_id, workspace, status, jobs_completed, jobs_failed, last_heartbeat)
        VALUES ($1, 'enrichment', $2, $3, $4, NOW())
        ON CONFLICT (agent_id) DO UPDATE SET
          status = $2,
          jobs_completed = $3,
          jobs_failed = $4,
          last_heartbeat = NOW()
      `, [workerId, stats.status, stats.completed, stats.failed])
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Ensure we have the right number of workers for each type
   */
  ensureWorkers() {
    const pauseStatus = this.queue.getPauseStatus()

    for (const [type, limit] of Object.entries(WORKER_LIMITS)) {
      if (!Number.isFinite(limit) || limit <= 0) {
        continue
      }

      // Skip if this worker type is paused
      if (pauseStatus[type]) {
        // Kill existing workers of this type if paused
        for (const [workerId, worker] of this.workers) {
          if (worker.type === type) {
            console.log(`Stopping ${type} worker ${workerId} (paused)`)
            worker.process.kill()
          }
        }
        continue
      }

      // Count current workers of this type
      let currentCount = 0
      for (const [, worker] of this.workers) {
        if (worker.type === type) currentCount++
      }

      // Spawn more if needed
      while (currentCount < limit) {
        const workerId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        this.spawnWorker(type, workerId)
        currentCount++
      }
    }
  }

  /**
   * Print status report
   */
  printStatus() {
    console.log('\n' + '='.repeat(60))
    console.log('COORDINATOR STATUS')
    console.log('='.repeat(60))

    // Queue stats
    const stats = this.queue.getStats()
    console.log('\nQueue Status:')
    console.log(`  Total: ${stats.totals.total}`)
    console.log(`  Pending: ${stats.totals.pending}`)
    console.log(`  Processing: ${stats.totals.processing}`)
    console.log(`  Completed: ${stats.totals.completed}`)
    console.log(`  Failed: ${stats.totals.failed}`)

    // Progress
    const progress = this.queue.getProgress()
    console.log(`\nProgress: ${progress.percentage}%`)

    // Workers
    console.log('\nWorkers:')
    const workers = this.queue.getWorkers()
    for (const w of workers) {
      console.log(`  ${w.worker_id}: ${w.status} (${w.jobs_completed} done, ${w.jobs_failed} failed)`)
    }

    console.log('='.repeat(60) + '\n')
  }

  /**
   * Populate job queue from OSM cache
   */
  async populateFromCache(placeType = 'all') {
    const cachePath = join(__dirname, '../../.osm-id-cache.json')
    if (!existsSync(cachePath)) {
      console.error('OSM cache not found. Run build-osm-cache.mjs first.')
      return
    }

    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'))
    const types = placeType === 'all' ? ['pizza', 'taco'] : [placeType]

    for (const type of types) {
      const osmIds = cache[type] || []
      console.log(`Populating queue with ${osmIds.length} ${type} OSM IDs...`)

      // Get state info from database for priority calculation
      let stateMap = new Map()
      if (this.pgClient) {
        const table = type === 'pizza' ? 'pizza_places' : 'taco_places'
        const result = await this.pgClient.query(`
          SELECT google_place_id, state FROM ${table}
          WHERE google_place_id LIKE 'osm:%'
        `)
        for (const row of result.rows) {
          stateMap.set(row.google_place_id, row.state)
        }
      }

      // Add jobs in batches
      const jobs = osmIds.map(osmId => ({
        jobType: 'osm_extract',
        osmId,
        placeType: type,
        priority: calculatePriority(stateMap.get(osmId)),
        data: { state: stateMap.get(osmId) }
      }))

      const added = this.queue.addJobs(jobs)
      console.log(`  Added ${added} new jobs to queue`)
    }
  }

  /**
   * Main run loop
   */
  async run() {
    console.log('=== Coordinator Agent Starting ===')
    console.log(`Date: ${new Date().toISOString()}`)

    await this.init()
    this.running = true

    // Start workers
    this.ensureWorkers()

    // Status check loop
    const statusInterval = setInterval(() => {
      if (this.running) {
        this.printStatus()

        // Recover orphaned jobs periodically
        const recovered = this.queue.recoverOrphaned(CONFIG.orphanTimeout)
        if (recovered > 0) {
          console.log(`Recovered ${recovered} orphaned jobs`)
        }

        // Ensure we have workers running
        this.ensureWorkers()
      }
    }, CONFIG.statusCheckInterval)

    // Heartbeat loop
    const heartbeatInterval = setInterval(() => {
      if (this.running) {
        this.queue.heartbeat('coordinator')
      }
    }, CONFIG.heartbeatInterval)

    // Wait until shutdown
    while (this.running) {
      await new Promise(r => setTimeout(r, 1000))
    }

    clearInterval(statusInterval)
    clearInterval(heartbeatInterval)
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  return {
    status: args.includes('--status'),
    populate: args.includes('--populate'),
    type: args.includes('--type') ? args[args.indexOf('--type') + 1] : 'all',
    daemon: args.includes('--daemon'),
    help: args.includes('--help') || args.includes('-h')
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs()

  if (args.help) {
    console.log(`
Coordinator Agent - Multi-Agent Pipeline Orchestrator

Usage:
  node coordinator.mjs              Run the coordinator (foreground)
  node coordinator.mjs --daemon     Run as background daemon
  node coordinator.mjs --status     Show current status and exit
  node coordinator.mjs --populate   Populate job queue from OSM cache
  node coordinator.mjs --populate --type pizza  Populate only pizza jobs

Options:
  --status         Show queue and worker status
  --populate       Load jobs from OSM ID cache
  --type <type>    Place type: pizza, taco, or all (default: all)
  --daemon         Run as background process
  --help           Show this help message
    `)
    return
  }

  const coordinator = new Coordinator()

  if (args.status) {
    await coordinator.init()
    coordinator.printStatus()
    coordinator.queue.close()
    if (coordinator.pgClient) await coordinator.pgClient.end()
    return
  }

  if (args.populate) {
    await coordinator.init()
    await coordinator.populateFromCache(args.type)
    coordinator.queue.close()
    if (coordinator.pgClient) await coordinator.pgClient.end()
    return
  }

  // Run the coordinator
  await coordinator.run()
}

main().catch(console.error)
