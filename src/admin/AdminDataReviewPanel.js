import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  List,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import {
  SOURCE_REVIEW_QUEUES,
  humanReadiness,
  mapsUrl,
  safeExternalUrl,
  sourceAddress,
  canUpdateExactOsmPlace,
  canRecordBusinessReplacement,
  sourceCoordinates,
  sourceLabel,
  sourcePhone,
  sourceReviewQueue,
  sourceWebsite,
  deterministicMatchEvidence,
  valuesDiffer,
} from './sourceReviewQueues'

const PAGE_SIZE = 25
const numberFormat = new Intl.NumberFormat()
const SOURCE_OPTIONS = [
  ['', 'All sources'],
  ['all_the_places', 'Official chain websites'],
  ['osm', 'OpenStreetMap'],
  ['fsq_os_places', 'Foursquare Open Source Places'],
  ['overture_places', 'Overture Maps'],
  ['wikidata', 'Wikidata'],
]

const formatCount = value => numberFormat.format(Number(value) || 0)
const formatDistance = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'No distance available'
  if (number < 1000) return `${Math.round(number)} m away`
  return `${(number / 1000).toFixed(1)} km away`
}

const reviewEvidenceLabel = value => {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return ''
  if (count >= 3) return 'Several details agree'
  if (count === 2) return 'Two details agree'
  return 'One detail agrees'
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

const aiDecisionLabel = decision => ({
  same_place: 'Same place suggested',
  different_place: 'Different place suggested',
  business_replacement: 'Possible business replacement',
  uncertain: 'Needs human judgment',
}[decision] || 'AI suggestion')

export const reviewSuggestionSource = decisionOrigin => (
  decisionOrigin === 'deterministic'
    ? 'Evidence-based suggestion'
    : 'AI review suggestion'
)

function ComparisonRow({ label, value, different }) {
  return (
    <div className={`admin-data-row${different ? ' is-different' : ''}`}>
      <dt>{label}</dt>
      <dd>{value || 'Not available'}</dd>
    </div>
  )
}

function ConfirmationDialog({ row, busy, onCancel, onConfirm }) {
  useModalEscape(onCancel)
  if (!row) return null
  return (
    <div className="admin-modal" role="presentation">
      <button className="admin-scrim" type="button" onClick={onCancel} aria-label="Cancel linking" />
      <section
        className="admin-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-confirmation-title"
      >
        <h2 id="link-confirmation-title">Confirm this is the same place</h2>
        <p>
          Link <strong>{row.source_name || row.source_id}</strong> to{' '}
          <strong>{row.nearest_place_name || `place ${row.nearest_place_id}`}</strong>?
          The source evidence will be attached to the existing map record.
        </p>
        <p>
          The map name will remain{' '}
          <strong>{row.nearest_place_name || `place ${row.nearest_place_id}`}</strong>.
        </p>
        <div className="admin-modal__actions">
          <button className="admin-button admin-button--quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="admin-button admin-button--primary" type="button" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Linking…' : 'Confirm same place'}
          </button>
        </div>
      </section>
    </div>
  )
}

function UpdateExistingDialog({ row, busy, onCancel, onConfirm }) {
  useModalEscape(onCancel)
  if (!row) return null
  return (
    <div className="admin-modal" role="presentation">
      <button className="admin-scrim" type="button" onClick={onCancel} aria-label="Cancel place update" />
      <section
        className="admin-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-update-title"
      >
        <h2 id="place-update-title">Confirm this business replaced the old one</h2>
        <p>
          Update <strong>{row.nearest_place_name}</strong> to <strong>{row.source_name || row.source_id}</strong>?
          Both records use the same OpenStreetMap ID.
        </p>
        {row.nearest_lifecycle_status ? (
          <p>This place is marked {row.nearest_lifecycle_status}; it must remain historical and cannot be updated in place.</p>
        ) : null}
        <p>
          This replaces the name and current source details, clears stale enrichment, and marks the place for fresh enrichment.
          It does not change the map record ID. This action is available only for unreviewed places without a rating or notes.
        </p>
        <div className="admin-modal__actions">
          <button className="admin-button admin-button--quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="admin-button admin-button--primary" type="button" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Updating…' : `Update to ${row.source_name || 'new business'}`}
          </button>
        </div>
      </section>
    </div>
  )
}

function ReplacementDialog({ row, busy, onCancel, onConfirm }) {
  useModalEscape(onCancel)
  if (!row) return null
  return (
    <div className="admin-modal" role="presentation">
      <button className="admin-scrim" type="button" onClick={onCancel} aria-label="Cancel business replacement" />
      <section className="admin-modal__panel" role="dialog" aria-modal="true" aria-labelledby="replacement-title">
        <h2 id="replacement-title">Record a business replacement?</h2>
        <p>
          Keep <strong>{row.nearest_place_name}</strong> as a historical place and move
          <strong> {row.source_name || row.source_id}</strong> into the new-place workflow?
        </p>
        <p>The old place will be marked closed. You can then approve the new business separately.</p>
        <div className="admin-modal__actions">
          <button className="admin-button admin-button--quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="admin-button admin-button--primary" type="button" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Recording…' : 'Record replacement'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function AdminDataReviewPanel({ entity }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeQueue = sourceReviewQueue(searchParams.get('queue'))
  const searchText = searchParams.get('q') || ''
  const sourceFilter = searchParams.get('source') || ''
  const stateFilter = searchParams.get('state') || ''
  const focus = searchParams.get('focus') === 'all' ? 'all' : 'weekly'
  const selectedParam = searchParams.get('id') || ''
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [queueOpen, setQueueOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(Boolean(searchText))
  const [searchDraft, setSearchDraft] = useState(searchText)
  const [filterDraft, setFilterDraft] = useState({ source: sourceFilter, state: stateFilter })
  const [notes, setNotes] = useState('')
  const [linkConfirmation, setLinkConfirmation] = useState(null)
  const [updateConfirmation, setUpdateConfirmation] = useState(null)
  const [replacementConfirmation, setReplacementConfirmation] = useState(null)
  const [lastDecision, setLastDecision] = useState(null)
  const [history, setHistory] = useState({ open: false, loading: false, rows: [], error: '' })
  const [aiAssessment, setAiAssessment] = useState({ loading: false, data: null, error: '' })

  const setParamValues = patch => {
    const next = new URLSearchParams(searchParams)
    Object.entries(patch).forEach(([key, value]) => {
      if (value == null || value === '') next.delete(key)
      else next.set(key, String(value))
    })
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    setSearchDraft(searchText)
  }, [searchText])

  useEffect(() => {
    if (searchDraft === searchText) return undefined
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (searchDraft) next.set('q', searchDraft)
      else next.delete('q')
      next.delete('id')
      setSearchParams(next, { replace: true })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [searchDraft, searchText, searchParams, setSearchParams])

  useEffect(() => {
    let cancelled = false
    const summaryParams = new URLSearchParams({ entity })
    if (stateFilter) summaryParams.set('state', stateFilter)
    fetch(`/api/admin/source-review-summary?${summaryParams.toString()}`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) throw new Error('Queue summary is unavailable.')
        return response.json()
      })
      .then(payload => {
        if (!cancelled) setSummary(payload?.data || null)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [entity, refreshKey, stateFilter])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      setMessage('')
      try {
        const params = new URLSearchParams({
          entity,
          status: 'pending',
          kind: activeQueue.kind,
          readiness: activeQueue.readiness,
          focus,
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        })
        if (searchText) params.set('search', searchText)
        if (sourceFilter) params.set('source', sourceFilter)
        if (stateFilter) params.set('state', stateFilter)
        const response = await fetch(`/api/admin/source-review-queue?${params.toString()}`, { credentials: 'include' })
        if (!response.ok) throw new Error(await response.text() || 'Failed to load review queue.')
        const payload = await response.json()
        if (!cancelled) {
          setRows(Array.isArray(payload?.data) ? payload.data : [])
          setTotal(Number(payload?.total) || 0)
        }
      } catch (err) {
        if (!cancelled) {
          setRows([])
          setTotal(0)
          setError(err?.message || 'Failed to load review queue.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeQueue.kind, activeQueue.readiness, entity, focus, page, refreshKey, searchText, sourceFilter, stateFilter])

  useEffect(() => {
    setPage(0)
    setNotes('')
    setHistory({ open: false, loading: false, rows: [], error: '' })
  }, [activeQueue.id, entity, focus, searchText, sourceFilter, stateFilter])

  const selectedIndex = useMemo(() => {
    const requestedIndex = rows.findIndex(row => String(row.id) === selectedParam)
    return requestedIndex >= 0 ? requestedIndex : rows.length ? 0 : -1
  }, [rows, selectedParam])
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null

  useEffect(() => {
    if (selected && String(selected.id) !== selectedParam) {
      setParamValues({ id: selected.id })
    }
  // setParamValues intentionally reads the latest URL state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selectedParam])

  useEffect(() => {
    setNotes(selected?.reviewer_notes || '')
    setHistory({ open: false, loading: false, rows: [], error: '' })
  }, [selected?.id, selected?.reviewer_notes])

  useEffect(() => {
    let cancelled = false
    if (!selected) {
      setAiAssessment({ loading: false, data: null, error: '' })
      return () => { cancelled = true }
    }
    setAiAssessment({ loading: true, data: null, error: '' })
    fetch(`/api/admin/source-review-queue/${selected.id}/ai-assessment`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) throw new Error('AI suggestion is unavailable.')
        return response.json()
      })
      .then(payload => {
        if (!cancelled) setAiAssessment({ loading: false, data: payload?.data || null, error: '' })
      })
      .catch(error => {
        if (!cancelled) setAiAssessment({ loading: false, data: null, error: error?.message || 'AI suggestion is unavailable.' })
      })
    return () => { cancelled = true }
  }, [selected, refreshKey])

  const advanceAfter = rowId => {
    const remaining = rows.filter(row => String(row.id) !== String(rowId))
    setRows(remaining)
    setTotal(value => Math.max(0, value - 1))
    if (remaining.length) {
      const nextIndex = Math.min(selectedIndex, remaining.length - 1)
      setParamValues({ id: remaining[nextIndex].id })
    } else if ((page + 1) * PAGE_SIZE < total) {
      setRefreshKey(value => value + 1)
    } else if (page > 0) {
      setPage(value => Math.max(0, value - 1))
    } else {
      setParamValues({ id: null })
    }
  }

  const decide = async (row, status, canonicalPlaceId = null) => {
    if (!row || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/source-review-queue/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status,
          canonicalPlaceId,
          reviewerNotes: notes.trim() || null,
        }),
      })
      if (!response.ok) throw new Error(await response.text() || 'The review decision could not be saved.')
      setLastDecision(['accepted', 'rejected', 'ignored'].includes(status) ? { row, status } : null)
      setMessage(status === 'linked' ? 'Source linked to the existing place.' : 'Decision saved.')
      advanceAfter(row.id)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'The review decision could not be saved.')
    } finally {
      setBusy(false)
      setLinkConfirmation(null)
    }
  }

  const reclassify = async row => {
    if (!row || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/source-review-queue/${row.id}/reclassify-likely-new`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reviewerNotes: notes.trim() || null }),
      })
      if (!response.ok) throw new Error(await response.text() || 'The record could not be moved.')
      setMessage('Moved to the new-place review queue.')
      setLastDecision(null)
      advanceAfter(row.id)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'The record could not be moved.')
    } finally {
      setBusy(false)
    }
  }

  const updateExisting = async row => {
    if (!row || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/source-review-queue/${row.id}/update-existing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reviewerNotes: notes.trim() || null }),
      })
      if (!response.ok) throw new Error(await response.text() || 'The existing place could not be updated.')
      setLastDecision(null)
      setMessage('Existing place updated and marked for fresh enrichment.')
      advanceAfter(row.id)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'The existing place could not be updated.')
    } finally {
      setBusy(false)
      setUpdateConfirmation(null)
    }
  }

  const recordReplacement = async row => {
    if (!row || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/source-review-queue/${row.id}/reclassify-replacement`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reviewerNotes: notes.trim() || null }),
      })
      if (!response.ok) throw new Error(await response.text() || 'The replacement could not be recorded.')
      setMessage('Old place marked closed; new business moved to the approval queue.')
      setLastDecision(null)
      advanceAfter(row.id)
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'The replacement could not be recorded.')
    } finally {
      setBusy(false)
      setReplacementConfirmation(null)
    }
  }

  const undo = async () => {
    if (!lastDecision || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/source-review-queue/${lastDecision.row.id}/reopen`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reviewerNotes: 'Reopened from admin undo action' }),
      })
      if (!response.ok) throw new Error(await response.text() || 'Undo failed.')
      setLastDecision(null)
      setMessage('Decision undone.')
      setRefreshKey(value => value + 1)
    } catch (err) {
      setError(err?.message || 'Undo failed.')
    } finally {
      setBusy(false)
    }
  }

  const skip = () => {
    if (!selected) return
    setMessage('Skipped for now. No changes were saved.')
    setLastDecision(null)
    if (selectedIndex < rows.length - 1) {
      setParamValues({ id: rows[selectedIndex + 1].id })
    } else if ((page + 1) * PAGE_SIZE < total) {
      setPage(value => value + 1)
    } else if (rows.length > 1) {
      setParamValues({ id: rows[0].id })
    }
  }

  const loadHistory = async () => {
    if (!selected || history.loading) return
    if (history.open) {
      setHistory(current => ({ ...current, open: false }))
      return
    }
    setHistory({ open: true, loading: true, rows: [], error: '' })
    try {
      const response = await fetch(`/api/admin/source-review-queue/${selected.id}/history`, { credentials: 'include' })
      if (!response.ok) throw new Error('Decision history is unavailable.')
      const payload = await response.json()
      setHistory({ open: true, loading: false, rows: Array.isArray(payload?.data) ? payload.data : [], error: '' })
    } catch (err) {
      setHistory({ open: true, loading: false, rows: [], error: err?.message || 'Decision history is unavailable.' })
    }
  }

  const changeQueue = queueId => {
    setParamValues({ queue: queueId, id: null })
  }

  const applyFilters = () => {
    setParamValues({
      source: filterDraft.source,
      state: filterDraft.state.trim(),
      id: null,
    })
    setFiltersOpen(false)
  }

  const sourceCoords = sourceCoordinates(selected)
  const canonicalCoords = selected && Number.isFinite(Number(selected.nearest_lat)) && Number.isFinite(Number(selected.nearest_lng))
    ? { lat: Number(selected.nearest_lat), lng: Number(selected.nearest_lng) }
    : null
  const sourceAddressText = sourceAddress(selected)
  const sourcePhoneText = sourcePhone(selected)
  const sourceWebsiteText = safeExternalUrl(sourceWebsite(selected))
  const sourcePageUrl = safeExternalUrl(selected?.source_url || selected?.source_data?.source_url)
  const canonicalWebsite = safeExternalUrl(selected?.nearest_website_url)
  const sourceMapUrl = mapsUrl(sourceCoords)
  const canonicalMapUrl = mapsUrl(canonicalCoords)
  const activeCount = summary?.queues?.[activeQueue.countKey] ?? total
  const progressNumber = page * PAGE_SIZE + Math.max(0, selectedIndex) + 1
  const canUpdateExisting = canUpdateExactOsmPlace(selected)
  const deterministicEvidence = deterministicMatchEvidence(selected)
  const reviewScopeText = stateFilter === 'all'
    ? 'All regions'
    : stateFilter || (Array.isArray(summary?.reviewScope?.regions) ? summary.reviewScope.regions.join(', ') : 'active product regions')

  return (
    <div className="admin-content">
      <div className="admin-queue-tabs" role="tablist" aria-label="Data review queues">
        {SOURCE_REVIEW_QUEUES.map(queue => (
          <button
            className={`admin-queue-tab${queue.id === activeQueue.id ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={queue.id === activeQueue.id}
            key={queue.id}
            onClick={() => changeQueue(queue.id)}
          >
            {queue.label}
            <span className="admin-count-badge">{formatCount(summary?.queues?.[queue.countKey])}</span>
          </button>
        ))}
      </div>

      <p className="admin-scope-note">Review scope: <strong>{reviewScopeText}</strong></p>

      <div className="admin-toolbar">
        {searchOpen ? (
          <div className="admin-search-wrap">
            <Search size={17} aria-hidden="true" />
            <input
              className="admin-search-input"
              type="search"
              value={searchDraft}
              onChange={event => setSearchDraft(event.target.value)}
              placeholder="Search name, address, or website"
              autoFocus
              aria-label="Search review queue"
            />
          </div>
        ) : (
          <button className="admin-button admin-button--quiet" type="button" onClick={() => setSearchOpen(true)}>
            <Search size={16} aria-hidden="true" />
            Search
          </button>
        )}
        {searchOpen ? (
          <button
            className="admin-button admin-button--quiet admin-button--icon"
            type="button"
            onClick={() => {
              setSearchOpen(false)
              setParamValues({ q: null, id: null })
            }}
            aria-label="Close search"
            title="Close search"
          >
            <X size={17} aria-hidden="true" />
          </button>
        ) : null}
        <button className="admin-button admin-button--quiet" type="button" onClick={() => setFiltersOpen(true)}>
          <Filter size={16} aria-hidden="true" />
          Filters{sourceFilter || stateFilter ? ' · Active' : ''}
        </button>
        <button className="admin-button admin-button--quiet" type="button" onClick={() => setQueueOpen(true)}>
          <List size={16} aria-hidden="true" />
          Queue
        </button>
        <div className="admin-focus-switch" role="group" aria-label="Review workload">
          <button
            className={`admin-focus-switch__button${focus === 'weekly' ? ' is-active' : ''}`}
            type="button"
            aria-pressed={focus === 'weekly'}
            onClick={() => { setPage(0); setParamValues({ focus: 'weekly', id: null }) }}
          >
            This week <span>50 max</span>
          </button>
          <button
            className={`admin-focus-switch__button${focus === 'all' ? ' is-active' : ''}`}
            type="button"
            aria-pressed={focus === 'all'}
            onClick={() => { setPage(0); setParamValues({ focus: 'all', id: null }) }}
          >
            Full queue
          </button>
        </div>
        <div className="admin-toolbar__spacer" />
        <span className="admin-progress">{total ? `${Math.min(progressNumber, total)} of ${formatCount(total)}` : `${formatCount(activeCount)} remaining`}</span>
      </div>

      {message ? (
        <div className="admin-alert admin-alert--success" role="status">
          {message}
          {lastDecision ? (
            <button className="admin-button admin-button--quiet" type="button" onClick={undo} disabled={busy} style={{ marginLeft: 12 }}>
              <RotateCcw size={15} aria-hidden="true" />
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="admin-alert admin-alert--error" role="alert">{error}</div> : null}
      {loading ? <div className="admin-alert" role="status">Loading the next record…</div> : null}
      {!loading && !error && !selected ? (
        <div className="admin-empty">
          <Check size={24} aria-hidden="true" />
          <p>No records remain in this view.</p>
        </div>
      ) : null}

      {!loading && selected ? (
        <>
          <div className="admin-selected-header">
            <div>
              <div className="admin-progress">{sourceLabel(selected.source)} · {humanReadiness(selected.review_readiness)}</div>
              <p>{activeQueue.detail}</p>
              {reviewEvidenceLabel(selected.review_evidence_count) ? (
                <p className="admin-review-hint" aria-live="polite">
                  {reviewEvidenceLabel(selected.review_evidence_count)}; confirm the place below.
                </p>
              ) : null}
              {deterministicEvidence ? (
                <p className="admin-review-hint admin-review-hint--strong" aria-live="polite">
                  <strong>{deterministicEvidence.title}.</strong> {deterministicEvidence.detail}
                </p>
              ) : null}
            </div>
            <div className="admin-inline-actions">
              <button
                className="admin-button admin-button--icon"
                type="button"
                onClick={() => selectedIndex > 0 && setParamValues({ id: rows[selectedIndex - 1].id })}
                disabled={selectedIndex <= 0}
                aria-label="Previous record"
                title="Previous"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                className="admin-button admin-button--icon"
                type="button"
                onClick={skip}
                disabled={selectedIndex >= rows.length - 1 && (page + 1) * PAGE_SIZE >= total}
                aria-label="Next record"
                title="Next"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="admin-compare">
            <section className="admin-compare__column" aria-labelledby="source-record-title">
              <p className="admin-compare__eyebrow">Source record</p>
              <h2 id="source-record-title">{selected.source_name || selected.source_id}</h2>
              <p className="admin-compare__meta">{sourceLabel(selected.source)}</p>
              <dl className="admin-data-list">
                <ComparisonRow label="Address" value={sourceAddressText} different={valuesDiffer(sourceAddressText, selected.nearest_address)} />
                <ComparisonRow label="Phone" value={sourcePhoneText} different={valuesDiffer(sourcePhoneText, selected.nearest_phone)} />
                <ComparisonRow label="Website" value={sourceWebsiteText} different={valuesDiffer(sourceWebsiteText, selected.nearest_website_url)} />
              </dl>
              <div className="admin-external-links">
                {sourceWebsiteText ? <a href={sourceWebsiteText} target="_blank" rel="noreferrer">Website <ExternalLink size={13} /></a> : null}
                {sourcePageUrl && sourcePageUrl !== sourceWebsiteText ? <a href={sourcePageUrl} target="_blank" rel="noreferrer">Source page <ExternalLink size={13} /></a> : null}
                {sourceMapUrl ? <a href={sourceMapUrl} target="_blank" rel="noreferrer">Map <ExternalLink size={13} /></a> : null}
              </div>
            </section>

            <section className="admin-compare__column" aria-labelledby="canonical-record-title">
              <p className="admin-compare__eyebrow">Existing map record</p>
              <h2 id="canonical-record-title">{selected.nearest_place_name || 'No nearby place found'}</h2>
              <p className="admin-compare__meta">{selected.nearest_place_id ? formatDistance(selected.nearest_distance_m) : 'This source record has no suggested match.'}</p>
              {canUpdateExisting ? (
                <p className="admin-compare__notice">
                  Same OpenStreetMap record, different business name. Use “Update existing place” only when the old business has been replaced.
                </p>
              ) : null}
              <dl className="admin-data-list">
                <ComparisonRow label="Address" value={selected.nearest_address} different={valuesDiffer(sourceAddressText, selected.nearest_address)} />
                <ComparisonRow label="Phone" value={selected.nearest_phone} different={valuesDiffer(sourcePhoneText, selected.nearest_phone)} />
                <ComparisonRow label="Website" value={canonicalWebsite} different={valuesDiffer(sourceWebsiteText, canonicalWebsite)} />
              </dl>
              <div className="admin-external-links">
                {canonicalWebsite ? <a href={canonicalWebsite} target="_blank" rel="noreferrer">Website <ExternalLink size={13} /></a> : null}
                {canonicalMapUrl ? <a href={canonicalMapUrl} target="_blank" rel="noreferrer">Map <ExternalLink size={13} /></a> : null}
              </div>
            </section>
          </div>

          {aiAssessment.loading ? <div className="admin-ai-assessment" role="status">Loading review suggestion…</div> : null}
          {!aiAssessment.loading && aiAssessment.data ? (
            <aside className={`admin-ai-assessment admin-ai-assessment--${aiAssessment.data.decision || 'uncertain'}`} aria-label={reviewSuggestionSource(aiAssessment.data.decision_origin)}>
              <div>
                <strong>{reviewSuggestionSource(aiAssessment.data.decision_origin)}</strong>
                <span>{aiDecisionLabel(aiAssessment.data.decision)} · {Math.round(Number(aiAssessment.data.confidence || 0) * 100)}% confidence · human decision required</span>
              </div>
              <p>{aiAssessment.data.reason || 'No explanation was provided.'}</p>
              {Array.isArray(aiAssessment.data.supporting_evidence) && aiAssessment.data.supporting_evidence.length ? (
                <ul>
                  {aiAssessment.data.supporting_evidence.map(item => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </aside>
          ) : null}

          <details className="admin-details">
            <summary>Technical details</summary>
            <div className="admin-details__body">
              <div className="admin-code-grid">
                <div><strong>Source ID:</strong> {selected.source_id}</div>
                <div><strong>Canonical ID:</strong> {selected.nearest_place_id || 'None'}</div>
                <div><strong>Report:</strong> {selected.report_file || 'None'}</div>
                <div><strong>Name score:</strong> {selected.nearest_name_score == null ? 'None' : Number(selected.nearest_name_score).toFixed(2)}</div>
                <div><strong>Source coordinates:</strong> {sourceCoords ? `${sourceCoords.lat.toFixed(6)}, ${sourceCoords.lng.toFixed(6)}` : 'None'}</div>
                <div><strong>Match reason:</strong> {selected.review_reason || 'None'}</div>
              </div>
              <label className="admin-field">
                <span>Decision note (optional)</span>
                <textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add context for the audit history" />
              </label>
              <div>
                <button className="admin-button admin-button--quiet" type="button" onClick={loadHistory} disabled={history.loading}>
                  {history.open ? 'Hide decision history' : 'View decision history'}
                </button>
                {history.open ? (
                  <div style={{ marginTop: 10 }}>
                    {history.error ? history.error : null}
                    {!history.error && !history.rows.length && !history.loading ? 'No prior decisions.' : null}
                    {history.rows.map(entry => (
                      <div key={entry.id}>{entry.previous_status || 'pending'} → {entry.status} · {new Date(entry.created_at).toLocaleString()}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </details>

          <div className="admin-decision-bar" aria-label="Review actions">
            <div className="admin-decision-bar__primary">
              {selected.nearest_place_id ? (
                canUpdateExisting ? (
                  <>
                    <button className="admin-button admin-button--primary" type="button" onClick={() => setUpdateConfirmation(selected)} disabled={busy}>
                      Update existing place
                    </button>
                    <button className="admin-button" type="button" onClick={() => setLinkConfirmation(selected)} disabled={busy}>
                      Same place
                    </button>
                  </>
                ) : (
                  <>
                    <button className="admin-button admin-button--primary" type="button" onClick={() => setLinkConfirmation(selected)} disabled={busy}>
                      Same place
                    </button>
                    {activeQueue.id === 'matches' && canRecordBusinessReplacement(selected) ? (
                      <button className="admin-button" type="button" onClick={() => setReplacementConfirmation(selected)} disabled={busy}>
                        Business replaced
                      </button>
                    ) : null}
                  </>
                )
              ) : null}
              {activeQueue.id === 'matches' ? (
                <button className="admin-button" type="button" onClick={() => reclassify(selected)} disabled={busy}>
                  Different place
                </button>
              ) : null}
              {['duplicates', 'new'].includes(activeQueue.id) ? (
                <button className={`admin-button${selected.nearest_place_id ? '' : ' admin-button--primary'}`} type="button" onClick={() => decide(selected, 'accepted')} disabled={busy}>
                  Keep as new
                </button>
              ) : null}
            </div>
            <div className="admin-decision-bar__secondary">
              <button className="admin-button admin-button--danger" type="button" onClick={() => decide(selected, 'rejected')} disabled={busy}>
                Bad source data
              </button>
              <button className="admin-button admin-button--quiet" type="button" onClick={() => decide(selected, 'ignored')} disabled={busy}>
                Save for later
              </button>
              <button className="admin-button admin-button--quiet" type="button" onClick={skip} disabled={busy}>
                Skip
              </button>
            </div>
          </div>
        </>
      ) : null}

      {queueOpen ? (
        <>
          <button className="admin-scrim" type="button" onClick={() => setQueueOpen(false)} aria-label="Dismiss queue drawer" />
          <aside className="admin-drawer" aria-label="Current review queue">
            <div className="admin-drawer__header">
              <div>
                <h2>{activeQueue.label}</h2>
                <div className="admin-progress">{formatCount(total)} remaining</div>
              </div>
              <button className="admin-button admin-button--icon" type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="admin-result-list">
              {rows.map(row => (
                <button
                  className={`admin-result-item${selected?.id === row.id ? ' is-active' : ''}`}
                  type="button"
                  key={row.id}
                  onClick={() => {
                    setParamValues({ id: row.id })
                    setQueueOpen(false)
                  }}
                >
                  <strong>{row.source_name || row.source_id}</strong>
                  <span>{sourceLabel(row.source)} · {sourceAddress(row) || 'No address'}</span>
                </button>
              ))}
            </div>
            <div className="admin-inline-actions" style={{ marginTop: 14 }}>
              <button className="admin-button admin-button--icon" type="button" disabled={page <= 0} onClick={() => setPage(value => value - 1)} aria-label="Previous queue page">
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button className="admin-button admin-button--icon" type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(value => value + 1)} aria-label="Next queue page">
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </aside>
        </>
      ) : null}

      {filtersOpen ? (
        <>
          <button className="admin-scrim" type="button" onClick={() => setFiltersOpen(false)} aria-label="Dismiss filters drawer" />
          <aside className="admin-drawer" aria-label="Review filters">
            <div className="admin-drawer__header">
              <h2>Filters</h2>
              <button className="admin-button admin-button--icon" type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="admin-drawer__body">
              <p className="admin-filter-hint">
                By default, this worklist shows the active product regions. Use “All regions” only when you intentionally want the national backlog.
              </p>
              <label className="admin-field">
                <span>Source</span>
                <select value={filterDraft.source} onChange={event => setFilterDraft(current => ({ ...current, source: event.target.value }))}>
                  {SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="admin-field">
                <span>State or region</span>
                <input value={filterDraft.state} onChange={event => setFilterDraft(current => ({ ...current, state: event.target.value }))} placeholder="MI, NY, Ontario… or all" />
              </label>
              <div className="admin-inline-actions">
                <button className="admin-button admin-button--primary" type="button" onClick={applyFilters}>Apply filters</button>
                <button
                  className="admin-button admin-button--quiet"
                  type="button"
                  onClick={() => {
                    setFilterDraft(current => ({ ...current, state: 'all' }))
                    setParamValues({ state: 'all', id: null })
                    setFiltersOpen(false)
                  }}
                >
                  All regions
                </button>
                <button
                  className="admin-button admin-button--quiet"
                  type="button"
                  onClick={() => {
                    setFilterDraft({ source: '', state: '' })
                    setParamValues({ source: null, state: null, id: null })
                    setFiltersOpen(false)
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </aside>
        </>
      ) : null}

      <ConfirmationDialog
        row={linkConfirmation}
        busy={busy}
        onCancel={() => setLinkConfirmation(null)}
        onConfirm={() => decide(linkConfirmation, 'linked', linkConfirmation.nearest_place_id)}
      />
      <UpdateExistingDialog
        row={updateConfirmation}
        busy={busy}
        onCancel={() => setUpdateConfirmation(null)}
        onConfirm={() => updateExisting(updateConfirmation)}
      />
      <ReplacementDialog
        row={replacementConfirmation}
        busy={busy}
        onCancel={() => setReplacementConfirmation(null)}
        onConfirm={() => recordReplacement(replacementConfirmation)}
      />
    </div>
  )
}
