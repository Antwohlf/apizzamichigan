import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { humanReadiness, sourceLabel } from './sourceReviewQueues'

const PREVIEW_PAGE_SIZE = 10
const numberFormat = new Intl.NumberFormat()
const formatCount = value => numberFormat.format(Number(value) || 0)
const formatDate = value => {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

const promotionPolicyRows = [
  ['Website and phone', 'Fill blanks only from accepted, high-confidence evidence.'],
  ['Menu, email, social links, hours, service options', 'Keep as source evidence until normalization and conflict rules exist.'],
  ['Name, address, coordinates, state, brand', 'Require review before changing place identity.'],
  ['Style and price', 'Classifier or editorial fields; source adapters do not overwrite them.'],
  ['Rating, notes, status, photos', 'Manual editorial fields only.'],
]

function ImportConfirmation({ count, busy, onCancel, onConfirm }) {
  if (!count) return null
  return (
    <div className="admin-modal" role="presentation">
      <button className="admin-scrim" type="button" onClick={onCancel} aria-label="Cancel import" />
      <section className="admin-modal__panel" role="dialog" aria-modal="true" aria-labelledby="import-confirm-title">
        <h2 id="import-confirm-title">Import {formatCount(count)} approved places?</h2>
        <p>
          The duplicate check will run again. Only records that are still ready will be added to the local canonical map.
          This does not publish anything to Supabase.
        </p>
        <div className="admin-modal__actions">
          <button className="admin-button admin-button--quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="admin-button admin-button--primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Importing…' : 'Import ready places'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function AdminSystemPanel({ entity }) {
  const [payload, setPayload] = useState(null)
  const [lifecycle, setLifecycle] = useState(null)
  const [preflight, setPreflight] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [previewPage, setPreviewPage] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [confirmCount, setConfirmCount] = useState(0)
  const [importBusy, setImportBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [provenanceResponse, preflightResponse, summaryResponse] = await Promise.all([
          fetch(`/api/admin/source-provenance?entity=${entity}`, { credentials: 'include' }),
          fetch(`/api/admin/source-review-queue/import-preflight?entity=${entity}&limit=100&nearbyRadiusM=150`, { credentials: 'include' }),
          fetch(`/api/admin/source-review-summary?entity=${entity}`, { credentials: 'include' }),
        ])
        if (!provenanceResponse.ok) throw new Error(await provenanceResponse.text() || 'Source status is unavailable.')
        if (!preflightResponse.ok) throw new Error(await preflightResponse.text() || 'Import check is unavailable.')
        const [provenancePayload, preflightPayload, summaryPayload] = await Promise.all([
          provenanceResponse.json(),
          preflightResponse.json(),
          summaryResponse.json(),
        ])
        if (!cancelled) {
          setPayload(provenancePayload?.data || null)
          setPreflight(preflightPayload?.data || null)
          setLifecycle(summaryPayload?.data?.lifecycle || null)
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'System details could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setPreviewPage(0)
    load()
    return () => {
      cancelled = true
    }
  }, [entity, refreshKey])

  const database = payload?.database || {}
  const sourceRows = database.sourceCounts || []
  const matchMethods = database.matchMethods || []
  const preflightCandidates = preflight?.candidates || []
  const previewPageCount = Math.max(1, Math.ceil(preflightCandidates.length / PREVIEW_PAGE_SIZE))
  const visibleCandidates = preflightCandidates.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE)
  const blockedCount = Math.max(0, Number(preflight?.rowsInspected || 0) - Number(preflight?.candidateReady || 0))

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

      {!loading && payload ? (
        <>
          <details className="admin-system-section" id="lifecycle-quality">
            <summary>
              <strong>Business lifecycle watchlist</strong>
              <span>{formatCount(lifecycle?.replacements)} replacements</span>
            </summary>
            <div className="admin-system-section__body">
              <p className="admin-system-copy">
                These are source records that may represent a replacement or stale listing. Nothing is changed automatically.
              </p>
              <div className="admin-stat-grid">
                <div><strong>{formatCount(lifecycle?.replacements)}</strong><span>Possible replacements</span></div>
                <div><strong>{formatCount(lifecycle?.staleEvidence)}</strong><span>Stale evidence rows</span></div>
              </div>
              <button className="admin-button admin-button--quiet" type="button" onClick={() => window.location.assign(`/admin/reviews/data?entity=${entity}&queue=matches`)}>
                Review replacement candidates
              </button>
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
                        <th>Last update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceRows.map(row => (
                        <tr key={row.source}>
                          <td>{sourceLabel(row.source)}</td>
                          <td>{formatCount(row.rows)}</td>
                          <td>{formatCount(row.places)}</td>
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
            defaultOpen={typeof window !== 'undefined' && window.location.hash === '#approved-import'}
          >
            <summary>
              <strong>Approved-place import</strong>
              <span>{formatCount(preflight?.acceptedTotal)} approved</span>
            </summary>
            <div className="admin-system-section__body">
              <p className="admin-task__detail">
                This check looks for duplicates again before any local place records are created.
              </p>
              <div className="admin-metric-row">
                <div className="admin-metric"><span>Approved</span><strong>{formatCount(preflight?.acceptedTotal)}</strong></div>
                <div className="admin-metric"><span>Ready</span><strong>{formatCount(preflight?.candidateReady)}</strong></div>
                <div className="admin-metric"><span>Needs review</span><strong>{formatCount(blockedCount)}</strong></div>
                <div className="admin-metric"><span>Not checked</span><strong>{formatCount(preflight?.rowsNotInspected)}</strong></div>
              </div>
              <div className="admin-inline-actions" style={{ marginTop: 14 }}>
                <button
                  className="admin-button admin-button--primary"
                  type="button"
                  disabled={!Number(preflight?.candidateReady)}
                  onClick={() => setConfirmCount(Number(preflight?.candidateReady) || 0)}
                >
                  Import {formatCount(preflight?.candidateReady)} ready
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
                Source evidence remains local. Raw setup commands and adapter operations stay in project scripts and documentation.
              </div>
              {payload.fsqSample?.missing?.length ? (
                <div className="admin-alert admin-alert--warning" style={{ marginTop: 10 }}>
                  Foursquare sample setup still needs attention: {payload.fsqSample.missing.join('; ')}
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : null}

      <ImportConfirmation
        count={confirmCount}
        busy={importBusy}
        onCancel={() => setConfirmCount(0)}
        onConfirm={runImport}
      />
    </div>
  )
}
