import React, { useEffect, useMemo, useState } from 'react'

const STATUS_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

const STATUS_COLORS = {
  pending: '#fbbf24',
  approved: '#34d399',
  rejected: '#f87171',
}

const formatDateTime = value => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch (err) {
    return value
  }
}

export default function AdminSuggestionsPanel({ entity }) {
  const [statusFilter, setStatusFilter] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [actionState, setActionState] = useState({})
  const [message, setMessage] = useState('')

  const showActions = statusFilter === 'pending'

  useEffect(() => {
    setStatusFilter('pending')
  }, [entity])

  const headerCopy = useMemo(() => {
    if (statusFilter === 'approved') {
      return 'Places that have already been greenlit.'
    }
    if (statusFilter === 'rejected') {
      return 'Suggestions that were turned down (with the reason).'
    }
    return 'Incoming suggestions that still need review.'
  }, [statusFilter])

  const fetchSuggestions = useMemo(
    () => async () => {
      setLoading(true)
      setError('')
      setMessage('')
      try {
        const params = new URLSearchParams({ status: statusFilter })
        if (entity) {
          params.set('entity', entity)
        }
        const res = await fetch(`/api/admin/suggestions?${params.toString()}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to load suggestions.')
        }
        const payload = await res.json()
        if (!Array.isArray(payload?.data)) {
          throw new Error('Unexpected response from server')
        }
        setSuggestions(payload.data)
      } catch (err) {
        console.error('[admin] fetch suggestions error', err)
        setError(err?.message || 'Unable to load suggestions right now.')
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    },
    [entity, statusFilter]
  )

  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions])

  const updateAfterAction = updated => {
    setSuggestions(prev => {
      if (!Array.isArray(prev)) return []
      if (updated.status !== statusFilter) {
        return prev.filter(item => item.id !== updated.id)
      }
      return prev.map(item => (item.id === updated.id ? updated : item))
    })
  }

  const handleApprove = async suggestion => {
    setActionState(prev => ({ ...prev, [suggestion.id]: 'approving' }))
    setError('')
    setMessage('')
    try {
      const res = await fetch(`/api/admin/suggestions/${suggestion.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Approval failed.')
      }
      const payload = await res.json()
      if (payload?.data) {
        updateAfterAction(payload.data)
        setMessage(`Approved "${payload.data.name}" and created a location record.`)
      }
    } catch (err) {
      console.error('[admin] approve suggestion error', err)
      setError(err?.message || 'Unable to approve this suggestion.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next[suggestion.id]
        return next
      })
    }
  }

  const handleReject = async suggestion => {
    if (typeof window === 'undefined') {
      return
    }
    const reason = window.prompt('Why are you rejecting this suggestion?', '')
    if (reason === null) return

    setActionState(prev => ({ ...prev, [suggestion.id]: 'rejecting' }))
    setError('')
    setMessage('')
    try {
      const res = await fetch(`/api/admin/suggestions/${suggestion.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Rejection failed.')
      }
      const payload = await res.json()
      if (payload?.data) {
        updateAfterAction(payload.data)
        setMessage(`Rejected "${payload.data.name}".`)
      }
    } catch (err) {
      console.error('[admin] reject suggestion error', err)
      setError(err?.message || 'Unable to reject this suggestion.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next[suggestion.id]
        return next
      })
    }
  }

  return (
    <div
      style={{
        border: '1px solid rgba(148, 163, 184, 0.25)',
        borderRadius: 16,
        background: '#161b20',
        padding: '1.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#f97316' }}>Suggestions</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#94a3b8', fontSize: '0.95rem' }}>{headerCopy}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(option => {
            const active = statusFilter === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: 999,
                  border: active ? '1px solid #f97316' : '1px solid #374151',
                  background: active ? '#f97316' : 'transparent',
                  color: active ? '#fff' : '#cbd5f5',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {message && <p style={{ marginTop: '1rem', color: '#34d399' }}>{message}</p>}
      {error && <p style={{ marginTop: '1rem', color: '#f87171' }}>{error}</p>}
      {loading && <p style={{ marginTop: '1rem', color: '#fbbf24' }}>Loading suggestions…</p>}

      {!loading && !error && suggestions.length === 0 && (
        <p style={{ marginTop: '1.25rem', color: '#94a3b8' }}>No suggestions in this bucket right now.</p>
      )}

      {!loading && !error && suggestions.length > 0 && (
        <div style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#cbd5f5', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <th style={{ paddingBottom: '0.75rem' }}>Name</th>
                <th style={{ paddingBottom: '0.75rem' }}>Address</th>
                <th style={{ paddingBottom: '0.75rem' }}>Submitted</th>
                <th style={{ paddingBottom: '0.75rem' }}>Recommendation</th>
                <th style={{ paddingBottom: '0.75rem' }}>Status</th>
                <th style={{ paddingBottom: '0.75rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map(suggestion => {
                const pendingAction = actionState[suggestion.id]
                const statusColor = STATUS_COLORS[suggestion.status] || '#e2e8f0'
                return (
                  <tr key={suggestion.id} style={{ borderTop: '1px solid rgba(148, 163, 184, 0.15)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, color: '#f8fafc' }}>{suggestion.name}</div>
                      {suggestion.user_name && (
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>By {suggestion.user_name}</div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', verticalAlign: 'top', color: '#cbd5f5' }}>
                      {suggestion.formatted_address || suggestion.location_text || '—'}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', verticalAlign: 'top', color: '#94a3b8' }}>
                      {formatDateTime(suggestion.created_at)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', verticalAlign: 'top', color: '#f1f5f9' }}>
                      {suggestion.recommendation || '—'}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', verticalAlign: 'top' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.5rem',
                          borderRadius: 999,
                          background: `${statusColor}22`,
                          color: statusColor,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {suggestion.status}
                      </span>
                      {suggestion.status === 'rejected' && suggestion.rejection_reason && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#f87171' }}>
                          {suggestion.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', verticalAlign: 'top' }}>
                      {showActions ? (
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => handleApprove(suggestion)}
                            disabled={Boolean(pendingAction)}
                            style={{
                              padding: '0.4rem 0.8rem',
                              borderRadius: 6,
                              border: '1px solid #34d399',
                              background: pendingAction === 'approving' ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                              color: '#34d399',
                              fontWeight: 600,
                              cursor: pendingAction ? 'progress' : 'pointer',
                            }}
                          >
                            {pendingAction === 'approving' ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(suggestion)}
                            disabled={Boolean(pendingAction)}
                            style={{
                              padding: '0.4rem 0.8rem',
                              borderRadius: 6,
                              border: '1px solid #f87171',
                              background: pendingAction === 'rejecting' ? 'rgba(248, 113, 113, 0.2)' : 'transparent',
                              color: '#f87171',
                              fontWeight: 600,
                              cursor: pendingAction ? 'progress' : 'pointer',
                            }}
                          >
                            {pendingAction === 'rejecting' ? 'Rejecting…' : 'Reject'}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>No actions available</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
