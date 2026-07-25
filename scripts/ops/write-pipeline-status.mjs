#!/usr/bin/env node
/**
 * Run the read-only pipeline alert gate and publish its latest result locally.
 * The artifact is intentionally machine-local and is safe for the admin portal
 * to read without launching the expensive diagnostics on every page load.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = process.cwd()
const outputPath = process.env.PIPELINE_STATUS_PATH || join(root, 'scripts/.pipeline-alert-status.json')
const result = spawnSync(process.execPath, [join(root, 'scripts/ops/pipeline-alert-report.mjs'), '--json'], {
  cwd: root,
  encoding: 'utf8',
  timeout: Number.parseInt(process.env.PIPELINE_STATUS_TIMEOUT_MS || '120000', 10),
  env: process.env,
})

let report
try {
  report = JSON.parse(result.stdout || '')
} catch {
  report = {
    generatedAt: new Date().toISOString(),
    state: 'FAIL',
    alerts: ['Pipeline health report did not return valid JSON.'],
    warnings: [],
    actions: ['Run scripts/ops/pipeline-alert-report.mjs --json manually and inspect the error.'],
    error: String(result.stderr || result.error?.message || 'Unknown pipeline health report error').trim(),
  }
}

const payload = {
  ...report,
  checkedAt: new Date().toISOString(),
  writer: 'write-pipeline-status.mjs',
}

mkdirSync(dirname(outputPath), { recursive: true })
const temporaryPath = `${outputPath}.tmp-${process.pid}`
writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
renameSync(temporaryPath, outputPath)

console.log(`pipeline_status=${payload.state || 'FAIL'}`)
console.log(`pipeline_status_path=${outputPath}`)
if (result.status && result.status !== 0) process.exitCode = 0
