#!/usr/bin/env node
/**
 * Supabase Sync Agent (local-only)
 *
 * Coordinator expects an "agent-style" long-running worker.
 * This agent:
 * - Registers/heartbeats with the SQLite queue
 * - Runs the existing daily sync worker in a controlled loop
 * - Never exits non-zero just because SUPABASE creds are missing (it will idle)
 *
 * Env:
 * - SUPABASE_SERVICE_ROLE_KEY: required to actually sync
 * - SYNC_INTERVAL_MS: how often to attempt a sync run (default 6h)
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'
import { getQueue } from '../queue.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const SYNC_WORKER = join(repoRoot, 'scripts', 'enrichment', 'workers', 'daily-sync.mjs')

const SYNC_INTERVAL_MS = process.env.SYNC_INTERVAL_MS ? parseInt(process.env.SYNC_INTERVAL_MS, 10) : 6 * 60 * 60 * 1000 // 6h

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function runDailySyncOnce() {
  return new Promise((resolve) => {
    // If missing credentials, just skip (do not fail the agent)
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      resolve({ ok: false, skipped: true, reason: 'SUPABASE_SERVICE_ROLE_KEY missing' })
      return
    }

    const args = ['--all', '--limit', '2000']
    const child = spawn(process.execPath, [SYNC_WORKER, ...args], {
      stdio: 'inherit',
      env: process.env,
      cwd: repoRoot
    })

    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, code })
    })

    child.on('error', (err) => {
      resolve({ ok: false, error: err.message })
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const workerIdIdx = args.indexOf('--worker-id')
  const workerId = workerIdIdx >= 0 ? args[workerIdIdx + 1] : `sync-${Date.now()}`

  const queue = getQueue()
  queue.registerWorker(workerId, 'sync')

  let running = true
  process.on('message', (msg) => {
    if (msg?.type === 'shutdown') running = false
  })

  console.log(`[${workerId}] Sync Agent started (interval=${Math.round(SYNC_INTERVAL_MS / 60000)}m)`)
  if (process.send) process.send({ type: 'ready' })

  // Heartbeat loop
  const hb = setInterval(() => {
    try {
      queue.heartbeat(workerId)
      if (process.send) process.send({ type: 'heartbeat' })
    } catch {}
  }, 30000)

  let lastRunAt = 0
  while (running) {
    const now = Date.now()

    if (!lastRunAt || now - lastRunAt >= SYNC_INTERVAL_MS) {
      lastRunAt = now
      const res = await runDailySyncOnce()
      if (res.skipped) {
        console.log(`[${workerId}] Sync skipped: ${res.reason}`)
      } else if (!res.ok) {
        console.error(`[${workerId}] Sync run failed (will retry later): ${JSON.stringify(res)}`)
      } else {
        console.log(`[${workerId}] Sync run completed`)
      }
    }

    await sleep(10000)
  }

  clearInterval(hb)
  queue.unregisterWorker(workerId)
  queue.close()
  console.log(`[${workerId}] Sync Agent stopped`)
}

main().catch((err) => {
  console.error('sync-agent fatal:', err)
  // Don't bring down the coordinator with restart loops; exit 0 so it doesn't thrash.
  process.exit(0)
})
