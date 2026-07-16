import React, { useEffect, useMemo, useState } from 'react'

const numberFormat = new Intl.NumberFormat()
const REVIEW_STATUS_OPTIONS = ['pending', 'accepted', 'linked', 'rejected', 'ignored']
const REVIEW_KIND_OPTIONS = [
  { value: '', label: 'All kinds' },
  { value: 'ambiguous', label: 'Ambiguous' },
  { value: 'likely_new', label: 'Likely new' },
]
const QUEUE_PAGE_SIZE = 25

const formatCount = value => numberFormat.format(Number(value) || 0)

const formatDateTime = value => {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'n/a'
  return date.toLocaleString()
}

const safeHttpUrl = value => {
  if (!value || typeof value !== 'string') return ''
  if (!/^https?:\/\//i.test(value)) return ''
  return value
}

const googleMapsSearchUrl = row => {
  const query = [
    row?.source_name,
    row?.source_data?.address || row?.source_data?.['addr:full'],
  ].filter(Boolean).join(' ').trim()
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : ''
}

const sourceCoordinate = (row, keys) => {
  for (const key of keys) {
    const value = Number(row?.source_data?.[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

const sourceCoordinatePair = row => {
  const lat = sourceCoordinate(row, ['lat', 'latitude'])
  const lng = sourceCoordinate(row, ['lng', 'lon', 'longitude'])
  return lat !== null && lng !== null ? { lat, lng } : null
}

const googleMapsCoordinateUrl = coords =>
  coords ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}` : ''

const osmUrl = value => {
  if (!value || typeof value !== 'string' || !value.startsWith('osm:')) return ''
  const [, rawId] = value.split(':')
  const [type, id] = String(rawId || '').split('/')
  if (!type || !id) return ''
  const normalizedType = type === 'node' || type === 'way' || type === 'relation' ? type : ''
  return normalizedType ? `https://www.openstreetmap.org/${normalizedType}/${encodeURIComponent(id)}` : ''
}

const panelStyle = {
  display: 'grid',
  gap: '1rem',
}

const statGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0.75rem',
}

const blockStyle = {
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 12,
  background: '#171a1d',
  padding: '1rem',
}

const tableWrapStyle = {
  overflowX: 'auto',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 12,
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 720,
}

const thStyle = {
  padding: '0.7rem 0.85rem',
  textAlign: 'left',
  color: '#94a3b8',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
  whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '0.75rem 0.85rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
  color: '#e5e7eb',
  verticalAlign: 'top',
}

function SummaryStat({ label, value, tone = '#f8fafc' }) {
  return (
    <div style={blockStyle}>
      <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ marginTop: '0.35rem', color: tone, fontSize: '1.65rem', fontWeight: 800 }}>
        {value}
      </div>
    </div>
  )
}

function StatusMessage({ children, tone = '#94a3b8' }) {
  return (
    <div style={{ ...blockStyle, color: tone }}>
      {children}
    </div>
  )
}

export default function AdminSourceProvenancePanel({ entity }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [queueRows, setQueueRows] = useState([])
  const [queueTotal, setQueueTotal] = useState(0)
  const [queueStatus, setQueueStatus] = useState('pending')
  const [queueKind, setQueueKind] = useState('')
  const [queueSource, setQueueSource] = useState('')
  const [queueReportFile, setQueueReportFile] = useState('')
  const [queueSearch, setQueueSearch] = useState('')
  const [queuePage, setQueuePage] = useState(0)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [queueMessage, setQueueMessage] = useState('')
  const [actionState, setActionState] = useState({})

  useEffect(() => {
    let cancelled = false

    async function loadSources() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/admin/source-provenance?entity=${entity}`, { credentials: 'include' })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to load source provenance')
        }
        const data = await res.json()
        if (!cancelled) setPayload(data?.data || null)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load source provenance.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadSources()
    return () => {
      cancelled = true
    }
  }, [entity])

  useEffect(() => {
    let cancelled = false

    const timeoutId = setTimeout(async () => {
      setQueueLoading(true)
      setQueueError('')
      setQueueMessage('')
      try {
        const params = new URLSearchParams({
          entity,
          status: queueStatus,
          limit: String(QUEUE_PAGE_SIZE),
          offset: String(queuePage * QUEUE_PAGE_SIZE),
        })
        if (queueKind) params.set('kind', queueKind)
        if (queueSource) params.set('source', queueSource)
        if (queueReportFile) params.set('reportFile', queueReportFile)
        if (queueSearch.trim()) params.set('search', queueSearch.trim())
        const res = await fetch(`/api/admin/source-review-queue?${params.toString()}`, { credentials: 'include' })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to load review queue')
        }
        const data = await res.json()
        if (!cancelled) {
          setQueueRows(Array.isArray(data?.data) ? data.data : [])
          setQueueTotal(Number(data?.total) || 0)
        }
      } catch (err) {
        if (!cancelled) {
          setQueueError(err?.message || 'Failed to load review queue.')
          setQueueRows([])
          setQueueTotal(0)
        }
      } finally {
        if (!cancelled) setQueueLoading(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [entity, queueKind, queuePage, queueReportFile, queueSearch, queueSource, queueStatus])

  useEffect(() => {
    setQueuePage(0)
  }, [entity, queueKind, queueReportFile, queueSearch, queueSource, queueStatus])

  const recordDecision = async (row, status) => {
    let reviewerNotes = ''
    let canonicalPlaceId = ''

    if (typeof window !== 'undefined') {
      if (status === 'linked') {
        canonicalPlaceId = window.prompt('Canonical place id to link this source row to:', row.nearest_place_id || '') || ''
        if (!canonicalPlaceId) return
      }
      reviewerNotes = window.prompt(`Notes for ${status} decision:`, '') || ''
    }

    setActionState(prev => ({ ...prev, [row.id]: status }))
    setQueueError('')
    setQueueMessage('')
    try {
      const res = await fetch(`/api/admin/source-review-queue/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, canonicalPlaceId, reviewerNotes }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to update review row')
      }
      const data = await res.json()
      const updated = data?.data
      if (updated) {
        setQueueRows(prev => queueStatus === updated.status
          ? prev.map(item => (item.id === updated.id ? updated : item))
          : prev.filter(item => item.id !== updated.id)
        )
        setQueueTotal(prev => queueStatus === updated.status ? prev : Math.max(0, prev - 1))
        setQueueMessage(`Marked "${updated.source_name || updated.source_id}" as ${updated.status}.`)
      }
    } catch (err) {
      setQueueError(err?.message || 'Failed to update review row.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next[row.id]
        return next
      })
    }
  }

  const totals = useMemo(() => {
    const sourceRows = payload?.database?.sourceCounts || []
    const reviewTotals = payload?.reviewArtifacts?.totals || {}
    const pendingQueueRows = (payload?.database?.reviewQueue?.statusCounts || [])
      .filter(row => row.status === 'pending')
      .reduce((sum, row) => sum + (Number(row.rows) || 0), 0)
    return {
      sourceRows: sourceRows.reduce((sum, row) => sum + (Number(row.rows) || 0), 0),
      sourcePlaces: sourceRows.reduce((sum, row) => sum + (Number(row.places) || 0), 0),
      ambiguous: Number(reviewTotals.ambiguous) || 0,
      likelyNew: Number(reviewTotals.likelyNew) || 0,
      pendingQueueRows,
    }
  }, [payload])

  if (loading) {
    return <p style={{ color: '#fbbf24' }}>Loading source provenance…</p>
  }

  if (error) {
    return <StatusMessage tone="#f87171">{error}</StatusMessage>
  }

  if (!payload) {
    return <StatusMessage>No source provenance response loaded.</StatusMessage>
  }

  const database = payload.database || {}
  const reviewArtifacts = payload.reviewArtifacts || {}
  const reviewQueueCsv = payload.reviewQueueCsv || {}
  const pageCount = Math.max(1, Math.ceil(queueTotal / QUEUE_PAGE_SIZE))
  const pageStart = queueTotal === 0 ? 0 : queuePage * QUEUE_PAGE_SIZE + 1
  const pageEnd = Math.min(queueTotal, (queuePage + 1) * QUEUE_PAGE_SIZE)
  const queueSourceOptions = [...new Set((database.reviewQueue?.sourceCounts || []).map(row => row.source).filter(Boolean))].sort()
  const queueReportOptions = (reviewArtifacts.reports || [])
    .filter(row => row.source && (!queueSource || row.source === queueSource))
    .map(row => row.file)
    .filter(Boolean)
    .sort()

  return (
    <div style={panelStyle}>
      <StatusMessage>
        <strong style={{ color: '#f8fafc' }}>Local-only source evidence.</strong>{' '}
        {payload.syncPolicy}
      </StatusMessage>

      <div style={statGridStyle}>
        <SummaryStat label="Source Rows" value={formatCount(totals.sourceRows)} />
        <SummaryStat label="Linked Places" value={formatCount(totals.sourcePlaces)} />
        <SummaryStat label="Ambiguous Review" value={formatCount(totals.ambiguous)} tone="#fbbf24" />
        <SummaryStat label="Likely New Review" value={formatCount(totals.likelyNew)} tone="#fb923c" />
        <SummaryStat label="DB Queue Pending" value={formatCount(totals.pendingQueueRows)} tone="#38bdf8" />
      </div>

      {!database.available ? (
        <StatusMessage tone="#fbbf24">
          Local Postgres provenance is unavailable from this server: {database.reason || 'unknown reason'}
        </StatusMessage>
      ) : (
        <>
          <section style={blockStyle}>
            <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Source Counts</h2>
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Rows</th>
                    <th style={thStyle}>Places</th>
                    <th style={thStyle}>Latest Retrieved</th>
                    <th style={thStyle}>Latest Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(database.sourceCounts || []).map(row => (
                    <tr key={row.source}>
                      <td style={tdStyle}>{row.source}</td>
                      <td style={tdStyle}>{formatCount(row.rows)}</td>
                      <td style={tdStyle}>{formatCount(row.places)}</td>
                      <td style={tdStyle}>{formatDateTime(row.latest_retrieved_at)}</td>
                      <td style={tdStyle}>{formatDateTime(row.latest_updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={blockStyle}>
            <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Match Methods</h2>
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {(database.matchMethods || []).map(row => (
                    <tr key={`${row.source}-${row.match_method}`}>
                      <td style={tdStyle}>{row.source}</td>
                      <td style={tdStyle}>{row.match_method}</td>
                      <td style={tdStyle}>{formatCount(row.rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={blockStyle}>
            <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Durable Review Queue</h2>
            {!database.reviewQueue?.available ? (
              <p style={{ margin: 0, color: '#94a3b8' }}>source_review_queue is not created on this database yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Kind</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(database.reviewQueue.statusCounts || []).map(row => (
                        <tr key={`${row.review_kind}-${row.status}`}>
                          <td style={tdStyle}>{row.review_kind}</td>
                          <td style={tdStyle}>{row.status}</td>
                          <td style={tdStyle}>{formatCount(row.rows)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700, flex: '1 1 260px' }}>
                    Search
                    <input
                      type="search"
                      value={queueSearch}
                      onChange={event => setQueueSearch(event.target.value)}
                      placeholder="Name, address, website, phone, source id, report"
                      style={{ minWidth: 0, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700 }}>
                    Status
                    <select
                      value={queueStatus}
                      onChange={event => setQueueStatus(event.target.value)}
                      style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    >
                      {REVIEW_STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700 }}>
                    Kind
                    <select
                      value={queueKind}
                      onChange={event => setQueueKind(event.target.value)}
                      style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    >
                      {REVIEW_KIND_OPTIONS.map(option => (
                        <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700 }}>
                    Source
                    <select
                      value={queueSource}
                      onChange={event => {
                        setQueueSource(event.target.value)
                        setQueueReportFile('')
                      }}
                      style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    >
                      <option value="">All sources</option>
                      {queueSourceOptions.map(source => (
                        <option key={source} value={source}>{source}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700, flex: '1 1 220px' }}>
                    Report
                    <select
                      value={queueReportFile}
                      onChange={event => setQueueReportFile(event.target.value)}
                      style={{ minWidth: 0, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    >
                      <option value="">All reports</option>
                      {queueReportOptions.map(file => (
                        <option key={file} value={file}>{file.replace(/-review\.json$/, '')}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                    Showing {formatCount(pageStart)}-{formatCount(pageEnd)} of {formatCount(queueTotal)}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={queuePage === 0 || queueLoading}
                      onClick={() => setQueuePage(prev => Math.max(0, prev - 1))}
                      style={{ border: '1px solid #475569', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.55rem 0.75rem', fontWeight: 800, cursor: queuePage === 0 || queueLoading ? 'not-allowed' : 'pointer', opacity: queuePage === 0 || queueLoading ? 0.5 : 1 }}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={queuePage >= pageCount - 1 || queueLoading}
                      onClick={() => setQueuePage(prev => Math.min(pageCount - 1, prev + 1))}
                      style={{ border: '1px solid #475569', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.55rem 0.75rem', fontWeight: 800, cursor: queuePage >= pageCount - 1 || queueLoading ? 'not-allowed' : 'pointer', opacity: queuePage >= pageCount - 1 || queueLoading ? 0.5 : 1 }}
                    >
                      Next
                    </button>
                    {queueSearch || queueSource || queueReportFile ? (
                      <button
                        type="button"
                        onClick={() => {
                          setQueueSearch('')
                          setQueueSource('')
                          setQueueReportFile('')
                        }}
                        style={{ border: '1px solid #475569', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.55rem 0.75rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>

                {queueMessage ? <p style={{ margin: 0, color: '#34d399' }}>{queueMessage}</p> : null}
                {queueError ? <p style={{ margin: 0, color: '#f87171' }}>{queueError}</p> : null}
                {queueLoading ? <p style={{ margin: 0, color: '#fbbf24' }}>Loading review queue…</p> : null}

                {!queueLoading && !queueError && queueRows.length === 0 ? (
                  <p style={{ margin: 0, color: '#94a3b8' }}>No rows in this review bucket.</p>
                ) : null}

                {!queueLoading && queueRows.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {queueRows.map(row => {
                      const sourceAddress = row.source_data?.address || row.source_data?.['addr:full'] || ''
                      const sourceWebsite = safeHttpUrl(row.source_data?.website || row.source_data?.['contact:website'] || '')
                      const sourceUrl = safeHttpUrl(row.source_url || row.source_data?.source_url || '')
                      const sourceCoords = sourceCoordinatePair(row)
                      const mapsUrl = googleMapsCoordinateUrl(sourceCoords) || googleMapsSearchUrl(row)
                      const nearestOsmUrl = osmUrl(row.nearest_google_place_id)
                      const sourcePhone = row.source_data?.phone || row.source_data?.['contact:phone'] || ''
                      const busy = Boolean(actionState[row.id])
                      const canAcceptNew = row.review_kind === 'likely_new'
                      return (
                        <article key={row.id} style={{ border: '1px solid rgba(148, 163, 184, 0.16)', borderRadius: 10, padding: '0.9rem', background: '#101418' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                            <div>
                              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1rem' }}>{row.source_name || row.source_id}</h3>
                              <p style={{ margin: '0.25rem 0 0', color: '#94a3b8' }}>
                                {row.review_kind} · {row.source} · {row.source_id}
                              </p>
                            </div>
                            <div style={{ color: '#cbd5e1', fontWeight: 800 }}>{row.status}</div>
                          </div>
                          <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', color: '#cbd5e1' }}>
                            <div>
                              <strong style={{ color: '#f8fafc' }}>Source</strong>
                              <div>{sourceAddress || 'no address'}</div>
                              {sourceCoords ? (
                                <div>{sourceCoords.lat.toFixed(6)}, {sourceCoords.lng.toFixed(6)}</div>
                              ) : null}
                              {sourcePhone ? <div>{sourcePhone}</div> : null}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', marginTop: '0.35rem' }}>
                                {sourceWebsite ? <a href={sourceWebsite} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Website</a> : null}
                                {sourceUrl && sourceUrl !== sourceWebsite ? <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Source page</a> : null}
                                {mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Google Maps search</a> : null}
                              </div>
                            </div>
                            <div>
                              <strong style={{ color: '#f8fafc' }}>Nearest canonical</strong>
                              <div>{row.nearest_place_name || 'none'}</div>
                              <div>{row.nearest_place_id ? `id ${row.nearest_place_id}` : ''}</div>
                              <div>
                                {row.nearest_distance_m != null ? `${Number(row.nearest_distance_m).toFixed(1)}m` : 'no distance'}
                                {row.nearest_name_score != null ? ` · score ${Number(row.nearest_name_score).toFixed(2)}` : ''}
                              </div>
                              {nearestOsmUrl ? (
                                <div style={{ marginTop: '0.35rem' }}>
                                  <a href={nearestOsmUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Open nearest OSM row</a>
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <strong style={{ color: '#f8fafc' }}>Review</strong>
                              <div>{row.review_reason || 'n/a'}</div>
                              <div>{row.report_file || ''}</div>
                            </div>
                          </div>
                          {queueStatus === 'pending' ? (
                            <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              {canAcceptNew ? (
                                <button type="button" disabled={busy} onClick={() => recordDecision(row, 'accepted')} style={{ border: '1px solid #16a34a', borderRadius: 8, background: 'transparent', color: '#86efac', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: 'pointer' }}>Accept new</button>
                              ) : null}
                              <button type="button" disabled={busy} onClick={() => recordDecision(row, 'linked')} style={{ border: '1px solid #38bdf8', borderRadius: 8, background: 'transparent', color: '#7dd3fc', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: 'pointer' }}>Link</button>
                              <button type="button" disabled={busy} onClick={() => recordDecision(row, 'rejected')} style={{ border: '1px solid #f87171', borderRadius: 8, background: 'transparent', color: '#fca5a5', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: 'pointer' }}>Reject</button>
                              <button type="button" disabled={busy} onClick={() => recordDecision(row, 'ignored')} style={{ border: '1px solid #64748b', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: 'pointer' }}>Ignore</button>
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}

      <section style={blockStyle}>
        <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Review Artifacts</h2>
        {!reviewArtifacts.available ? (
          <p style={{ margin: 0, color: '#94a3b8' }}>No local review artifact directory found at {reviewArtifacts.inputDir}.</p>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Report</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Input</th>
                  <th style={thStyle}>Matched</th>
                  <th style={thStyle}>Ambiguous</th>
                  <th style={thStyle}>Likely New</th>
                  <th style={thStyle}>Accepted</th>
                </tr>
              </thead>
              <tbody>
                {(reviewArtifacts.reports || []).map(row => (
                  <tr key={row.file}>
                    <td style={tdStyle}>{row.file}</td>
                    <td style={tdStyle}>{row.sourceLabel || row.source}</td>
                    <td style={tdStyle}>{formatCount(row.inputRows)}</td>
                    <td style={tdStyle}>{formatCount(row.matched)}</td>
                    <td style={tdStyle}>{formatCount(row.ambiguous)}</td>
                    <td style={tdStyle}>{formatCount(row.likelyNew)}</td>
                    <td style={tdStyle}>{formatCount(row.accepted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: '0.9rem 0 0', color: '#94a3b8' }}>
          CSV queue: {reviewQueueCsv.available ? `${formatCount(reviewQueueCsv.reviewRows)} rows at ${reviewQueueCsv.path}` : `not found at ${reviewQueueCsv.path}`}
        </p>
      </section>
    </div>
  )
}
