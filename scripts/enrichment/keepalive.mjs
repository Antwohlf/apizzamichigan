#!/usr/bin/env node
/**
 * Keepalive: ensure the enrichment coordinator is running.
 *
 * This is meant to be called periodically (e.g. via OpenClaw cron).
 * If no coordinator is detected, it starts one in the background.
 *
 * Defaults to slow/throttled OSM extraction (pizza-only) and disables scrape/classify
 * unless enabled via env.
 */

import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.env.APIZZA_REPO || '/Users/ant/clawd/projects/apizzamichigan'
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
    // safe defaults: keep Overpass slow
    OSM_EXTRACT_WORKERS: process.env.OSM_EXTRACT_WORKERS || '1',
    OSM_BATCH_SIZE: process.env.OSM_BATCH_SIZE || '10',
    OSM_BATCH_DELAY_MS: process.env.OSM_BATCH_DELAY_MS || '15000',
    // run the full local pipeline by default (OSM -> scrape -> classify)
    SCRAPE_WORKERS: process.env.SCRAPE_WORKERS || '1',
    CLASSIFY_WORKERS: process.env.CLASSIFY_WORKERS || '1',
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
