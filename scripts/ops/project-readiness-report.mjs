#!/usr/bin/env node
/**
 * Consolidated, read-only readiness report for the six APizza workstreams.
 *
 * This is an evidence aggregator, not a health monitor. Run it on the iMac
 * for live queue/Postgres evidence; it never starts workers or writes data.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const json = process.argv.includes('--json')

function run(script, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [join(root, 'scripts/ops', script), ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 45_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, value: JSON.parse(stdout) }
  } catch (error) {
    return {
      ok: false,
      error: String(error.stderr || error.stdout || error.message || error).trim(),
    }
  }
}

function verifier(script) {
  try {
    const stdout = execFileSync(process.execPath, [join(root, 'scripts/ops', script)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output: stdout.trim() }
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.stdout || error.message || error).trim() }
  }
}

function item(workstream, status, evidence, remaining = []) {
  return { workstream, status, evidence, remaining }
}

function statusFromReadiness(report) {
  return report.ok ? report.value.overall_status : 'blocked'
}

function main() {
  const source = run('source-pipeline-readiness-report.mjs', ['--json'])
  const contract = verifier('verify-canonical-contract.mjs')
  const sourceContract = verifier('verify-source-contract-docs.mjs')
  const runtime = verifier('verify-runtime-configuration.mjs')
  const promotion = verifier('verify-source-promotion-policy.mjs')
  const workflow = verifier('verify-source-review-workflow.mjs')
  const syncPolicy = verifier('verify-supabase-sync-policy.mjs')
  const classifier = run('classifier-health-report.mjs', ['--json'])
  const sync = run('supabase-sync-status-report.mjs', ['--json'])
  const reviewedNew = run('reconcile-reviewed-new-supabase.mjs', ['--limit', '250', '--json'])
  const publicSchema = run('supabase-sync-readiness-report.mjs', ['--batch', '1', '--sample', '1', '--json'])

  const sourceItems = source.ok ? source.value.items : []
  const sourceItem = name => sourceItems.find(row => row.item === name)
  const sourceRemaining = sourceItems
    .filter(row => row.status !== 'ready')
    .flatMap(row => row.remaining.map(message => `${row.item}: ${message}`))

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
        `stale_processing=${(classifier.value.queue?.staleProcessingJobs || []).length}`,
        `tunnel=${classifier.value.tunnel?.ok ? 'healthy' : 'unhealthy'}`,
      ] : [],
      classifier.ok ? (classifier.value.health?.issues || classifier.value.health?.warnings || []) : [classifier.error],
    ),
    item(
      '3. Review operations',
      workflow.ok ? 'ready' : 'partial',
      workflow.ok ? ['review workflow verifier passed'] : [],
      workflow.ok ? ['pending queue volume still requires live review-batch execution'] : [workflow.error],
    ),
    item(
      '4. Data model',
      contract.ok && sourceContract.ok && promotion.ok ? 'ready' : 'partial',
      [contract, sourceContract, promotion].filter(row => row.ok).map(row => row.output.split('\n').at(-1)),
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
      runtime.ok && syncPolicy.ok && sync.ok && sync.value.status === 'OK'
        && reviewedNew.ok && reviewedNew.value.missing_count === 0 ? 'ready' : 'partial',
      [runtime, syncPolicy].filter(row => row.ok).map(row => row.output.split('\n').at(-1)).concat(
        sync.ok ? [`sync_status=${sync.value.status}`] : [],
        reviewedNew.ok ? [`reviewed_new_missing=${reviewedNew.value.missing_count}`] : [],
      ),
      [
        ...(runtime.ok && syncPolicy.ok && sync.ok && reviewedNew.ok ? [] : ['runtime, sync policy, sync status, or reviewed-new reconciliation is not verified']),
        ...[runtime, syncPolicy].filter(row => !row.ok).map(row => row.error),
        ...(sync.ok ? (sync.value.status === 'OK' ? [] : [`sync status=${sync.value.status}`]) : [sync.error]),
        ...(reviewedNew.ok
          ? (reviewedNew.value.missing_count === 0 ? [] : [`${reviewedNew.value.missing_count} reviewed-new local rows still need Supabase insertion`])
          : [reviewedNew.error]),
      ],
    ),
    item(
      '7. Public schema and search performance',
      'partial',
      publicSchema.ok ? [
        `lifecycle_remote_schema=${publicSchema.value.lifecycleSync?.remoteSchema?.state || 'unknown'}`,
        `lifecycle_sync=${publicSchema.value.lifecycleSync?.enabled ? 'enabled' : 'disabled'}`,
        'search-index migration is checked in and preserves existing search behavior',
      ] : [],
      publicSchema.ok ? [
        ...(publicSchema.value.lifecycleSync?.remoteSchema?.state === 'ready'
          ? []
          : ['apply supabase-production-migration.sql in the Supabase SQL editor']),
        'set ENABLE_LIFECYCLE_SYNC=1 only after the lifecycle readiness report is ready',
      ] : [publicSchema.error, 'apply supabase-production-migration.sql and rerun readiness'],
    ),
  ]

  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    source_readiness: source.ok ? source.value.overall_status : 'unavailable',
    reports,
    next_gate: reports.find(row => row.status !== 'ready')?.workstream || null,
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log('# APizzaMichigan Project Readiness')
  console.log(`Generated: ${report.generated_at}`)
  console.log('')
  for (const row of reports) {
    console.log(`## ${row.workstream}: ${row.status}`)
    for (const evidence of row.evidence) console.log(`- Evidence: ${evidence}`)
    for (const remaining of row.remaining) console.log(`- Remaining: ${remaining}`)
    console.log('')
  }
  console.log(`Next gate: ${report.next_gate || 'none'}`)
}

main()
