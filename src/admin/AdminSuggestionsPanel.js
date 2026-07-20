import React, { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ExternalLink, Search } from 'lucide-react'

const STATUS_OPTIONS = [
  { id: 'pending', label: 'To review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

const formatDate = value => {
  if (!value) return 'Unknown date'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function useModalEscape(onCancel) {
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])
}

function RejectDialog({ suggestion, reason, busy, onReasonChange, onCancel, onConfirm }) {
  useModalEscape(onCancel)
  if (!suggestion) return null
  return (
    <div className="admin-modal" role="presentation">
      <button className="admin-scrim" type="button" onClick={onCancel} aria-label="Cancel rejection" />
      <section className="admin-modal__panel" role="dialog" aria-modal="true" aria-labelledby="suggestion-reject-title">
        <h2 id="suggestion-reject-title">Reject {suggestion.name}?</h2>
        <p>This removes the suggestion from the active inbox. Add a reason when it will help explain the decision later.</p>
        <label className="admin-field">
          <span>Reason (optional)</span>
          <textarea value={reason} onChange={event => onReasonChange(event.target.value)} autoFocus />
        </label>
        <div className="admin-modal__actions">
          <button className="admin-button admin-button--quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="admin-button admin-button--danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Rejecting…' : 'Reject suggestion'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function AdminSuggestionsPanel({ entity }) {
  const [status, setStatus] = useState('pending')
  const [suggestions, setSuggestions] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    setStatus('pending')
    setSelectedId(null)
    setSearch('')
  }, [entity])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      setMessage('')
      try {
        const response = await fetch(`/api/admin/suggestions?entity=${entity}&status=${status}`, { credentials: 'include' })
        if (!response.ok) throw new Error(await response.text() || 'Failed to load suggestions.')
        const payload = await response.json()
        if (!cancelled) setSuggestions(Array.isArray(payload?.data) ? payload.data : [])
      } catch (err) {
        if (!cancelled) {
          setSuggestions([])
          setError(err?.message || 'Failed to load suggestions.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [entity, status])

  const filteredSuggestions = useMemo(() => {
    const terms = String(search || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return suggestions
    return suggestions.filter(item => {
      const text = [
        item.name,
        item.formatted_address,
        item.location_text,
        item.user_name,
        item.recommendation,
        item.notes,
        item.description,
      ].filter(Boolean).join(' ').toLowerCase()
      return terms.every(term => text.includes(term))
    })
  }, [search, suggestions])

  useEffect(() => {
    if (!filteredSuggestions.length) {
      setSelectedId(null)
    } else if (!filteredSuggestions.some(item => item.id === selectedId)) {
      setSelectedId(filteredSuggestions[0].id)
    }
  }, [filteredSuggestions, selectedId])

  const selectedIndex = useMemo(
    () => filteredSuggestions.findIndex(item => item.id === selectedId),
    [filteredSuggestions, selectedId]
  )
  const selected = selectedIndex >= 0 ? filteredSuggestions[selectedIndex] : null
  const visibleSuggestions = filteredSuggestions.slice(Math.max(0, selectedIndex - 3), Math.max(8, selectedIndex + 5)).slice(0, 8)
  const selectOffset = offset => {
    const next = filteredSuggestions[selectedIndex + offset]
    if (next) setSelectedId(next.id)
  }

  const removeSelected = updated => {
    setSuggestions(current => current.filter(item => item.id !== updated.id))
    setSelectedId(null)
  }

  const approve = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/suggestions/${selected.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      if (!response.ok) throw new Error(await response.text() || 'Approval failed.')
      const payload = await response.json()
      if (payload?.data) removeSelected(payload.data)
      setMessage(`Approved ${selected.name}.`)
    } catch (err) {
      setError(err?.message || 'Approval failed.')
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!rejecting || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/suggestions/${rejecting.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: rejectReason.trim() }),
      })
      if (!response.ok) throw new Error(await response.text() || 'Rejection failed.')
      const payload = await response.json()
      if (payload?.data) removeSelected(payload.data)
      setMessage(`Rejected ${rejecting.name}.`)
      setRejecting(null)
      setRejectReason('')
    } catch (err) {
      setError(err?.message || 'Rejection failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-content">
      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={17} aria-hidden="true" />
          <input
            className="admin-search-input"
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search name, city, or submitter"
            aria-label="Find suggestion"
          />
        </div>
        <div className="admin-toolbar__spacer" />
        <span className="admin-progress">{filteredSuggestions.length} found</span>
      </div>
      <div className="admin-queue-tabs" role="tablist" aria-label="Suggestion status">
        {STATUS_OPTIONS.map(option => (
          <button
            className={`admin-queue-tab${status === option.id ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={status === option.id}
            key={option.id}
            onClick={() => {
              setStatus(option.id)
              setSelectedId(null)
              setSearch('')
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {message ? <div className="admin-alert admin-alert--success" role="status">{message}</div> : null}
      {error ? <div className="admin-alert admin-alert--error" role="alert">{error}</div> : null}
      {loading ? <div className="admin-alert" role="status">Loading suggestions…</div> : null}
      {!loading && !error && !selected ? (
        <div className="admin-empty">
          <Check size={24} aria-hidden="true" />
          <p>{suggestions.length ? 'No suggestions match this search.' : 'No suggestions in this view.'}</p>
        </div>
      ) : null}

      {!loading && selected ? (
        <div className="admin-split">
          <aside aria-label="Suggestions">
            <div className="admin-result-list">
              {visibleSuggestions.map(item => (
                <button
                  className={`admin-result-item${item.id === selected.id ? ' is-active' : ''}`}
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={item.id === selected.id}
                >
                  <strong>{item.name}</strong>
                  <span>{item.formatted_address || item.location_text || 'No address'}</span>
                </button>
              ))}
            </div>
          </aside>

          <section>
            <div className="admin-selected-header">
              <div>
                <div className="admin-progress">{selectedIndex + 1} of {filteredSuggestions.length} · Submitted {formatDate(selected.created_at)}</div>
                <h2>{selected.name}</h2>
                <p>{selected.formatted_address || selected.location_text || 'No address provided'}</p>
              </div>
              <div className="admin-inline-actions">
                <button
                  className="admin-button admin-button--icon"
                  type="button"
                  onClick={() => selectOffset(-1)}
                  disabled={selectedIndex <= 0}
                  aria-label="Previous suggestion"
                  title="Previous"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button
                  className="admin-button admin-button--icon"
                  type="button"
                  onClick={() => selectOffset(1)}
                  disabled={selectedIndex >= filteredSuggestions.length - 1}
                  aria-label="Next suggestion"
                  title="Next"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
                <span className="admin-status-badge">{selected.status}</span>
              </div>
            </div>

            <dl className="admin-data-list">
              <ComparisonRow label="Submitted by" value={selected.user_name || 'Anonymous'} />
              <ComparisonRow label="What to order" value={selected.recommendation} />
              <ComparisonRow label="Notes" value={selected.notes || selected.description} />
              {selected.rejection_reason ? <ComparisonRow label="Rejection reason" value={selected.rejection_reason} /> : null}
            </dl>

            {selected.google_maps_url || selected.url ? (
              <div className="admin-external-links">
                <a href={selected.google_maps_url || selected.url} target="_blank" rel="noreferrer">
                  Open place <ExternalLink size={13} aria-hidden="true" />
                </a>
              </div>
            ) : null}

            {status === 'pending' ? (
              <div className="admin-decision-bar">
                <div className="admin-decision-bar__primary">
                  <button className="admin-button admin-button--primary" type="button" onClick={approve} disabled={busy}>Approve</button>
                </div>
                <div className="admin-decision-bar__secondary">
                  <button
                    className="admin-button admin-button--danger"
                    type="button"
                    onClick={() => {
                      setRejecting(selected)
                      setRejectReason('')
                    }}
                    disabled={busy}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <RejectDialog
        suggestion={rejecting}
        reason={rejectReason}
        busy={busy}
        onReasonChange={setRejectReason}
        onCancel={() => {
          setRejecting(null)
          setRejectReason('')
        }}
        onConfirm={reject}
      />
    </div>
  )
}

function ComparisonRow({ label, value }) {
  return (
    <div className="admin-data-row">
      <dt>{label}</dt>
      <dd>{value || 'Not provided'}</dd>
    </div>
  )
}
