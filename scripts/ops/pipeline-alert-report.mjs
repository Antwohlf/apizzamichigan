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
const staleSourceRatioWarningPercent = positiveInt(process.env.PIPELINE_STALE_SOURCE_RATIO_WARNING_PERCENT, 95)
const scrapeExhaustedWarningLimit = positiveInt(process.env.PIPELINE_SCRAPE_EXHAUSTED_WARNING_LIMIT, 500)
const scrapeBlockedWarningLimit = positiveInt(process.env.PIPELINE_SCRAPE_BLOCKED_WARNING_LIMIT, 100)
const scrapeDeadLinkWarningLimit = positiveInt(process.env.PIPELINE_SCRAPE_DEAD_LINK_WARNING_LIMIT, 100)
const scrapeUnknownWarningLimit = positiveInt(process.env.PIPELINE_SCRAPE_UNKNOWN_WARNING_LIMIT, 100)
const canonicalDuplicateRateLimit = Math.max(0, Number.parseFloat(process.env.PIPELINE_CANONICAL_DUPLICATE_RATE_LIMIT || '1'))
const sourcePipelineStaleMinutes = positiveInt(process.env.PIPELINE_SOURCE_STALE_MINUTES, 180)
const reviewBacklogWarningLimit = positiveInt(process.env.PIPELINE_REVIEW_BACKLOG_WARNING_LIMIT, 5000)
const staleProcessingMinutes = positiveInt(process.env.PIPELINE_STALE_PROCESSING_MINUTES, 120)

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
    const reportPath = join(root, 'scripts/.source-pipeline-last-report.json')
    const rawLastReport = existsSync(reportPath)
      ? JSON.parse(readFileSync(reportPath, 'utf8'))
      : null
    const lastReport = rawLastReport?.mode === 'apply' ? rawLastReport : null
    const lastRunMs = Date.parse(state.last_run || '')
    const ageMinutes = Number.isFinite(lastRunMs)
      ? Math.max(0, Number(((Date.now() - lastRunMs) / 60000).toFixed(1)))
      : null
    const stateErrors = Object.entries(state.sources || {})
      .filter(([, value]) => value?.last_error)
      .map(([source, value]) => ({ source, last_attempt: value.last_attempt || null, error: value.last_error }))
    const reportErrors = (lastReport?.errors || [])
      .filter(error => error?.source && error?.message)
      .map(error => ({
        source: error.source,
        last_attempt: lastReport.finished_at || lastReport.started_at || null,
        error: error.message,
        run_report: true,
      }))
    const sourceErrors = [...stateErrors, ...reportErrors]
      .filter((error, index, errors) => errors.findIndex(candidate =>
        candidate.source === error.source && candidate.error === error.error
      ) === index)
    return {
      ok: true,
      lastRun: state.last_run || lastReport?.finished_at || null,
      ageMinutes,
      sourceErrors,
      lastReport: lastReport
        ? {
          startedAt: lastReport.started_at || null,
          finishedAt: lastReport.finished_at || null,
          mode: lastReport.mode || null,
          workUnits: lastReport.work_units?.length || 0,
          errors: reportErrors.length,
        }
        : null,
    }
  } catch (error) {
    return { ok: false, error: `source pipeline state unreadable: ${error.message}` }
  }
}

function main() {
  const alerts = []
  const warnings = []
  const actions = []
  const classifier = child('classifier-health-report.mjs')
  const scrapeFailures = child('scrape-failure-report.mjs')
  const identity = child('identity-quality-report.mjs')
  const freshness = child('source-freshness-report.mjs')
  const sourceQuality = child('source-quality-report.mjs')
  const sourcePipeline = sourcePipelineReport()
  let queue = null
  let staleProcessingJobs = []

  if (!existsSync(dbPath)) alerts.push(`queue DB missing: ${dbPath}`)
  else {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      queue = Object.fromEntries(db.prepare(`
        SELECT job_type || ':' || status AS key, COUNT(*) AS count
        FROM jobs GROUP BY job_type, status
      `).all().map(row => [row.key, Number(row.count)]))
      staleProcessingJobs = db.prepare(`
        SELECT id, job_type, osm_id, worker_id, started_at,
          ROUND((julianday('now') - julianday(started_at)) * 1440, 1) AS minutes_processing
        FROM jobs
        WHERE status = 'processing'
          AND started_at IS NOT NULL
          AND started_at < datetime('now', ?)
        ORDER BY started_at
      `).all(`-${staleProcessingMinutes} minutes`)
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
    const hasEvidence = Number(source.evidence_rows || 0) > 0
    const staleRatio = Number(source.fresh_ratio_percent == null
      ? (hasEvidence ? (Number(source.stale_rows || 0) / Number(source.evidence_rows || 1)) * 100 : 0)
      : 100 - Number(source.fresh_ratio_percent))
    const hasNoFreshEvidence = hasEvidence && Number(source.fresh_rows || 0) === 0
    if (hasNoFreshEvidence || (source.stale_rows > staleSourceWarningLimit && staleRatio >= staleSourceRatioWarningPercent)) {
      warnings.push(`stale ${source.source} evidence coverage: ${source.stale_rows}/${source.evidence_rows} rows (${staleRatio.toFixed(1)}% stale)`)
    }
  }
  const conflictingDuplicateCoordinates = Number(sourceQuality.accepted_duplicate_coordinates?.conflicting_name_pairs || 0)
  if (conflictingDuplicateCoordinates > 0) {
    warnings.push(`accepted source-review rows have conflicting same-source coordinates: ${conflictingDuplicateCoordinates} pair(s)`)
  }
  const duplicateRate = Number(sourceQuality.canonical?.affected_row_rate_percent || 0)
  if (duplicateRate > canonicalDuplicateRateLimit) {
    alerts.push(`canonical likely-duplicate rate exceeds limit: ${duplicateRate}% > ${canonicalDuplicateRateLimit}%`)
  }
  const pendingReviewRows = (sourceQuality.review_queue || [])
    .filter(row => row.status === 'pending')
    .reduce((total, row) => total + Number(row.rows || 0), 0)
  if (pendingReviewRows > reviewBacklogWarningLimit) {
    warnings.push(`source-review backlog is ${pendingReviewRows} rows > ${reviewBacklogWarningLimit}`)
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

  const scrapeRecent = scrapeFailures.summary?.recent_categories || scrapeFailures.summary?.categories || {}
  const unknown = scrapeRecent.unknown ?? null
  if (unknown != null && unknown > unknownFailureLimit) alerts.push(`unknown scrape failures exceed limit: ${unknown} > ${unknownFailureLimit}`)
  const blocked = scrapeRecent.blocked ?? null
  if (blocked != null && blocked > scrapeBlockedWarningLimit) {
    warnings.push(`blocked scrape failures: ${blocked} > ${scrapeBlockedWarningLimit}`)
    actions.push('Review robots/403 failures by host; do not bulk-retry blocked URLs.')
  }
  const deadLink = scrapeRecent.dead_link ?? null
  if (deadLink != null && deadLink > scrapeDeadLinkWarningLimit) {
    warnings.push(`dead-link scrape failures: ${deadLink} > ${scrapeDeadLinkWarningLimit}`)
    actions.push('Run the dead-link cleanup/report and refresh source website evidence before retrying.')
  }
  if (unknown != null && unknown > scrapeUnknownWarningLimit && unknown <= unknownFailureLimit) {
    warnings.push(`unknown scrape failures: ${unknown} > ${scrapeUnknownWarningLimit}`)
    actions.push('Inspect unknown scrape errors by host before changing retry policy.')
  }
  const exhausted = scrapeFailures.summary?.recent_categories?.transient ?? 0
  if (exhausted != null && exhausted > scrapeExhaustedWarningLimit) {
    warnings.push(`transient scrape jobs exhausted retry attempts: ${exhausted} > ${scrapeExhaustedWarningLimit}`)
    actions.push('Run the bounded transient scrape recovery command in dry-run mode, then apply a small batch.')
  }
  if (queue) {
    const pendingScrape = queue['scrape:pending'] || 0
    const pendingClassify = queue['classify:pending'] || 0
    if (pendingScrape < scrapeAheadMinimum) warnings.push(`scrape backlog below configured floor: ${pendingScrape} < ${scrapeAheadMinimum}`)
    // Scraping should stay ahead of classification so classifiers do not sit
    // idle waiting for website evidence. A smaller scrape backlog is the risk.
    if (pendingScrape < pendingClassify) warnings.push(`scrape backlog is behind classifier demand: scrape=${pendingScrape}, classify=${pendingClassify}`)
    if ((queue['classify:processing'] || 0) > 0 && classifier.queue?.staleProcessingJobs?.length) alerts.push(`stale classifier processing jobs: ${classifier.queue.staleProcessingJobs.length}`)
    if (staleProcessingJobs.length) {
      alerts.push(`stale processing jobs across pipeline: ${staleProcessingJobs.length} > ${staleProcessingMinutes} minutes`)
      actions.push('Inspect the listed job IDs and recover only jobs whose worker heartbeat is stale.')
    }
  }

  const state = alerts.length ? 'FAIL' : warnings.length ? 'WARN' : 'OK'
  const report = {
    generatedAt: new Date().toISOString(),
    state,
    alerts,
    warnings,
    thresholds: { unknownFailureLimit, scrapeAheadMinimum, duplicateWarningLimit, staleSourceWarningLimit, staleSourceRatioWarningPercent, scrapeExhaustedWarningLimit, scrapeBlockedWarningLimit, scrapeDeadLinkWarningLimit, scrapeUnknownWarningLimit, canonicalDuplicateRateLimit, sourcePipelineStaleMinutes, reviewBacklogWarningLimit, staleProcessingMinutes },
    queue,
    staleProcessingJobs,
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
    ,sourcePipeline,
    actions: [...new Set(actions)]
  }
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`# Pipeline alerts: ${state}`)
    console.log(`alerts=${alerts.length}`)
    console.log(`warnings=${warnings.length}`)
    for (const item of alerts) console.log(`ALERT: ${item}`)
    for (const item of warnings) console.log(`WARN: ${item}`)
    for (const item of [...new Set(actions)]) console.log(`ACTION: ${item}`)
  }
  if (state === 'FAIL') process.exitCode = 1
}

main()
