#!/usr/bin/env node
/**
 * Consolidated, read-only readiness report for the six APizza workstreams.
 *
 * This is an evidence aggregator, not a health monitor. Run it on the iMac
 * for live queue/Postgres evidence; it never starts workers or writes data.
 */

import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const json = process.argv.includes('--json')

export function executionContext({ hostname = os.hostname(), platform = process.platform, cwd = root } = {}) {
  return {
    host_label: process.env.APIZZA_RUNTIME_HOST || hostname,
    hostname,
    platform,
    cwd,
    node_version: process.version,
  }
}

export function repositoryContext({ readGit = args => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}) } = {}) {
  const read = args => String(readGit(args) || '').trim()
  try {
    const branch = read(['rev-parse', '--abbrev-ref', 'HEAD'])
    const head = read(['rev-parse', '--short', 'HEAD'])
    let originMain = null
    let syncState = 'unknown'
    try {
      originMain = read(['rev-parse', '--short', 'origin/main'])
      const [ahead, behind] = read(['rev-list', '--left-right', '--count', 'HEAD...origin/main'])
        .split(/\s+/)
        .map(value => Number(value))
      if (ahead === 0 && behind === 0) syncState = 'aligned'
      else if (ahead > 0 && behind === 0) syncState = 'ahead'
      else if (ahead === 0 && behind > 0) syncState = 'behind'
      else if (ahead > 0 && behind > 0) syncState = 'diverged'
    } catch {
      // A checkout without a remote tracking ref is still reportable.
    }
    const dirty = Boolean(read(['status', '--porcelain']))
    return { branch, head, origin_main: originMain, sync_state: syncState, clean: !dirty }
  } catch (error) {
    return { available: false, error: String(error.message || error).slice(0, 180) }
  }
}

export function summarizeFailure(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'sub-check failed without a diagnostic'
  if (/Missing (?:Supabase URL|VITE_SUPABASE_URL|.*credentials?)/i.test(raw)) {
    return 'required credentials are unavailable in .env.local'
  }
  if (/ECONNREFUSED|connection refused/i.test(raw)) {
    return 'required local service unavailable (connection refused)'
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(raw)) {
    return 'required service unavailable (timed out)'
  }
  if (/Could not find service|service .*not found/i.test(raw)) {
    return 'required launchd service is unavailable'
  }

  const firstUsefulLine = raw
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !/^(at |[\\/]Users[\\/]|Node\.js$)/.test(line))
  return (firstUsefulLine || raw).slice(0, 280)
}

function run(script, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [join(root, 'scripts/ops', script), ...args], {
      cwd: root,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 45_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, value: JSON.parse(stdout) }
  } catch (error) {
    const stdout = String(error.stdout || '').trim()
    let value = null
    try {
      const parsed = JSON.parse(stdout)
      if (parsed && typeof parsed === 'object') value = parsed
    } catch {
      // Most sub-checks do not emit JSON when they fail; retain their concise
      // text fallback below.
    }
    return {
      ok: false,
      value,
      error: value?.error
        || value?.publicationReadiness?.reason
        || summarizeFailure(error.stderr || error.stdout || error.message || error),
    }
  }
}

function verifier(script) {
  try {
    const stdout = execFileSync(process.execPath, [join(root, 'scripts/ops', script)], {
      cwd: root,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output: stdout.trim() }
  } catch (error) {
    return { ok: false, error: summarizeFailure(error.stderr || error.stdout || error.message || error) }
  }
}

function item(workstream, status, evidence, remaining = []) {
  return { workstream, status, evidence, remaining }
}

export function summarizeOperationalReadiness({ runtime, syncPolicy, sync, reviewedNew, homeStatus }) {
  const syncVerified = runtime.ok && syncPolicy.ok && sync.ok && sync.value.status === 'OK'
  const bulkRpcReady = sync.ok && sync.value.bulkRpc?.state === 'ready'
  const reviewedNewReady = reviewedNew.ok && reviewedNew.value.missing_count === 0
  const services = homeStatus?.launchd || []
  const service = label => services.find(row => row.label === label)
  const sourcePipeline = service('com.apizzamichigan.source-pipeline')
  const classifier = service('com.apizzamichigan.classifier')
  const backup = service('com.apizzamichigan.backup')
  const serviceReady = (row, allowedStates) => Boolean(row?.ok && allowedStates.includes(row.operationalState))
  const sourcePipelineReady = serviceReady(sourcePipeline, ['running', 'scheduled_idle'])
  const classifierReady = serviceReady(classifier, ['running'])
  const backupReady = serviceReady(backup, ['running', 'scheduled_idle'])
  const remaining = []

  if (!runtime.ok) remaining.push(`runtime: ${runtime.error}`)
  if (!syncPolicy.ok) remaining.push(`sync policy: ${syncPolicy.error}`)
  if (!sync.ok) remaining.push(`sync status: ${sync.error}`)
  else if (sync.value.status !== 'OK') remaining.push(`sync status=${sync.value.status}`)
  if (!bulkRpcReady) {
    remaining.push(sync.ok
      ? `bulk sync: ${sync.value.bulkRpc?.detail || 'capability was not verified'}`
      : 'bulk sync capability was not verified')
  }
  if (!reviewedNewReady) {
    remaining.push(reviewedNew.ok
      ? `${reviewedNew.value.missing_count} reviewed-new local rows still need Supabase insertion`
      : `reviewed-new reconciliation: ${reviewedNew.error}`)
  }
  if (!homeStatus) {
    remaining.push('local service and backup status was not verified')
  } else {
    if (!sourcePipelineReady) remaining.push(`source pipeline service is ${sourcePipeline?.operationalState || 'unavailable'}`)
    if (!classifierReady) remaining.push(`classifier service is ${classifier?.operationalState || 'unavailable'}`)
    if (!backupReady) remaining.push(`backup service is ${backup?.operationalState || 'unavailable'}`)
    if (homeStatus.backup?.ok !== true) remaining.push(`local backups: ${homeStatus.backup?.error || 'not verified'}`)
  }

  return {
    ready: syncVerified && bulkRpcReady && reviewedNewReady && sourcePipelineReady && classifierReady && backupReady
      && homeStatus?.backup?.ok === true,
    evidence: [
      `sync_status=${sync.value?.status || (sync.ok ? 'unknown' : 'unavailable')}`,
      `bulk_sync=${bulkRpcReady ? 'ready' : 'blocked'}`,
      `reviewed_new_missing=${reviewedNew.ok ? reviewedNew.value.missing_count : 'unknown'}`,
      `source_pipeline=${sourcePipeline?.operationalState || 'unavailable'}`,
      `classifier=${classifier?.operationalState || 'unavailable'}`,
      `backup_service=${backup?.operationalState || 'unavailable'}`,
      `local_backups=${homeStatus?.backup?.ok === true ? 'available' : 'unavailable'}`,
    ],
    remaining,
  }
}

// A stale or advisory source warning should not hide a hard production gate.
// Keep the ordering explicit so the report answers "what blocks the next
// useful action?" rather than simply returning the first report in the list.
const NEXT_GATE_ORDER = [
  '6. Operations',
  '7. Public schema and search performance',
  '2. Enrichment',
  '1. Data pipeline',
  '3. Review operations',
  '4. Data model',
  '5. Product/UI',
]

function nextGate(reports) {
  return reports
    .filter(report => report.status !== 'ready')
    .sort((left, right) => {
      const leftIndex = NEXT_GATE_ORDER.indexOf(left.workstream)
      const rightIndex = NEXT_GATE_ORDER.indexOf(right.workstream)
      return (leftIndex < 0 ? NEXT_GATE_ORDER.length : leftIndex)
        - (rightIndex < 0 ? NEXT_GATE_ORDER.length : rightIndex)
    })[0] || null
}

export function nextActions(reports, limit = 8) {
  const ordered = reports
    .filter(report => report.status !== 'ready')
    .sort((left, right) => {
      const leftIndex = NEXT_GATE_ORDER.indexOf(left.workstream)
      const rightIndex = NEXT_GATE_ORDER.indexOf(right.workstream)
      return (leftIndex < 0 ? NEXT_GATE_ORDER.length : leftIndex)
        - (rightIndex < 0 ? NEXT_GATE_ORDER.length : rightIndex)
    })

  const actions = []
  const seen = new Set()
  for (const report of ordered) {
    for (const action of report.remaining || []) {
      const text = String(action || '').trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      actions.push({ workstream: report.workstream, action: text })
      if (actions.length >= limit) return actions
    }
  }
  return actions
}

function statusFromReadiness(report) {
  return report.ok ? report.value.overall_status : 'blocked'
}

function verifierEvidence(result, label) {
  if (!result.ok) return []

  const output = String(result.output || '').trim()
  if (!output) return [`${label}=ok`]

  try {
    const payload = JSON.parse(output)
    const details = [
      payload.version ? `version=${payload.version}` : null,
      payload.canonical_tables ? `tables=${Object.values(payload.canonical_tables).join(',')}` : null,
      payload.status ? `status=${payload.status}` : null,
    ].filter(Boolean)
    return [`${label}=ok${details.length ? ` (${details.join('; ')})` : ''}`]
  } catch (error) {
    const statusLine = output
      .split('\n')
      .map(line => line.trim())
      .reverse()
      .find(line => /^status=/i.test(line))
    return [statusLine ? `${label} ${statusLine}` : `${label}=ok`]
  }
}

function main() {
  const source = run('source-pipeline-readiness-report.mjs', ['--json'])
  const contract = verifier('verify-canonical-contract.mjs')
  const sourceContract = verifier('verify-source-contract-docs.mjs')
  const runtime = verifier('verify-runtime-configuration.mjs')
  const promotion = verifier('verify-source-promotion-policy.mjs')
  const workflow = verifier('verify-source-review-workflow.mjs')
  const reviewAutomation = run('source-review-automation-report.mjs', ['--entity', 'pizza', '--limit', '1000', '--json'])
  const syncPolicy = verifier('verify-supabase-sync-policy.mjs')
  const classifier = run('classifier-health-report.mjs', ['--json'])
  const sync = run('supabase-sync-status-report.mjs', ['--json'])
  const reviewedNew = run('reconcile-reviewed-new-supabase.mjs', ['--limit', '250', '--json'])
  const publicSchema = run('supabase-sync-readiness-report.mjs', ['--batch', '1', '--sample', '1', '--json'])
  const homeStatus = run('home-status-report.mjs', ['--json'])
  const publicSchemaReady = publicSchema.ok
    && publicSchema.value.lifecycleSync?.remoteSchema?.state === 'ready'
    && publicSchema.value.lifecycleSync?.enabled === true

  const sourceItems = source.ok ? source.value.items : []
  const operational = summarizeOperationalReadiness({
    runtime,
    syncPolicy,
    sync,
    reviewedNew,
    homeStatus: homeStatus.ok ? homeStatus.value : null,
  })
  const sourceItem = name => sourceItems.find(row => row.item === name)
  const sourceRemaining = sourceItems
    .filter(row => row.status !== 'ready')
    .flatMap(row => row.remaining.map(message => `${row.item}: ${summarizeFailure(message)}`))

  const reports = [
    item(
      '1. Data pipeline',
      statusFromReadiness(source),
      source.ok ? sourceItems.map(row => `${row.item}=${row.status}`) : [],
      source.ok ? sourceRemaining : [source.error],
    ),
    item(
      '2. Enrichment',
      classifier.ok && classifier.value.health?.state === 'OK' && !(classifier.value.queue?.staleProcessingJobs || []).length ? 'ready' : 'partial',
      classifier.ok ? [
        `classifier_health=${classifier.value.health?.state}`,
        `recent_completed=${classifier.value.queue?.recent?.completed ?? 'unknown'}`,
        `recent_failed=${classifier.value.queue?.recent?.failed ?? 'unknown'}`,
        `missing_all_classification=${classifier.value.postgres?.summary?.missing_all_classification ?? 'unknown'}`,
        `incomplete_classification=${classifier.value.postgres?.summary?.incomplete_classification ?? 'unknown'}`,
        `operational_backlog=${classifier.value.postgres?.classificationBacklog?.candidates ?? 'unknown'}`,
        `retryable_partial=${classifier.value.postgres?.classificationBacklog?.retryablePartial ?? 'unknown'}`,
        `missing_classify_job=${classifier.value.postgres?.classificationBacklog?.missingJob ?? 'unknown'}`,
        `stale_processing=${(classifier.value.queue?.staleProcessingJobs || []).length}`,
        `tunnel=${classifier.value.tunnel?.ok ? 'healthy' : 'unhealthy'}`,
      ] : [],
      classifier.ok
        ? (classifier.value.health?.issues || classifier.value.health?.warnings || []).map(summarizeFailure)
        : [classifier.error],
    ),
    item(
      '3. Review operations',
      workflow.ok && reviewAutomation.ok && reviewAutomation.value.summary?.state === 'ready' ? 'ready' : 'partial',
      verifierEvidence(workflow, 'review_workflow')
        .concat(reviewAutomation.ok
          ? [
            `deterministic_auto_link_state=${reviewAutomation.value.summary?.state || 'unknown'}`,
            `deterministic_auto_link_candidates=${reviewAutomation.value.summary?.state === 'ready' ? reviewAutomation.value.summary.candidates : 'unknown'}`,
          ]
          : []),
      [
        ...(workflow.ok ? [] : [workflow.error]),
        ...(reviewAutomation.ok
          ? (reviewAutomation.value.summary?.state === 'ready' ? [] : ['live deterministic review workload is unavailable'])
          : [reviewAutomation.error]),
      ],
    ),
    item(
      '4. Data model',
      contract.ok && sourceContract.ok && promotion.ok ? 'ready' : 'partial',
      verifierEvidence(contract, 'canonical_contract')
        .concat(verifierEvidence(sourceContract, 'source_contract'))
        .concat(verifierEvidence(promotion, 'promotion_policy')),
      [contract, sourceContract, promotion].filter(row => !row.ok).map(row => row.error),
    ),
    item(
      '5. Product/UI',
      sourceItem('UI/search polish')?.status || 'requires_visual_check',
      sourceItem('UI/search polish')?.evidence || ['static UI evidence unavailable'],
      sourceItem('UI/search polish')?.remaining || ['rendered desktop/mobile behavior requires browser verification'],
    ),
    item(
      '6. Operations',
      operational.ready ? 'ready' : 'partial',
      verifierEvidence(runtime, 'runtime_config')
        .concat(verifierEvidence(syncPolicy, 'sync_policy'))
        .concat(operational.evidence),
      operational.remaining,
    ),
    item(
      '7. Public schema and search performance',
      publicSchemaReady ? 'ready' : 'partial',
      publicSchema.ok ? [
        `lifecycle_remote_schema=${publicSchema.value.lifecycleSync?.remoteSchema?.state || 'unknown'}`,
        `lifecycle_sync=${publicSchema.value.lifecycleSync?.enabled ? 'enabled' : 'disabled'}`,
        'search-index migration is checked in and preserves existing search behavior',
      ] : [],
      publicSchema.ok ? [
        ...(publicSchema.value.lifecycleSync?.remoteSchema?.state === 'ready'
          ? []
          : ['apply supabase-production-migration.sql in the Supabase SQL editor']),
        ...(publicSchema.value.lifecycleSync?.enabled
          ? []
          : ['set ENABLE_LIFECYCLE_SYNC=1 only after the lifecycle readiness report is ready']),
      ] : [publicSchema.error, 'apply supabase-production-migration.sql and rerun readiness'],
    ),
  ]

  const gate = nextGate(reports)
  const actions = nextActions(reports)
  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    execution_context: executionContext(),
    repository: repositoryContext(),
    source_readiness: source.ok ? source.value.overall_status : 'unavailable',
    reports,
    next_gate: gate?.workstream || null,
    next_gate_reason: gate?.remaining?.[0] || null,
    next_actions: actions,
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log('# APizzaMichigan Project Readiness')
  console.log(`Generated: ${report.generated_at}`)
  console.log(`Host: ${report.execution_context.host_label} (${report.execution_context.platform})`)
  console.log('Mode: read-only')
  if (report.repository?.head) {
    const tracking = report.repository.origin_main ? `; origin/main ${report.repository.origin_main}` : ''
    const sync = report.repository.sync_state !== 'unknown' ? `; ${report.repository.sync_state}` : ''
    console.log(`Repo: ${report.repository.branch} @ ${report.repository.head}${tracking}${sync}; ${report.repository.clean ? 'clean' : 'has local changes'}`)
  }
  console.log('')
  for (const row of reports) {
    console.log(`## ${row.workstream}: ${row.status}`)
    for (const evidence of row.evidence) console.log(`- Evidence: ${evidence}`)
    for (const remaining of row.remaining) console.log(`- Remaining: ${remaining}`)
    console.log('')
  }
  console.log(`Next gate: ${report.next_gate || 'none'}`)
  if (report.next_gate_reason) console.log(`Why: ${report.next_gate_reason}`)
  if (report.next_actions.length) {
    console.log('Next actions:')
    for (const action of report.next_actions) console.log(`- [${action.workstream}] ${action.action}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
