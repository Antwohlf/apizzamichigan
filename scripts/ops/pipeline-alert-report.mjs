#!/usr/bin/env node
/**
 * Read-only operational alert gate for the local enrichment pipeline.
 *
 * Exit 0 for OK/WARN and exit 1 only for actionable failures. The JSON output
 * is suitable for cron, launchd, or a lightweight external monitor.
 */

import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const dbPath = process.env.QUEUE_DB_PATH || join(root, 'scripts/.job-queue.db')
const json = process.argv.includes('--json')
const unknownFailureLimit = positiveInt(process.env.PIPELINE_UNKNOWN_SCRAPE_FAILURE_LIMIT, 1000)
const scrapeAheadMinimum = positiveInt(process.env.PIPELINE_SCRAPE_AHEAD_MINIMUM, 0)
const duplicateWarningLimit = positiveInt(process.env.PIPELINE_DUPLICATE_WARNING_LIMIT, 0)
const staleSourceWarningLimit = positiveInt(process.env.PIPELINE_STALE_SOURCE_WARNING_LIMIT, 1000)
const scrapeExhaustedWarningLimit = positiveInt(process.env.PIPELINE_SCRAPE_EXHAUSTED_WARNING_LIMIT, 500)
const canonicalDuplicateRateLimit = Math.max(0, Number.parseFloat(process.env.PIPELINE_CANONICAL_DUPLICATE_RATE_LIMIT || '1'))
const sourcePipelineStaleMinutes = positiveInt(process.env.PIPELINE_SOURCE_STALE_MINUTES, 180)

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function child(script) {
  try {
    return JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/ops', script), '--json'], { encoding: 'utf8', timeout: 30000 }))
  } catch (error) {
    return { state: 'FAIL', error: String(error.stderr || error.message || error).trim() }
  }
}

function sourcePipelineReport() {
  const statePath = join(root, 'scripts/.source-pipeline-state.json')
  if (!existsSync(statePath)) return { ok: false, error: `source pipeline state missing: ${statePath}` }
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const lastRunMs = Date.parse(state.last_run || '')
    const ageMinutes = Number.isFinite(lastRunMs)
      ? Math.max(0, Number(((Date.now() - lastRunMs) / 60000).toFixed(1)))
      : null
    const sourceErrors = Object.entries(state.sources || {})
      .filter(([, value]) => value?.last_error)
      .map(([source, value]) => ({ source, last_attempt: value.last_attempt || null, error: value.last_error }))
    return { ok: true, lastRun: state.last_run || null, ageMinutes, sourceErrors }
  } catch (error) {
    return { ok: false, error: `source pipeline state unreadable: ${error.message}` }
  }
}

function main() {
  const alerts = []
  const warnings = []
  const classifier = child('classifier-health-report.mjs')
  const scrapeFailures = child('scrape-failure-report.mjs')
  const identity = child('identity-quality-report.mjs')
  const freshness = child('source-freshness-report.mjs')
  const sourceQuality = child('source-quality-report.mjs')
  const sourcePipeline = sourcePipelineReport()
  let queue = null

  if (!existsSync(dbPath)) alerts.push(`queue DB missing: ${dbPath}`)
  else {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      queue = Object.fromEntries(db.prepare(`
        SELECT job_type || ':' || status AS key, COUNT(*) AS count
        FROM jobs GROUP BY job_type, status
      `).all().map(row => [row.key, Number(row.count)]))
    } catch (error) {
      alerts.push(`queue read failed: ${error.message}`)
    } finally {
      db.close()
    }
  }

  if (classifier.health?.state === 'FAIL' || classifier.state === 'FAIL') alerts.push(...(classifier.health?.issues || [classifier.error || 'classifier health failed']))
  else if (classifier.health?.warnings?.length) {
    for (const warning of classifier.health.warnings) {
      // The reverse tunnel is owned by the laptop. On the iMac, a healthy
      // forwarded endpoint is authoritative; the local launchd lookup is not.
      if (warning.startsWith('laptop Ollama tunnel launchd service is not visible here') && classifier.tunnel?.ok) continue
      warnings.push(warning)
    }
  }

  const malformedOsm = identity.malformedOsmIds?.length || 0
  const sourceCollisions = identity.sourceIdentityCollisions?.length || 0
  const missingPrimaryEvidence = Number(identity.missingPrimaryEvidence?.rows || 0)
  const duplicateGroups = identity.duplicateExternalIds?.length || 0
  if (malformedOsm) alerts.push(`malformed OSM identity values: ${malformedOsm}`)
  if (sourceCollisions) alerts.push(`source identity collisions: ${sourceCollisions}`)
  if (missingPrimaryEvidence) alerts.push(`OSM rows missing primary evidence: ${missingPrimaryEvidence}`)
  if (duplicateGroups > duplicateWarningLimit) warnings.push(`duplicate external-id groups: ${duplicateGroups}`)
  for (const source of freshness.sources || []) {
    if (source.stale_rows > staleSourceWarningLimit) {
      warnings.push(`stale ${source.source} evidence rows: ${source.stale_rows} > ${staleSourceWarningLimit}`)
    }
  }
  const acceptedDuplicateCoordinates = Number(sourceQuality.accepted_duplicate_coordinates?.pairs || 0)
  if (acceptedDuplicateCoordinates > 0) {
    warnings.push(`accepted source-review rows blocked by same-source coordinates: ${acceptedDuplicateCoordinates} pair(s)`)
  }
  const duplicateRate = Number(sourceQuality.canonical?.affected_row_rate_percent || 0)
  if (duplicateRate > canonicalDuplicateRateLimit) {
    alerts.push(`canonical likely-duplicate rate exceeds limit: ${duplicateRate}% > ${canonicalDuplicateRateLimit}%`)
  }
  if (!sourcePipeline.ok) alerts.push(sourcePipeline.error)
  else {
    if (sourcePipeline.ageMinutes == null || sourcePipeline.ageMinutes > sourcePipelineStaleMinutes) {
      alerts.push(`source pipeline has not completed a run within ${sourcePipelineStaleMinutes} minutes`)
    }
    for (const failure of sourcePipeline.sourceErrors) {
      warnings.push(`source pipeline ${failure.source} last failed: ${failure.error.split('\n')[0]}`)
    }
  }

  const unknown = scrapeFailures.summary?.unknown ?? null
  if (unknown != null && unknown > unknownFailureLimit) alerts.push(`unknown scrape failures exceed limit: ${unknown} > ${unknownFailureLimit}`)
  const exhausted = scrapeFailures.summary?.transientAtMaxAttempts ?? null
  if (exhausted != null && exhausted > scrapeExhaustedWarningLimit) {
    warnings.push(`transient scrape jobs exhausted retry attempts: ${exhausted} > ${scrapeExhaustedWarningLimit}`)
  }
  if (queue) {
    const pendingScrape = queue['scrape:pending'] || 0
    const pendingClassify = queue['classify:pending'] || 0
    if (pendingScrape < scrapeAheadMinimum) warnings.push(`scrape backlog below configured floor: ${pendingScrape} < ${scrapeAheadMinimum}`)
    // Scraping should stay ahead of classification so classifiers do not sit
    // idle waiting for website evidence. A smaller scrape backlog is the risk.
    if (pendingScrape < pendingClassify) warnings.push(`scrape backlog is behind classifier demand: scrape=${pendingScrape}, classify=${pendingClassify}`)
    if ((queue['classify:processing'] || 0) > 0 && classifier.queue?.staleProcessingJobs?.length) alerts.push(`stale classifier processing jobs: ${classifier.queue.staleProcessingJobs.length}`)
  }

  const state = alerts.length ? 'FAIL' : warnings.length ? 'WARN' : 'OK'
  const report = {
    generatedAt: new Date().toISOString(),
    state,
    alerts,
    warnings,
    thresholds: { unknownFailureLimit, scrapeAheadMinimum, duplicateWarningLimit, staleSourceWarningLimit, scrapeExhaustedWarningLimit, canonicalDuplicateRateLimit, sourcePipelineStaleMinutes },
    queue,
    classifier: { state: classifier.health?.state || classifier.state || 'FAIL', recent: classifier.queue?.recent || null },
    scrapeFailures: scrapeFailures.summary || null,
    identity: {
      canonical: identity.canonical || null,
      duplicateExternalIds: duplicateGroups,
      malformedOsmIds: malformedOsm,
      missingPrimaryEvidence,
      sourceIdentityCollisions: sourceCollisions
    },
    freshness: freshness.sources || null
    ,sourceQuality: sourceQuality.accepted_duplicate_coordinates || null
    ,sourcePipeline
  }
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`# Pipeline alerts: ${state}`)
    console.log(`alerts=${alerts.length}`)
    console.log(`warnings=${warnings.length}`)
    for (const item of alerts) console.log(`ALERT: ${item}`)
    for (const item of warnings) console.log(`WARN: ${item}`)
  }
  if (state === 'FAIL') process.exitCode = 1
}

main()
