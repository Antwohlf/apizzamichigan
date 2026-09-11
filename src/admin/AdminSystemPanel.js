import React, { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import AdminConfirmDialog from './AdminConfirmDialog'
import { humanReadiness, sourceLabel } from './sourceReviewQueues'

const PREVIEW_PAGE_SIZE = 10
const numberFormat = new Intl.NumberFormat()
const formatCount = value => numberFormat.format(Number(value) || 0)
const formatDate = value => {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

const syncRunSummary = run => {
  if (!run) return 'No scheduled sync run has been recorded.'
  const state = String(run.state || 'unknown').toLowerCase()
  const when = formatDate(run.finished_at || run.started_at)
  if (state === 'running') return `A sync is running (started ${when}).`
  const label = state === 'succeeded' ? 'Last sync succeeded'
    : state === 'skipped' ? 'Last sync was skipped'
      : state === 'failed' ? 'Last sync failed'
        : 'Last sync state is unknown'
  const reason = String(run.reason || '').trim()
  return `${label} ${when === 'Never' ? '' : `at ${when}.`}${reason ? ` ${reason}` : ''}`.trim()
}

export const syncHumanSummary = readiness => {
  if (!readiness) {
    return {
      title: 'Checking publication status',
      detail: 'Checking whether local changes are ready to publish.',
      tone: 'unknown',
    }
  }

  const rpcState = String(readiness.bulkRpc?.state || '').toLowerCase()
  if (rpcState === 'migration_missing' || readiness.state === 'blocked') {
    return {
      title: 'Publishing is paused',
      detail: 'Local work is continuing. Apply scripts/enrichment/supabase-bulk-sync-rpc-migration.sql in Supabase, then refresh this page before publishing.',
      tone: 'blocked',
    }
  }

  if (readiness.state === 'nothing_waiting' || readiness.state === 'ready') {
    return {
      title: 'Public map is ready to update',
      detail: 'The guarded publisher can send approved local changes to the public map.',
      tone: 'ready',
    }
  }

  const externalStates = new Set(['running', 'succeeded', 'skipped', 'failed', 'not_configured', 'missing', 'stale', 'unavailable'])
  if (externalStates.has(readiness.state)) {
    return {
      title: readiness.label || 'External publication status',
      detail: readiness.detail || 'The external compatibility-runtime publication status needs review.',
      tone: readiness.state === 'succeeded' ? 'ready'
        : readiness.state === 'failed' ? 'blocked'
          : 'unknown',
    }
  }

  return {
    title: 'Publication needs attention',
    detail: 'The local pipeline is available, but the public publishing status needs review.',
    tone: 'unknown',
  }
}

const REGION_LABELS = {
  CA: 'California',
  MI: 'Michigan',
  NY: 'New York',
  TX: 'Texas',
}

const regionLabel = code => REGION_LABELS[String(code || '').toUpperCase()] || String(code || '').toUpperCase()

const classifierBacklog = pipelineStatus => pipelineStatus?.classifier?.backlog || null
const sourceFeederLabel = pipelineStatus => {
  const scheduler = pipelineStatus?.sourcePipeline?.scheduler
  if (!scheduler) return null
  if (scheduler.state === 'running') return 'Running'
  if (scheduler.state === 'idle') return 'Loaded and idle'
  if (scheduler.state === 'not_found') return 'Not loaded'
  if (scheduler.state === 'unsupported') return 'Status unavailable'
  return scheduler.state ? scheduler.state.replace(/_/g, ' ') : 'Unknown'
}
const backlogEtaLabel = backlog => {
  if (!backlog || backlog.estimatedDays == null) return 'No ETA yet'
  if (Number(backlog.estimatedDays) < 1) return `${Math.max(1, Math.round(Number(backlog.estimatedHours || 0)))} hours at current rate`
  return `${Number(backlog.estimatedDays).toFixed(1)} days at current rate`
}

const backlogActionLabel = backlog => {
  if (!backlog) return ''
  if (backlog.state === 'queued') return 'The classifier has queued work to process.'
  if (backlog.state === 'partial_retry_pending') {
    return `${formatCount(backlog.retryablePartial)} partial results are ready for a bounded retry pass.`
  }
  if (backlog.state === 'manual_review') {
    return `${formatCount(backlog.exhaustedPartial)} partial results need editorial review.`
  }
  if (backlog.state === 'unfed') return 'Some places still need classify jobs before processing can continue.'
  if (backlog.state === 'clear') return 'No classification backlog remains for the configured regions.'
  return backlog.recommendedAction || ''
}

const promotionPolicyRows = [
  ['Website and phone', 'Fill blanks only from accepted, high-confidence evidence.'],
  ['Menu, email, social links, hours, service options', 'Keep as source evidence until normalization and conflict rules exist.'],
  ['Name, address, coordinates, state, brand', 'Require review before changing place identity.'],
  ['Style and price', 'Classifier or editorial fields; source adapters do not overwrite them.'],
  ['Rating, notes, status, photos', 'Manual editorial fields only.'],
]

export default function AdminSystemPanel({ entity }) {
  const [payload, setPayload] = useState(null)
  const [syncReadiness, setSyncReadiness] = useState(null)
  const [pipelineStatus, setPipelineStatus] = useState(null)
  const [lifecycle, setLifecycle] = useState(null)
  const [basicFieldCoverage, setBasicFieldCoverage] = useState(null)
  const [lifecycleKind, setLifecycleKind] = useState('replacements')
  const [lifecycleCandidates, setLifecycleCandidates] = useState(null)
  const [lifecycleLoading, setLifecycleLoading] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#lifecycle-quality')
  const [importOpen, setImportOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#approved-import')
  const [basicCoverageOpen, setBasicCoverageOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#basic-coverage')
  const [pipelineOpen, setPipelineOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#pipeline-status')
  const [preflight, setPreflight] = useState(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [conflictRows, setConflictRows] = useState(null)
  const [conflictLoading, setConflictLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [previewPage, setPreviewPage] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [confirmCount, setConfirmCount] = useState(0)
  const [importBusy, setImportBusy] = useState(false)
  const [lifecycleConfirmation, setLifecycleConfirmation] = useState(null)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const pipelineRequest = fetch(`/api/admin/pipeline-status?entity=${entity}`, { credentials: 'include' })
          .then(async response => response.ok ? response.json() : {})
          .catch(() => ({}))
        pipelineRequest.then(result => {
          if (!cancelled) setPipelineStatus(result?.data || null)
        })
        const [provenanceResponse, summaryResponse, syncResponse] = await Promise.all([
          fetch(`/api/admin/source-provenance?entity=${entity}`, { credentials: 'include' }),
          fetch(`/api/admin/source-review-summary?entity=${entity}`, { credentials: 'include' }),
          fetch(`/api/admin/supabase-sync-readiness?entity=${entity}`, { credentials: 'include' }),
        ])
        if (!provenanceResponse.ok) throw new Error(await provenanceResponse.text() || 'Source status is unavailable.')
        const [provenancePayload, summaryPayload, syncPayload] = await Promise.all([
          provenanceResponse.json(),
          summaryResponse.json(),
          syncResponse.ok ? syncResponse.json() : Promise.resolve({}),
        ])
        if (!cancelled) {
          setPayload(provenancePayload?.data || null)
          setPreflight(null)
          setLifecycle(summaryPayload?.data?.lifecycle || null)
          setBasicFieldCoverage(summaryPayload?.data?.basicFieldCoverage || null)
          setSyncReadiness(syncPayload?.data || null)
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'System details could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setPreviewPage(0)
    setPreflight(null)
    setConflictRows(null)
    load()
    return () => {
      cancelled = true
    }
  }, [entity, refreshKey])

  const loadPreflight = useCallback(async () => {
    if (preflight || preflightLoading) return
    setPreflightLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/source-review-queue/import-preflight?entity=${entity}&limit=100&nearbyRadiusM=150`, { credentials: 'include' })
      if (!response.ok) throw new Error(await response.text() || 'Import check is unavailable.')
      const result = await response.json()
      setPreflight(result?.data || null)
    } catch (err) {
      setError(err?.message || 'Import check is unavailable.')
    } finally {
      setPreflightLoading(false)
    }
  }, [entity, preflight, preflightLoading])

  const loadConflictRows = useCallback(async () => {
    if (conflictRows || conflictLoading) return
    setConflictLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/source-review-conflicts?entity=${entity}&limit=20`, { credentials: 'include' })
      if (!response.ok) throw new Error(await response.text() || 'Source conflicts are unavailable.')
      setConflictRows(await response.json())
    } catch (err) {
      setError(err?.message || 'Source conflicts are unavailable.')
    } finally {
      setConflictLoading(false)
    }
  }, [conflictRows, conflictLoading, entity])

  const loadLifecycleCandidates = useCallback(async kind => {
    setLifecycleLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/lifecycle-candidates?entity=${entity}&kind=${kind}&limit=50`, { credentials: 'include' })
      if (!response.ok) throw new Error(await response.text() || 'Lifecycle candidates are unavailable.')
      const result = await response.json()
      setLifecycleCandidates(result?.data || null)
    } catch (err) {
      setError(err?.message || 'Lifecycle candidates are unavailable.')
    } finally {
      setLifecycleLoading(false)
    }
  }, [entity])

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#approved-import') return
    const section = document.getElementById('approved-import')
    if (section) section.open = true
    loadPreflight()
    loadConflictRows()
  }, [loadConflictRows, loadPreflight])

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#lifecycle-quality') return
    const section = document.getElementById('lifecycle-quality')
    if (section) section.open = true
    loadLifecycleCandidates(lifecycleKind)
  }, [lifecycleKind, loadLifecycleCandidates])

  const database = payload?.database || {}
  const sourceRows = database.sourceCounts || []
  const matchMethods = database.matchMethods || []
  const preflightCandidates = preflight?.candidates || []
  const previewPageCount = Math.max(1, Math.ceil(preflightCandidates.length / PREVIEW_PAGE_SIZE))
  const visibleCandidates = preflightCandidates.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE)
  const blockedCount = Math.max(0, Number(preflight?.rowsInspected || 0) - Number(preflight?.candidateReady || 0))
  const coordinateConflictCount = Number(preflight?.readinessCounts?.find?.(row => row.readiness === 'duplicate_accepted_source_coordinate')?.rows || 0)
  const syncSummary = syncHumanSummary(syncReadiness)
  const hasSyncQueueCounts = Boolean(syncReadiness && [
    'pendingAfterCheckpoint',
    'wouldUpdate',
    'protectedFieldConflicts',
  ].some(field => Object.prototype.hasOwnProperty.call(syncReadiness, field)))
  const coverageRegions = basicFieldCoverage?.scope?.length
    ? basicFieldCoverage.scope
    : Object.keys(basicFieldCoverage?.byState || {})

  const runImport = async () => {
    setImportBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/source-review-queue/import-reviewed-new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity,
          limit: 100,
          nearbyRadiusM: 150,
          confirmed: true,
        }),
      })
      if (!response.ok) throw new Error(await response.text() || 'Import failed.')
      const result = (await response.json())?.data || {}
      const imported = Array.isArray(result.imported) ? result.imported.length : 0
      setMessage(`${formatCount(imported)} place${imported === 1 ? '' : 's'} imported locally.`)
      setConfirmCount(0)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'Import failed.')
    } finally {
      setImportBusy(false)
    }
  }

  const markClosed = async () => {
    if (!lifecycleConfirmation || lifecycleBusy) return
    setLifecycleBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/places/${lifecycleConfirmation.place_id}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity,
          lifecycleStatus: 'closed',
          reason: 'Closure confirmed during manual admin review.',
        }),
      })
      if (!response.ok) throw new Error(await response.text() || 'The place could not be marked closed.')
      setLifecycleConfirmation(null)
      setLifecycleCandidates(null)
      setMessage(`${lifecycleConfirmation.name || 'Place'} marked closed locally.`)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'The place could not be marked closed.')
    } finally {
      setLifecycleBusy(false)
    }
  }

  return (
    <div className="admin-content">
      <div className="admin-toolbar">
        <div className="admin-toolbar__spacer" />
        <button
          className="admin-button admin-button--quiet"
          type="button"
          onClick={() => setRefreshKey(value => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {loading ? <div className="admin-alert" role="status">Loading system status…</div> : null}
      {error ? <div className="admin-alert admin-alert--error" role="alert">{error}</div> : null}
      {message ? <div className="admin-alert admin-alert--success" role="status">{message}</div> : null}

      {!loading && (payload || pipelineStatus) ? (
        <>
          <section className="admin-system-status" aria-labelledby="sync-status-heading">
            <div>
              <p className="admin-eyebrow">Publishing</p>
              <h2 id="sync-status-heading">{syncSummary.title}</h2>
              <p>{syncSummary.detail}</p>
              {hasSyncQueueCounts ? (
                <p className="admin-system-status__meta">
                  {Number(syncReadiness.pendingAfterCheckpoint || syncReadiness.wouldUpdate || 0)
                    ? `${formatCount(Math.max(Number(syncReadiness.pendingAfterCheckpoint) || 0, Number(syncReadiness.wouldUpdate) || 0))} local update${Math.max(Number(syncReadiness.pendingAfterCheckpoint) || 0, Number(syncReadiness.wouldUpdate) || 0) === 1 ? '' : 's'} waiting.`
                    : 'No local updates are waiting.'}
                  {Number(syncReadiness.protectedFieldConflicts) > 0
                    ? ` ${formatCount(syncReadiness.protectedFieldConflicts)} protected-field conflict${Number(syncReadiness.protectedFieldConflicts) === 1 ? '' : 's'} need review.`
                    : ''}
                </p>
              ) : null}
              {syncReadiness?.lastRun ? <p className="admin-system-status__meta">{syncRunSummary(syncReadiness.lastRun)}</p> : null}
              {syncReadiness?.detail ? (
                <details className="admin-system-status__technical">
                  <summary>Technical details</summary>
                  <p>{syncReadiness.detail}</p>
                </details>
              ) : null}
            </div>
            <strong className={`admin-system-status__state admin-system-status__state--${syncSummary.tone}`}>
              {syncReadiness?.label || 'Checking…'}
            </strong>
          </section>
          <details
            className="admin-system-section"
            id="pipeline-status"
            open={pipelineOpen}
            onToggle={event => setPipelineOpen(event.currentTarget.open)}
          >
            <summary>
              <strong>Pipeline health</strong>
              <span>{pipelineStatus?.label || 'No recent check'}</span>
            </summary>
            <div className="admin-system-section__body">
              <p className="admin-system-copy">
                <strong>{pipelineStatus?.authorityLabel || 'Configured pipeline observation'}</strong>.
                {' '}This read-only snapshot does not start workers, authorize apply, or publish changes.
              </p>
              <p className="admin-system-copy">{pipelineStatus?.detail || 'No pipeline health report is available yet.'}</p>
              {pipelineStatus?.checkedAt ? <p className="admin-system-status__meta">Checked {formatDate(pipelineStatus.checkedAt)}.</p> : null}
              {sourceFeederLabel(pipelineStatus) ? (
                <p className="admin-system-status__meta" role="status">
                  <strong>Source feeder:</strong> {sourceFeederLabel(pipelineStatus)}.
                  {pipelineStatus.sourcePipeline?.scheduler?.detail ? ` ${pipelineStatus.sourcePipeline.scheduler.detail}` : ''}
                </p>
              ) : null}
              {classifierBacklog(pipelineStatus) ? (
                <div className="admin-system-status" style={{ marginTop: 16 }}>
                  <div>
                    <p className="admin-eyebrow">Classification work</p>
                    <h3>Records still need enrichment</h3>
                    <p>
                      This includes incomplete results, even when the job queue is empty. The estimate is read-only and based on recent completed work.
                    </p>
                    {backlogActionLabel(classifierBacklog(pipelineStatus)) ? (
                      <p className="admin-system-status__meta" role="status">
                        {backlogActionLabel(classifierBacklog(pipelineStatus))}
                      </p>
                    ) : null}
                  </div>
                  <div className="admin-stat-grid admin-stat-grid--compact">
                    <div><strong>{formatCount(classifierBacklog(pipelineStatus).candidates)}</strong><span>Remaining</span></div>
                    <div><strong>{formatCount(classifierBacklog(pipelineStatus).retryablePartial)}</strong><span>Retryable</span></div>
                    <div><strong>{formatCount(classifierBacklog(pipelineStatus).exhaustedPartial)}</strong><span>Needs review</span></div>
                    <div><strong>{backlogEtaLabel(classifierBacklog(pipelineStatus))}</strong><span>Estimated time</span></div>
                  </div>
                </div>
              ) : null}
              {pipelineStatus?.freshness?.length ? (
                <div className="admin-table-wrap" style={{ marginTop: 16 }}>
                  <table className="admin-table">
                    <caption className="admin-sr-only">Source freshness from the iMac pipeline</caption>
                    <thead>
                      <tr><th>Input</th><th>Fresh</th><th>Stale</th><th>Eligible</th></tr>
                    </thead>
                    <tbody>
                      {pipelineStatus.freshness.map(source => (
                        <tr key={source.source}>
                          <td>{sourceLabel(source.source)}</td>
                          <td className={Number(source.stale_rows) > 0 ? 'admin-table__warning' : 'admin-table__success'}>
                            {Number(source.fresh_ratio_percent || 0).toFixed(1)}%
                          </td>
                          <td>{formatCount(source.stale_rows)}</td>
                          <td>{formatCount(source.eligible_rows)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {pipelineStatus?.alerts?.length ? (
                <div className="admin-alert admin-alert--error" role="status">
                  <strong>Needs repair</strong>
                  <ul>{pipelineStatus.alerts.map(alert => <li key={alert}>{alert}</li>)}</ul>
                </div>
              ) : null}
              {pipelineStatus?.warnings?.length ? (
                <div className="admin-alert admin-alert--warning" role="status">
                  <strong>Needs attention</strong>
                  <ul>{pipelineStatus.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ) : null}
              {!pipelineStatus?.alerts?.length && !pipelineStatus?.warnings?.length && pipelineStatus?.available ? (
                <p className="admin-system-copy">No issues were reported by the latest check.</p>
              ) : null}
              {pipelineStatus?.sourceActivation?.sources?.length ? (
                <div className="admin-table-wrap" style={{ marginTop: 16 }}>
                  <table className="admin-table">
                    <caption className="admin-sr-only">Configured source activation status</caption>
                    <thead>
                      <tr><th>Source</th><th>Status</th><th>Schedule</th><th>Last success</th></tr>
                    </thead>
                    <tbody>
                      {pipelineStatus.sourceActivation.sources.map(source => (
                        <tr key={source.source}>
                          <td>{source.source}</td>
                          <td>{source.status === 'ready' ? 'Ready' : source.status === 'disabled' ? 'Disabled' : 'Incomplete'}</td>
                          <td>{source.execution}</td>
                          <td>{formatDate(source.last_success)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </details>
          <details
            className="admin-system-section"
            id="basic-coverage"
            open={basicCoverageOpen}
            onToggle={event => setBasicCoverageOpen(event.currentTarget.open)}
          >
            <summary>
              <strong>Basic information coverage</strong>
              <span>{formatCount(basicFieldCoverage?.overall?.needsAttention)} places need attention</span>
            </summary>
            <div className="admin-system-section__body">
              <p className="admin-system-copy">
                Active places in the configured operating regions with at least one missing basic field. Source updates can fill contact blanks automatically; identity changes still require review.
              </p>
              <div className="admin-stat-grid">
                <div><strong>{formatCount(basicFieldCoverage?.overall?.total)}</strong><span>Places checked</span></div>
                <div><strong>{formatCount(basicFieldCoverage?.overall?.missing?.address)}</strong><span>Missing address</span></div>
                <div><strong>{formatCount(basicFieldCoverage?.overall?.missing?.website_url)}</strong><span>Missing website</span></div>
                <div><strong>{formatCount(basicFieldCoverage?.overall?.missing?.phone)}</strong><span>Missing phone</span></div>
                <div><strong>{formatCount(basicFieldCoverage?.overall?.missing?.style)}</strong><span>Missing style</span></div>
                <div><strong>{formatCount(basicFieldCoverage?.overall?.missing?.price_range)}</strong><span>Missing price</span></div>
              </div>
              <div className="admin-table-wrap" style={{ marginTop: 16 }}>
                <table className="admin-table">
                  <caption className="admin-sr-only">Basic information coverage by state</caption>
                  <thead><tr><th>Area</th><th>Places</th><th>Need attention</th><th>Missing website</th><th>Missing phone</th><th>Missing style</th><th>Missing price</th></tr></thead>
                  <tbody>
                    {coverageRegions.map(state => {
                      const row = basicFieldCoverage?.byState?.[state]
                      return (
                        <tr key={state}>
                          <td>{regionLabel(state)}</td>
                          <td>{formatCount(row?.total)}</td>
                          <td>{formatCount(row?.needsAttention)}</td>
                          <td>{formatCount(row?.missing?.website_url)}</td>
                          <td>{formatCount(row?.missing?.phone)}</td>
                          <td>{formatCount(row?.missing?.style)}</td>
                          <td>{formatCount(row?.missing?.price_range)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
          <details
            className="admin-system-section"
            id="lifecycle-quality"
            open={lifecycleOpen}
            onToggle={event => {
              setLifecycleOpen(event.currentTarget.open)
              if (event.currentTarget.open && !lifecycleCandidates) loadLifecycleCandidates(lifecycleKind)
            }}
          >
            <summary>
              <strong>Business lifecycle watchlist</strong>
              <span>{formatCount(lifecycle?.replacements)} replacements</span>
            </summary>
            <div className="admin-system-section__body">
              <p className="admin-system-copy">
                Review business changes separately from ordinary source matching. Nothing is changed automatically here.
              </p>
              <div className="admin-stat-grid">
                <div><strong>{formatCount(lifecycle?.replacements)}</strong><span>Possible replacements</span></div>
                <div><strong>{formatCount(lifecycle?.closedSignals)}</strong><span>Closed source signals</span></div>
                <div><strong>{formatCount(lifecycle?.stalePlaces)}</strong><span>Places needing refresh</span></div>
                <div><strong>{formatCount(lifecycle?.staleEvidence)}</strong><span>Stale evidence rows</span></div>
              </div>
              <div className="admin-lifecycle-toolbar">
                <label className="admin-field admin-field--inline">
                  <span>Show</span>
                  <select
                    value={lifecycleKind}
                    onChange={event => {
                      const nextKind = event.target.value
                      setLifecycleKind(nextKind)
                      loadLifecycleCandidates(nextKind)
                    }}
                  >
                    <option value="replacements">Possible replacements</option>
                    <option value="closed">Closed source signals</option>
                    <option value="stale">Stale listings</option>
                    <option value="conflicts">Same-location conflicts</option>
                  </select>
                </label>
                <button className="admin-button admin-button--quiet" type="button" onClick={() => loadLifecycleCandidates(lifecycleKind)} disabled={lifecycleLoading}>
                  {lifecycleLoading ? 'Checking…' : 'Refresh list'}
                </button>
              </div>
              {lifecycleLoading ? <div className="admin-alert" role="status">Loading lifecycle candidates…</div> : null}
              {lifecycleCandidates?.available === false ? <div className="admin-alert admin-alert--warning">Local lifecycle evidence is unavailable.</div> : null}
              {lifecycleKind === 'stale' && lifecycleCandidates?.latest_input_observation_counts ? (
                <p className="admin-system-copy" role="status">
                  {lifecycleCandidates.latest_input_observation_detail || 'Current source-observation evidence is not available here. Stale evidence does not establish a closure or absence from OSM.'}
                </p>
              ) : null}
              {lifecycleCandidates?.available && !lifecycleCandidates.rows?.length ? <p className="admin-system-copy">No candidates in this category.</p> : null}
              {lifecycleCandidates?.available && lifecycleCandidates.rows?.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <caption className="admin-sr-only">{formatCount(lifecycleCandidates.total)} lifecycle candidates</caption>
                    <thead>
                      <tr>
                        {lifecycleKind === 'replacements' ? <><th>New source name</th><th>Current place</th><th>Handling</th><th /></> : null}
                        {lifecycleKind === 'closed' ? <><th>Place</th><th>Source</th><th>Evidence date</th><th /></> : null}
                        {lifecycleKind === 'stale' ? <><th>Place</th><th>Source</th><th>Last evidence</th><th /></> : null}
                        {lifecycleKind === 'conflicts' ? <><th>Place one</th><th>Place two</th><th>State</th><th>Gap</th></> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {lifecycleCandidates.rows.map(row => (
                        <tr key={row.review_id || `${row.first_place_id}-${row.second_place_id}` || row.place_id}>
                          {lifecycleKind === 'replacements' ? (
                            <>
                              <td>{row.source_name || 'Unnamed source'}</td>
                              <td>{row.current_name || 'Unnamed place'}<small className="admin-table__subtext">#{row.place_id}</small></td>
                              <td>{row.handling === 'history_requires_review' ? 'History needs care' : 'Safe to review'}</td>
                              <td><button className="admin-button admin-button--quiet" type="button" onClick={() => window.location.assign(`/admin/reviews/data?entity=${entity}&queue=matches&id=${row.review_id}`)}>Review</button></td>
                            </>
                          ) : null}
                          {lifecycleKind === 'stale' ? (
                            <>
                              <td>{row.name || 'Unnamed place'}<small className="admin-table__subtext">#{row.place_id}</small></td>
                              <td>{sourceLabel(row.source)}</td>
                              <td>{formatDate(row.retrieved_at)}</td>
                              <td>
                                <span>{row.freshness_days} day window</span>
                                <small className="admin-table__subtext">
                                  Stale evidence is not a closure signal. Check the source before deciding what to do.
                                </small>
                                <div className="admin-table__actions">
                                  <a href={`${entity === 'taco' ? '/tacos/places' : '/places'}/${encodeURIComponent(String(row.place_id))}`}>View place</a>
                                  {row.source_url ? <a href={row.source_url} target="_blank" rel="noopener noreferrer">Source</a> : null}
                                </div>
                              </td>
                            </>
                          ) : null}
                          {lifecycleKind === 'closed' ? (
                            <>
                              <td>{row.name || 'Unnamed place'}<small className="admin-table__subtext">#{row.place_id}</small></td>
                              <td>{sourceLabel(row.source)}</td>
                              <td>{formatDate(row.retrieved_at)}</td>
                              <td>
                                <button className="admin-button admin-button--quiet" type="button" onClick={() => setLifecycleConfirmation(row)} disabled={lifecycleBusy}>
                                  Mark closed
                                </button>
                              </td>
                            </>
                          ) : null}
                          {lifecycleKind === 'conflicts' ? (
                            <>
                              <td>{row.first_name}<small className="admin-table__subtext">#{row.first_place_id}</small></td>
                              <td>{row.second_name}<small className="admin-table__subtext">#{row.second_place_id}</small></td>
                              <td>{row.state || '—'}</td>
                              <td>{Math.max(Number(row.latitude_gap_m) || 0, Number(row.longitude_gap_m) || 0)} m</td>
                            </>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </details>
          <details className="admin-system-section">
            <summary>
              <strong>Data source status</strong>
              <span>{formatCount(sourceRows.reduce((sum, row) => sum + (Number(row.rows) || 0), 0))} evidence rows</span>
            </summary>
            <div className="admin-system-section__body">
              {!database.available ? (
                <div className="admin-alert admin-alert--warning">{database.reason || 'Local source data is unavailable.'}</div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Evidence rows</th>
                        <th>Places linked</th>
                        <th>Freshness</th>
                        <th>Last update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceRows.map(row => (
                        <tr key={row.source}>
                          <td>{sourceLabel(row.source)}</td>
                          <td>{formatCount(row.rows)}</td>
                          <td>{formatCount(row.places)}</td>
                          <td className={Number(row.stale_rows) > 0 ? 'admin-table__warning' : 'admin-table__success'}>
                            {formatCount(row.fresh_rows)} fresh{Number(row.stale_rows) > 0 ? ` · ${formatCount(row.stale_rows)} stale` : ''}
                          </td>
                          <td>{formatDate(row.latest_updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>

          <details
            className="admin-system-section"
            id="approved-import"
            open={importOpen}
            onToggle={event => {
              setImportOpen(event.currentTarget.open)
              if (event.currentTarget.open) {
                loadPreflight()
                loadConflictRows()
              }
            }}
          >
            <summary>
              <strong>Approved-place import</strong>
              <span>{formatCount(preflight?.acceptedTotal)} approved</span>
            </summary>
            <div className="admin-system-section__body">
              <p className="admin-task__detail">
                This check looks for duplicates again before any local place records are created.
              </p>
              {preflightLoading ? <div className="admin-alert" role="status">Checking approved places…</div> : null}
              {preflight ? (
                <>
                  <div className="admin-metric-row">
                    <div className="admin-metric"><span>Approved</span><strong>{formatCount(preflight.acceptedTotal)}</strong></div>
                    <div className="admin-metric"><span>Ready</span><strong>{formatCount(preflight.candidateReady)}</strong></div>
                    <div className="admin-metric"><span>Needs review</span><strong>{formatCount(blockedCount)}</strong></div>
                    <div className="admin-metric"><span>Not checked</span><strong>{formatCount(preflight.rowsNotInspected)}</strong></div>
                  </div>
                  {coordinateConflictCount > 0 ? (
                    <div className="admin-conflict-review" style={{ marginTop: 14 }}>
                      <div className="admin-alert admin-alert--warning" role="status">
                        {formatCount(coordinateConflictCount)} approved records overlap another record from the same source with a different name. Review these before importing; they may represent a duplicate or a replacement.
                      </div>
                      <div className="admin-inline-actions" style={{ marginTop: 10 }}>
                        <button className="admin-button admin-button--quiet" type="button" onClick={loadConflictRows} disabled={conflictLoading}>
                          {conflictLoading ? 'Loading conflicts…' : conflictRows ? 'Refresh conflict list' : 'Show conflict list'}
                        </button>
                        <span className="admin-system-copy">Read-only. Opening a source does not change either place.</span>
                      </div>
                      {conflictRows?.available === false ? <div className="admin-alert admin-alert--warning" style={{ marginTop: 10 }}>Local source review data is unavailable.</div> : null}
                      {conflictRows?.available !== false && conflictRows?.data?.length ? (
                        <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                          <table className="admin-table">
                            <caption className="admin-sr-only">Accepted source records with same-source coordinate conflicts</caption>
                            <thead><tr><th>Source record</th><th>Other accepted record</th><th>Distance</th><th>Inspect</th></tr></thead>
                            <tbody>
                              {conflictRows.data.map(row => (
                                <tr key={row.id}>
                                  <td><strong>{row.source_name || row.source_id || 'Unnamed source'}</strong><small className="admin-table__subtext">{sourceLabel(row.source)} · #{row.id}</small></td>
                                  <td><strong>{row.conflict_source_name || 'Unnamed source'}</strong><small className="admin-table__subtext">#{row.conflict_id}</small></td>
                                  <td>{Math.round(Number(row.conflict_distance_m) || 0)} m</td>
                                  <td>{row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer">Source</a> : 'No source link'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {Number(conflictRows.total) > conflictRows.data.length ? <p className="admin-system-copy">Showing {conflictRows.data.length} of {formatCount(conflictRows.total)} conflicts. Resolve these through the existing source-review safeguards before importing.</p> : null}
                        </div>
                      ) : null}
                      {conflictRows && conflictRows.available !== false && !conflictRows.data?.length ? <p className="admin-system-copy">No accepted conflicts are currently visible in the queue.</p> : null}
                    </div>
                  ) : null}
                  <div className="admin-inline-actions" style={{ marginTop: 14 }}>
                    <button
                      className="admin-button admin-button--primary"
                      type="button"
                      disabled={!Number(preflight.candidateReady)}
                      onClick={() => setConfirmCount(Number(preflight.candidateReady) || 0)}
                    >
                      Import {formatCount(preflight.candidateReady)} ready
                    </button>
                    <button className="admin-button admin-button--quiet" type="button" onClick={() => setShowPreview(value => !value)}>
                      {showPreview ? 'Hide checked records' : 'Inspect checked records'}
                    </button>
                  </div>

                  {showPreview && preflightCandidates.length ? (
                    <div style={{ marginTop: 16 }}>
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Status</th>
                              <th>Candidate</th>
                              <th>Address</th>
                              <th>Nearest place</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleCandidates.map(row => (
                              <tr key={row.review_id || row.id}>
                                <td>{humanReadiness(row.readiness)}</td>
                                <td>{row.canonical_name || row.source_name || 'Untitled place'}</td>
                                <td>{row.address || 'No address'}</td>
                                <td>{row.nearest_place_name ? `${row.nearest_place_name} (${Math.round(Number(row.nearest_distance_m) || 0)} m)` : 'None nearby'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {previewPageCount > 1 ? (
                        <div className="admin-inline-actions" style={{ marginTop: 10 }}>
                          <button className="admin-button admin-button--icon" type="button" onClick={() => setPreviewPage(value => value - 1)} disabled={previewPage <= 0} aria-label="Previous preview page">
                            <ChevronLeft size={18} aria-hidden="true" />
                          </button>
                          <span className="admin-progress">Page {previewPage + 1} of {previewPageCount}</span>
                          <button className="admin-button admin-button--icon" type="button" onClick={() => setPreviewPage(value => value + 1)} disabled={previewPage >= previewPageCount - 1} aria-label="Next preview page">
                            <ChevronRight size={18} aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </details>

          <details className="admin-system-section">
            <summary>
              <strong>Provenance and match statistics</strong>
              <span>{formatCount(matchMethods.reduce((sum, row) => sum + (Number(row.rows) || 0), 0))} matched records</span>
            </summary>
            <div className="admin-system-section__body">
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>How it matched</th>
                      <th>Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchMethods.map(row => (
                      <tr key={`${row.source}-${row.match_method}`}>
                        <td>{sourceLabel(row.source)}</td>
                        <td>{String(row.match_method || 'Unknown').replace(/_/g, ' ')}</td>
                        <td>{formatCount(row.rows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <details className="admin-system-section">
            <summary>
              <strong>Policies and developer diagnostics</strong>
              <span>Technical reference</span>
            </summary>
            <div className="admin-system-section__body">
              <h3>Field promotion policy</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Fields</th><th>Policy</th></tr>
                  </thead>
                  <tbody>
                    {promotionPolicyRows.map(([fields, policy]) => (
                      <tr key={fields}><td>{fields}</td><td>{policy}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-alert" style={{ marginTop: 14 }}>
                Human review stays in this app. Source setup, provider credentials, and adapter operations belong to the external pipeline.
              </div>
            </div>
          </details>
        </>
      ) : null}

      <AdminConfirmDialog
        open={Boolean(confirmCount)}
        title={`Import ${formatCount(confirmCount)} approved places?`}
        message={'The duplicate check will run again. Only records that are still ready will be added to the local canonical map.\n\nThis does not publish anything to Supabase.'}
        confirmLabel={importBusy ? 'Importing…' : 'Import ready places'}
        onCancel={() => setConfirmCount(0)}
        onConfirm={runImport}
      />
      <AdminConfirmDialog
        open={Boolean(lifecycleConfirmation)}
        title="Mark this place closed?"
        message={lifecycleConfirmation
          ? `Mark ${lifecycleConfirmation.name || 'this place'} as closed in the local map? The source evidence and personal review history will be kept.\n\nThis is a local editorial decision and will be included in the next guarded Supabase sync.`
          : ''}
        confirmLabel={lifecycleBusy ? 'Saving…' : 'Mark closed'}
        onCancel={() => setLifecycleConfirmation(null)}
        onConfirm={markClosed}
      />
    </div>
  )
}
