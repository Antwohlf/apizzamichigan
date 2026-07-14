#!/usr/bin/env node
/**
 * Keepalive for enrichment watchdog
 * Ensures the watchdog is always running to monitor worker health
 */

import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.env.APIZZA_REPO || '/srv/apizzamichigan'
const LOG_PATH = process.env.APIZZA_WATCHDOG_LOG || '/tmp/openclaw/apizzamichigan-watchdog.log'

function isWatchdogRunning() {
  try {
    const out = execSync("pgrep -fl 'scripts/enrichment/watchdog.mjs' || true", { encoding: 'utf8' }).trim()
    if (!out) return false
    return out.split('\n').some(line => line.includes('watchdog.mjs'))
  } catch {
    return false
  }
}

function startWatchdog() {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
  const logFd = fs.openSync(LOG_PATH, 'a')

  const child = spawn('node', ['scripts/enrichment/watchdog.mjs', '--kill-coordinator-if-stuck'], {
    cwd: REPO,
    env: process.env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  })

  child.unref()
  return child.pid
}

function main() {
  if (isWatchdogRunning()) {
    console.log('watchdog-keepalive: watchdog already running')
    return
  }

  const pid = startWatchdog()
  console.log(`watchdog-keepalive: started watchdog pid=${pid} log=${LOG_PATH}`)
}

main()
