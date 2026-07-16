import React, { useEffect, useMemo, useState } from 'react'

const numberFormat = new Intl.NumberFormat()

const formatCount = value => numberFormat.format(Number(value) || 0)

const formatDateTime = value => {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'n/a'
  return date.toLocaleString()
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
