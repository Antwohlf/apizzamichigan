#!/usr/bin/env node
/**
 * Keepalive: ensure the enrichment coordinator is running.
 *
 * Legacy compatibility script. Production service management should use launchd.
 * If no coordinator is detected, it starts one in the background.
 *
 * Defaults to classifier-only operation. OSM extraction, scraping, and sync are
 * opt-in so stale OpenClaw schedules cannot accidentally restart the full
 * production pipeline.
 */

import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.env.APIZZA_REPO || '/srv/apizzamichigan'
const LOG_PATH = process.env.APIZZA_COORD_LOG || '/tmp/openclaw/apizzamichigan-coordinator.log'

function isCoordinatorRunning() {
  try {
    const out = execSync("pgrep -fl 'scripts/enrichment/agents/coordinator.mjs' || true", { encoding: 'utf8' }).trim()
    if (!out) return false
    // filter out our own process if any weirdness
    return out.split('\n').some(line => line.includes('coordinator.mjs'))
  } catch {
    return false
  }
}

function startCoordinator() {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
  const logFd = fs.openSync(LOG_PATH, 'a')

  const env = {
    ...process.env,
    // safe defaults: do not make external website/OSM/Supabase calls unless enabled
    OSM_EXTRACT_WORKERS: process.env.OSM_EXTRACT_WORKERS || '0',
    OSM_BATCH_SIZE: process.env.OSM_BATCH_SIZE || '10',
    OSM_BATCH_DELAY_MS: process.env.OSM_BATCH_DELAY_MS || '15000',
    SCRAPE_WORKERS: process.env.SCRAPE_WORKERS || '0',
    CLASSIFY_WORKERS: process.env.CLASSIFY_WORKERS || '1',
    SYNC_WORKERS: process.env.SYNC_WORKERS || '0',
  }

  const child = spawn('node', ['scripts/enrichment/agents/coordinator.mjs'], {
    cwd: REPO,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  })

  child.unref()
  return child.pid
}

function main() {
  if (isCoordinatorRunning()) {
    console.log('keepalive: coordinator already running')
    return
  }

  const pid = startCoordinator()
  console.log(`keepalive: started coordinator pid=${pid} log=${LOG_PATH}`)
}

main()
