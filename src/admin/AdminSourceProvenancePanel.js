import React, { useEffect, useMemo, useState } from 'react'
import {
  buildReviewWorklist,
  canonicalContextLines,
  decisionCanonicalContextLines,
  reviewDecisionChecklist,
  reviewActionCopy,
  reviewLifecycleCopy,
  reviewQueuePressureSummary,
  reviewRecommendation,
  sourceReviewBrand,
} from './sourceReviewTriage'

const numberFormat = new Intl.NumberFormat()
const REVIEW_STATUS_OPTIONS = ['pending', 'accepted', 'linked', 'rejected', 'ignored']
const REVIEW_KIND_OPTIONS = [
  { value: '', label: 'All kinds' },
  { value: 'ambiguous', label: 'Ambiguous' },
  { value: 'likely_new', label: 'Likely new' },
]
const REVIEW_READINESS_OPTIONS = [
  { value: '', label: 'All readiness' },
  { value: 'candidate_ready', label: 'Candidate ready' },
  { value: 'nearby_canonical_review', label: 'Nearby canonical' },
  { value: 'duplicate_accepted_source_coordinate', label: 'Accepted duplicate coordinates' },
  { value: 'missing_required_data', label: 'Missing data' },
  { value: 'link_review', label: 'Link review' },
]
const REVIEW_SCOPE_OPTIONS = [
  { value: '', label: 'All feed types' },
  { value: 'chain', label: 'Chain feeds' },
  { value: 'independent', label: 'Independent sources' },
]
const QUEUE_PAGE_SIZE = 25

const formatCount = value => numberFormat.format(Number(value) || 0)

export const reviewedNewSyncCommands = (importedRows, { entity = 'pizza' } = {}) => {
  if (entity !== 'pizza') {
    return {
      unsupported: true,
      reason: 'Reviewed-new Supabase publish handoff is currently implemented for pizza_places only.',
    }
  }

  const ids = [...new Set((importedRows || [])
    .map(row => Number(row?.place_id))
    .filter(id => Number.isInteger(id) && id > 0))]
  if (!ids.length) return null

  const idList = ids.join(',')
  const batch = Math.min(ids.length, 100)
  const base = `node scripts/sync-local-to-supabase.mjs --ids ${idList} --insert-missing-reviewed-new --batch ${batch} --max-batches 1`
  return {
    ids,
    dryRun: `${base} --dry-run`,
    apply: base,
  }
}

export const reviewedNewEnrichmentCommands = (importedRows, { entity = 'pizza' } = {}) => {
  const ids = [...new Set((importedRows || [])
    .map(row => Number(row?.place_id))
    .filter(id => Number.isInteger(id) && id > 0))]

  if (!ids.length) return null

  const idList = ids.join(',')
  const limit = Math.min(ids.length, 100)
  const scrape = [
    `node scripts/enrichment/populate-scrape-from-db.mjs --type ${shellQuote(entity)} --ids ${idList} --id-prefix all_the_places: --priority-boost 100000 --limit ${limit}`,
  ]

  if (entity !== 'pizza') {
    return {
      ids,
      scrape,
      unsupported: {
        classify: 'populate-classify-from-db.mjs currently rejects non-pizza datasets.',
        deterministic: 'apply-deterministic-classification.mjs is currently pizza_places only.',
      },
    }
  }

  return {
    ids,
    scrape,
    classify: [
      `node scripts/enrichment/populate-classify-from-db.mjs --type pizza --state '*' --ids ${idList} --id-prefix all_the_places: --priority-boost 100000 --limit ${limit}`,
    ],
    deterministic: {
      dryRun: `node scripts/ops/apply-deterministic-classification.mjs --ids ${idList} --id-prefix all_the_places:`,
      apply: `node scripts/ops/apply-deterministic-classification.mjs --ids ${idList} --id-prefix all_the_places: --apply`,
    },
  }
}

const shellQuote = value => {
  const text = String(value || '')
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

const slugPart = value => String(value || '')
  .replace(/-review\.json$/i, '')
  .replace(/[^A-Za-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase()

export const reviewQueueExportCommand = (filter = {}, { entity = 'pizza' } = {}) => {
  const status = filter.status || 'pending'
  const kind = filter.kind || 'all'
  const ids = Array.isArray(filter.ids)
    ? [...new Set(filter.ids.map(id => Number.parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0))]
    : []
  const parts = [
    'source-review',
    ids.length ? `selected-${ids.length}` : slugPart(filter.reportFile) || slugPart(filter.source) || 'queue',
    kind !== 'all' ? slugPart(kind) : '',
    filter.readiness ? slugPart(filter.readiness) : '',
    slugPart(status),
  ].filter(Boolean)
  const output = `reports/${parts.join('-')}.csv`
  const args = [
    'node',
    'scripts/ops/export-reviewed-source-candidates.mjs',
    '--entity', entity,
    '--status', status,
    '--kind', kind,
    '--output', output,
  ]
  if (filter.source) args.push('--source', filter.source)
  if (filter.reportFile) args.push('--report-file', filter.reportFile)
  if (filter.readiness) args.push('--readiness', filter.readiness)
  if (filter.scope) args.push('--scope', filter.scope)
  if (filter.state) args.push('--state', filter.state)
  if (filter.search) args.push('--search', filter.search)
  if (ids.length) args.push('--ids', ids.join(','))

  return args.map(shellQuote).join(' ')
}

export const selectedReviewEligibilitySummary = (rows = [], selectedIds = []) => {
  const selectedSet = new Set((selectedIds || []).map(id => String(id)))
  const selectedRows = (rows || []).filter(row => selectedSet.has(String(row?.id)))
  const pendingRows = selectedRows.filter(row => row?.status === 'pending')
  const pendingLikelyNew = pendingRows.filter(row => row?.review_kind === 'likely_new')
  const pendingAmbiguous = pendingRows.filter(row => row?.review_kind === 'ambiguous')
  const linkableAmbiguous = pendingAmbiguous.filter(row => Number(row?.nearest_place_id) > 0)
  const acceptedLikelyNew = selectedRows.filter(row => row?.status === 'accepted' && row?.review_kind === 'likely_new')
  const importedLinked = selectedRows.filter(row => row?.status === 'linked')
  const ineligible = Math.max(
    0,
    selectedRows.length - pendingLikelyNew.length - linkableAmbiguous.length - acceptedLikelyNew.length
  )

  const parts = []
  if (pendingLikelyNew.length) parts.push(`${formatCount(pendingLikelyNew.length)} can be accepted as likely-new`)
  if (linkableAmbiguous.length) parts.push(`${formatCount(linkableAmbiguous.length)} can be linked to nearest canonical`)
  if (acceptedLikelyNew.length) parts.push(`${formatCount(acceptedLikelyNew.length)} can be imported locally`)
  if (pendingRows.length) parts.push(`${formatCount(pendingRows.length)} can be rejected or ignored`)
  if (importedLinked.length) parts.push(`${formatCount(importedLinked.length)} already linked`)
  if (ineligible) parts.push(`${formatCount(ineligible)} not eligible for the primary action`)

  return {
    selected: selectedRows.length,
    pendingLikelyNew: pendingLikelyNew.length,
    pendingAmbiguous: pendingAmbiguous.length,
    linkableAmbiguous: linkableAmbiguous.length,
    acceptedLikelyNew: acceptedLikelyNew.length,
    rejectablePending: pendingRows.length,
    alreadyLinked: importedLinked.length,
    ineligible,
    text: parts.length ? parts.join(' · ') : 'No eligible selected rows in the current page',
  }
}

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

const promotionPolicyRows = [
  {
    fields: 'website_url, phone',
    policy: 'Fill blank values only from high-confidence accepted evidence.',
  },
  {
    fields: 'menu_url, email, social links, hours, service flags',
    policy: 'Evidence-only until source-specific normalization and conflict rules exist.',
  },
  {
    fields: 'name, address, lat, lng, state, google_place_id, brand/operator',
    policy: 'Never auto-promote. Use review/import flow for identity changes.',
  },
  {
    fields: 'style, price, price_range, style_confidence',
    policy: 'Classifier, manual, or editorial fields; not source-adapter fields.',
  },
  {
    fields: 'rating, notes, status, photos',
    policy: 'Manual/editorial only unless a future explicit admin action is added.',
  },
]

const reviewFilterButtonStyle = {
  border: '1px solid rgba(56, 189, 248, 0.45)',
  borderRadius: 8,
  background: 'transparent',
  color: '#7dd3fc',
  padding: '0.35rem 0.55rem',
  fontWeight: 800,
  cursor: 'pointer',
}

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 999,
  color: '#cbd5e1',
  background: 'rgba(15, 23, 42, 0.7)',
  padding: '0.18rem 0.5rem',
  fontSize: '0.74rem',
  fontWeight: 800,
}

const bucketButtonStyle = {
  display: 'grid',
  gap: '0.2rem',
  border: '1px solid rgba(56, 189, 248, 0.35)',
  borderRadius: 10,
  background: '#101820',
  color: '#e5e7eb',
  padding: '0.7rem',
  textAlign: 'left',
  cursor: 'pointer',
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
  const [queueReadiness, setQueueReadiness] = useState('')
  const [queueScope, setQueueScope] = useState('')
  const [queueState, setQueueState] = useState('')
  const [queueSearch, setQueueSearch] = useState('')
  const [queuePage, setQueuePage] = useState(0)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [queueMessage, setQueueMessage] = useState('')
  const [actionState, setActionState] = useState({})
  const [decisionDrafts, setDecisionDrafts] = useState({})
  const [selectedReviewIds, setSelectedReviewIds] = useState({})
  const [importPreflight, setImportPreflight] = useState(null)
  const [importPreflightSource, setImportPreflightSource] = useState('')
  const [importPreflightReportFile, setImportPreflightReportFile] = useState('')
  const [importPreflightLoading, setImportPreflightLoading] = useState(false)
  const [importPreflightError, setImportPreflightError] = useState('')
  const [reviewedNewSyncHandoff, setReviewedNewSyncHandoff] = useState(null)
  const [reviewedNewEnrichmentHandoff, setReviewedNewEnrichmentHandoff] = useState(null)
  const [importPreflightRefreshKey, setImportPreflightRefreshKey] = useState(0)
  const [sourceRefreshKey, setSourceRefreshKey] = useState(0)
  const [queueRefreshKey, setQueueRefreshKey] = useState(0)

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
  }, [entity, sourceRefreshKey])

  useEffect(() => {
    let cancelled = false

    async function loadImportPreflight() {
      setImportPreflightLoading(true)
      setImportPreflightError('')
      try {
        const params = new URLSearchParams({
          entity,
          limit: '100',
          nearbyRadiusM: '150',
        })
        if (importPreflightSource) params.set('source', importPreflightSource)
        if (importPreflightReportFile) params.set('reportFile', importPreflightReportFile)
        const res = await fetch(`/api/admin/source-review-queue/import-preflight?${params.toString()}`, { credentials: 'include' })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to load reviewed-new import preflight')
        }
        const data = await res.json()
        if (!cancelled) setImportPreflight(data?.data || null)
      } catch (err) {
        if (!cancelled) {
          setImportPreflight(null)
          setImportPreflightError(err?.message || 'Failed to load reviewed-new import preflight.')
        }
      } finally {
        if (!cancelled) setImportPreflightLoading(false)
      }
    }

    loadImportPreflight()
    return () => {
      cancelled = true
    }
  }, [entity, importPreflightRefreshKey, importPreflightReportFile, importPreflightSource])

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
        if (queueReadiness) params.set('readiness', queueReadiness)
        if (queueScope) params.set('scope', queueScope)
        if (queueState.trim()) params.set('state', queueState.trim())
        if (queueSearch.trim()) params.set('search', queueSearch.trim())
        const res = await fetch(`/api/admin/source-review-queue?${params.toString()}`, { credentials: 'include' })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to load review queue')
        }
        const data = await res.json()
        if (!cancelled) {
          const rows = Array.isArray(data?.data) ? data.data : []
          setQueueRows(rows)
          setQueueTotal(Number(data?.total) || 0)
          setSelectedReviewIds(prev => {
            const visible = new Set(rows.map(row => String(row.id)))
            const next = {}
            for (const [id, selected] of Object.entries(prev)) {
              if (selected && visible.has(id)) next[id] = true
            }
            return next
          })
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
  }, [entity, queueKind, queuePage, queueReadiness, queueRefreshKey, queueReportFile, queueScope, queueSearch, queueSource, queueState, queueStatus])

  useEffect(() => {
    setQueuePage(0)
    setSelectedReviewIds({})
  }, [entity, queueKind, queueReadiness, queueReportFile, queueScope, queueSearch, queueSource, queueState, queueStatus])

  const selectableVisibleIds = useMemo(
    () => queueRows
      .filter(row => row.status === 'pending' || (row.status === 'accepted' && row.review_kind === 'likely_new'))
      .map(row => String(row.id)),
    [queueRows]
  )
  const selectedIds = useMemo(
    () => Object.entries(selectedReviewIds).filter(([, selected]) => selected).map(([id]) => id),
    [selectedReviewIds]
  )
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every(id => selectedReviewIds[id])

  const toggleReviewSelection = rowId => {
    const id = String(rowId)
    setSelectedReviewIds(prev => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const toggleVisibleSelection = () => {
    setSelectedReviewIds(prev => {
      const next = { ...prev }
      if (allVisibleSelected) {
        for (const id of selectableVisibleIds) delete next[id]
      } else {
        for (const id of selectableVisibleIds) next[id] = true
      }
      return next
    })
  }

  const recordDecision = async (row, status) => {
    const draft = decisionDrafts[row.id] || {}
    const reviewerNotes = (draft.reviewerNotes || '').trim()
    const canonicalPlaceId = status === 'linked'
      ? String(draft.canonicalPlaceId ?? row.nearest_place_id ?? '').trim()
      : ''

    if (status === 'linked' && !canonicalPlaceId) {
      setQueueError('Link decisions require a canonical place id.')
      return
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
        setSelectedReviewIds(prev => {
          const next = { ...prev }
          delete next[String(row.id)]
          return next
        })
        setQueueMessage(`Marked "${updated.source_name || updated.source_id}" as ${updated.status}.`)
        setDecisionDrafts(prev => {
          const next = { ...prev }
          delete next[row.id]
          return next
        })
        setImportPreflightRefreshKey(value => value + 1)
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

  const reclassifyAsLikelyNew = async row => {
    const draft = decisionDrafts[row.id] || {}
    const reviewerNotes = (draft.reviewerNotes || '').trim()

    const confirmed = window.confirm(
      `Move "${row.source_name || row.source_id}" from ambiguous-link review to likely-new review?\n\nThis does not create a canonical place or source evidence. It keeps the row pending so it can go through duplicate review and reviewed-new import preflight.`
    )
    if (!confirmed) {
      setQueueMessage('Reclassification cancelled.')
      return
    }

    setActionState(prev => ({ ...prev, [row.id]: 'reclassify-likely-new' }))
    setQueueError('')
    setQueueMessage('')
    try {
      const res = await fetch(`/api/admin/source-review-queue/${row.id}/reclassify-likely-new`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reviewerNotes }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to reclassify review row')
      }
      const data = await res.json()
      const updated = data?.data
      if (updated) {
        const keepInCurrentView = (!queueKind || queueKind === updated.review_kind) && queueStatus === updated.status
        setQueueRows(prev => keepInCurrentView
          ? prev.map(item => (item.id === updated.id ? updated : item))
          : prev.filter(item => item.id !== updated.id)
        )
        setQueueTotal(prev => keepInCurrentView ? prev : Math.max(0, prev - 1))
        setSelectedReviewIds(prev => {
          const next = { ...prev }
          delete next[String(row.id)]
          return next
        })
        setDecisionDrafts(prev => {
          const next = { ...prev }
          delete next[row.id]
          return next
        })
        setQueueMessage(`Moved "${updated.source_name || updated.source_id}" to likely-new review.`)
        setImportPreflightRefreshKey(value => value + 1)
      }
    } catch (err) {
      setQueueError(err?.message || 'Failed to reclassify review row.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next[row.id]
        return next
      })
    }
  }

  const recordBulkDecision = async status => {
    if (!selectedIds.length) {
      setQueueError('Select at least one pending source review row.')
      return
    }

    setActionState(prev => ({ ...prev, bulk: status }))
    setQueueError('')
    setQueueMessage('')
    try {
      if (status === 'accepted') {
        const previewRes = await fetch('/api/admin/source-review-queue/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status, ids: selectedIds, dryRun: true }),
        })
        if (!previewRes.ok) {
          const text = await previewRes.text()
          throw new Error(text || 'Failed to preview selected review rows')
        }
        const preview = await previewRes.json()
        const eligibleRows = preview?.data || []
        if (!eligibleRows.length) {
          setQueueMessage(`No selected rows are eligible to accept as new candidates; ${formatCount(preview?.skipped || selectedIds.length)} were skipped.`)
          return
        }

        const exampleRows = eligibleRows.slice(0, 5).map(row => (
          `- ${row.source_name || row.source_id || `row ${row.id}`}`
        ))
        const skippedText = preview?.skipped
          ? `\n\n${formatCount(preview.skipped)} selected rows will be skipped because they are not pending likely-new rows.`
          : ''
        const confirmed = window.confirm(
          `Accept ${formatCount(eligibleRows.length)} likely-new source rows as future import candidates?\n\n${exampleRows.join('\n')}${eligibleRows.length > 5 ? '\n- ...' : ''}${skippedText}\n\nThis does not create canonical places or write Supabase.`
        )
        if (!confirmed) {
          setQueueMessage('Bulk accept cancelled.')
          return
        }
      }

      if (status === 'linked') {
        const previewRes = await fetch('/api/admin/source-review-queue/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status, ids: selectedIds, dryRun: true }),
        })
        if (!previewRes.ok) {
          const text = await previewRes.text()
          throw new Error(text || 'Failed to preview selected review rows')
        }
        const preview = await previewRes.json()
        const eligibleRows = preview?.data || []
        if (!eligibleRows.length) {
          setQueueMessage(`No selected rows are eligible to link; ${formatCount(preview?.skipped || selectedIds.length)} were skipped.`)
          return
        }

        const exampleRows = eligibleRows.slice(0, 5).map(row => (
          `- ${row.source_name || row.source_id || `row ${row.id}`} -> ${row.nearest_place_name || `place ${row.canonical_place_id}`}`
        ))
        const skippedText = preview?.skipped
          ? `\n\n${formatCount(preview.skipped)} selected rows will be skipped because they are not pending ambiguous rows with a valid nearest canonical place.`
          : ''
        const confirmed = window.confirm(
          `Link ${formatCount(eligibleRows.length)} selected source rows to their nearest canonical places?\n\n${exampleRows.join('\n')}${eligibleRows.length > 5 ? '\n- ...' : ''}${skippedText}\n\nThis writes source evidence to place_sources.`
        )
        if (!confirmed) {
          setQueueMessage('Bulk link cancelled.')
          return
        }
      }

      const res = await fetch('/api/admin/source-review-queue/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, ids: selectedIds }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to update selected review rows')
      }
      const data = await res.json()
      const updatedIds = new Set((data?.data || []).map(row => String(row.id)))
      if (updatedIds.size) {
        setQueueRows(prev => prev.filter(item => !updatedIds.has(String(item.id))))
        setQueueTotal(prev => Math.max(0, prev - updatedIds.size))
      }
      setSelectedReviewIds({})
      setImportPreflightRefreshKey(value => value + 1)
      const actionLabel = status === 'linked'
        ? 'linked to nearest canonical place'
        : status === 'accepted'
          ? 'accepted as likely-new import candidates'
          : `marked as ${status}`
      setQueueMessage(`${formatCount(data?.updated)} selected rows ${actionLabel}${data?.skipped ? `; ${formatCount(data.skipped)} were skipped` : ''}.`)
    } catch (err) {
      setQueueError(err?.message || 'Failed to update selected review rows.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next.bulk
        return next
      })
    }
  }

  const importReviewedNewCandidates = async () => {
    const ready = Number(importPreflight?.candidateReady) || 0
    const inspected = Number(importPreflight?.rowsInspected) || 0
    if (!ready) {
      setQueueMessage('No candidate-ready accepted rows are available to import.')
      return
    }

    const confirmed = window.confirm(
      `Import ${formatCount(ready)} reviewed-new candidate${ready === 1 ? '' : 's'} into local canonical places?\n\nThis recomputes duplicate checks, writes local pizza_places and place_sources rows, and does not sync Supabase. Rows with nearby canonical matches or missing data will be skipped.`
    )
    if (!confirmed) {
      setQueueMessage('Reviewed-new import cancelled.')
      return
    }

    setActionState(prev => ({ ...prev, importReviewedNew: true }))
    setQueueError('')
    setQueueMessage('')
    setImportPreflightError('')
    try {
      const res = await fetch('/api/admin/source-review-queue/import-reviewed-new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity,
          source: importPreflightSource,
          reportFile: importPreflightReportFile,
          limit: inspected || 25,
          nearbyRadiusM: 150,
          confirmed: true,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to import reviewed-new candidates')
      }
      const data = await res.json()
      const result = data?.data || {}
      const imported = Array.isArray(result.imported) ? result.imported : []
      const skipped = Number(result.skipped) || 0
      setQueueMessage(`Imported ${formatCount(imported.length)} reviewed-new candidate${imported.length === 1 ? '' : 's'} locally${skipped ? `; ${formatCount(skipped)} inspected rows were skipped` : ''}.`)
      setReviewedNewSyncHandoff(reviewedNewSyncCommands(imported, { entity }))
      setReviewedNewEnrichmentHandoff(reviewedNewEnrichmentCommands(imported, { entity }))
      setImportPreflightRefreshKey(value => value + 1)
      setSourceRefreshKey(value => value + 1)
      setQueueRefreshKey(value => value + 1)
    } catch (err) {
      setImportPreflightError(err?.message || 'Failed to import reviewed-new candidates.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next.importReviewedNew
        return next
      })
    }
  }

  const importSelectedReviewedNewCandidates = async () => {
    if (!selectedIds.length) {
      setQueueError('Select at least one accepted likely-new source review row.')
      return
    }

    const selectedSet = new Set(selectedIds)
    const eligibleIds = queueRows
      .filter(row => selectedSet.has(String(row.id)) && row.status === 'accepted' && row.review_kind === 'likely_new')
      .map(row => String(row.id))

    if (!eligibleIds.length) {
      setQueueError('Selected rows must be accepted likely-new rows before reviewed-new import.')
      return
    }

    const confirmed = window.confirm(
      `Import ${formatCount(eligibleIds.length)} selected reviewed-new candidate${eligibleIds.length === 1 ? '' : 's'} into local canonical places?\n\nThis uses exact review IDs, recomputes duplicate checks, writes local pizza_places and place_sources rows, and does not sync Supabase.`
    )
    if (!confirmed) {
      setQueueMessage('Selected reviewed-new import cancelled.')
      return
    }

    setActionState(prev => ({ ...prev, importSelectedReviewedNew: true }))
    setQueueError('')
    setQueueMessage('')
    setImportPreflightError('')
    try {
      const res = await fetch('/api/admin/source-review-queue/import-reviewed-new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity,
          ids: eligibleIds,
          limit: eligibleIds.length,
          nearbyRadiusM: 150,
          confirmed: true,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to import selected reviewed-new candidates')
      }
      const data = await res.json()
      const result = data?.data || {}
      const imported = Array.isArray(result.imported) ? result.imported : []
      const importedIds = new Set(imported.map(row => String(row.review_id)))
      if (importedIds.size) {
        setQueueRows(prev => prev.filter(item => !importedIds.has(String(item.id))))
        setQueueTotal(prev => Math.max(0, prev - importedIds.size))
      }
      setSelectedReviewIds({})
      setQueueMessage(`Imported ${formatCount(imported.length)} selected reviewed-new candidate${imported.length === 1 ? '' : 's'} locally${Number(result.skipped) ? `; ${formatCount(result.skipped)} inspected rows were skipped` : ''}.`)
      setReviewedNewSyncHandoff(reviewedNewSyncCommands(imported, { entity }))
      setReviewedNewEnrichmentHandoff(reviewedNewEnrichmentCommands(imported, { entity }))
      setImportPreflightRefreshKey(value => value + 1)
      setSourceRefreshKey(value => value + 1)
      setQueueRefreshKey(value => value + 1)
    } catch (err) {
      setImportPreflightError(err?.message || 'Failed to import selected reviewed-new candidates.')
    } finally {
      setActionState(prev => {
        const next = { ...prev }
        delete next.importSelectedReviewedNew
        return next
      })
    }
  }

  const updateDecisionDraft = (rowId, patch) => {
    setDecisionDrafts(prev => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || {}),
        ...patch,
      },
    }))
  }

  const totals = useMemo(() => {
    const sourceRows = payload?.database?.sourceCounts || []
    const reviewTotals = payload?.reviewArtifacts?.totals || {}
    const statusCounts = payload?.database?.reviewQueue?.statusCounts || []
    const readinessCounts = payload?.database?.reviewQueue?.readinessCounts || []
    const pendingQueueRows = statusCounts
      .filter(row => row.status === 'pending')
      .reduce((sum, row) => sum + (Number(row.rows) || 0), 0)
    const countStatus = (kind, status) => statusCounts
      .filter(row => row.review_kind === kind && row.status === status)
      .reduce((sum, row) => sum + (Number(row.rows) || 0), 0)
    const countReadiness = (kind, status, readiness) => readinessCounts
      .filter(row => row.review_kind === kind && row.status === status && row.readiness === readiness)
      .reduce((sum, row) => sum + (Number(row.rows) || 0), 0)
    return {
      sourceRows: sourceRows.reduce((sum, row) => sum + (Number(row.rows) || 0), 0),
      sourcePlaces: sourceRows.reduce((sum, row) => sum + (Number(row.places) || 0), 0),
      ambiguous: Number(reviewTotals.ambiguous) || 0,
      likelyNew: Number(reviewTotals.likelyNew) || 0,
      pendingQueueRows,
      pendingAmbiguous: countStatus('ambiguous', 'pending'),
      acceptedLikelyNew: countStatus('likely_new', 'accepted'),
      candidateReady: countReadiness('likely_new', 'pending', 'candidate_ready'),
    }
  }, [payload])

  const focusReviewReport = (reportFile, kind = '') => {
    setQueueStatus('pending')
    setQueueSource('')
    setQueueSearch('')
    setQueueKind(kind)
    setQueueReadiness('')
    setQueueReportFile(reportFile || '')
    setQueuePage(0)
    if (typeof document !== 'undefined') {
      document.getElementById('source-review-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const focusReviewBucket = ({ source = '', reportFile = '', kind = '', status = 'pending', readiness = '' }) => {
    setQueueStatus(status || 'pending')
    setQueueSource(source || '')
    setQueueSearch('')
    setQueueKind(kind || '')
    setQueueReadiness(readiness || '')
    setQueueReportFile(reportFile || '')
    setQueuePage(0)
    if (typeof document !== 'undefined') {
      document.getElementById('source-review-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

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
  const fsqSample = payload.fsqSample || {}
  const promotionCandidates = database.promotionCandidates || {}
  const promotionCounts = promotionCandidates.counts || []
  const promotionSample = promotionCandidates.sample || []
  const pageCount = Math.max(1, Math.ceil(queueTotal / QUEUE_PAGE_SIZE))
  const pageStart = queueTotal === 0 ? 0 : queuePage * QUEUE_PAGE_SIZE + 1
  const pageEnd = Math.min(queueTotal, (queuePage + 1) * QUEUE_PAGE_SIZE)
  const queueSourceOptions = [...new Set((database.reviewQueue?.sourceCounts || []).map(row => row.source).filter(Boolean))].sort()
  const queueReportOptions = [...new Set([
    ...(database.reviewQueue?.reportCounts || [])
      .filter(row => row.report_file && (!queueSource || row.source === queueSource))
      .map(row => row.report_file),
    ...(reviewArtifacts.reports || [])
      .filter(row => row.source && (!queueSource || row.source === queueSource))
      .map(row => row.file),
  ])]
    .filter(Boolean)
    .sort()
  const importPreflightReportOptions = [...new Set([
    ...(database.reviewQueue?.reportCounts || [])
      .filter(row => row.report_file && (!importPreflightSource || row.source === importPreflightSource))
      .map(row => row.report_file),
    ...(reviewArtifacts.reports || [])
      .filter(row => row.source && (!importPreflightSource || row.source === importPreflightSource))
      .map(row => row.file),
  ])]
    .filter(Boolean)
    .sort()
  const pendingReviewBuckets = (database.reviewQueue?.reportCounts || [])
    .filter(row => row.status === 'pending')
    .slice()
    .sort((a, b) => (Number(b.rows) || 0) - (Number(a.rows) || 0))
    .slice(0, 8)
  const pendingReadinessBuckets = (database.reviewQueue?.readinessCounts || [])
    .filter(row => row.status === 'pending')
    .slice()
    .sort((a, b) => (Number(b.rows) || 0) - (Number(a.rows) || 0))
  const nextReviewWork = buildReviewWorklist(database.reviewQueue?.reportCounts || [], { limit: 10 })
  const reviewPressure = reviewQueuePressureSummary(database.reviewQueue?.reportCounts || [])
  const reviewPressureExportCommand = reviewPressure.rows > 0
    ? reviewQueueExportCommand(reviewPressure.filter, { entity })
    : ''
  const importReadinessRows = (importPreflight?.readinessCounts || [])
    .slice()
    .sort((a, b) => {
      const order = {
        candidate_ready: 0,
        nearby_canonical_review: 1,
        duplicate_source_id: 2,
      }
      return (order[a.readiness] ?? 9) - (order[b.readiness] ?? 9)
        || String(a.readiness || '').localeCompare(String(b.readiness || ''))
    })
  const importCandidateRows = importPreflight?.candidates || []
  const nextReviewActions = (() => {
    const readinessRows = database.reviewQueue?.readinessCounts || []
    const statusRows = database.reviewQueue?.statusCounts || []
    const byKey = new Map()
    for (const row of readinessRows) {
      byKey.set(`${row.review_kind}:${row.status}:${row.readiness || ''}`, {
        review_kind: row.review_kind,
        status: row.status,
        readiness: row.readiness || '',
        rows: Number(row.rows) || 0,
      })
    }
    for (const row of statusRows) {
      byKey.set(`${row.review_kind}:${row.status}:`, {
        review_kind: row.review_kind,
        status: row.status,
        readiness: '',
        rows: Number(row.rows) || 0,
      })
    }

    return [
      byKey.get('ambiguous:pending:link_review') || {
        review_kind: 'ambiguous',
        status: 'pending',
        readiness: 'link_review',
        rows: totals.pendingAmbiguous,
      },
      byKey.get('likely_new:pending:nearby_canonical_review'),
      byKey.get('likely_new:pending:candidate_ready'),
      byKey.get('likely_new:accepted:'),
      byKey.get('likely_new:pending:missing_required_data'),
    ]
      .filter(row => row && Number(row.rows) > 0)
      .map(row => ({ ...row, ...reviewActionCopy(row) }))
  })()
  const bulkBusy = Boolean(actionState.bulk)
  const importReviewedNewBusy = Boolean(actionState.importReviewedNew || actionState.importSelectedReviewedNew)
  const currentQueueExportCommand = reviewQueueExportCommand({
    source: queueSource,
    reportFile: queueReportFile,
    kind: queueKind,
    status: queueStatus,
    readiness: queueReadiness,
    scope: queueScope,
    state: queueState.trim(),
    search: queueSearch.trim(),
  }, { entity })
  const selectedQueueExportCommand = selectedIds.length
    ? reviewQueueExportCommand({
      source: queueSource,
      reportFile: queueReportFile,
      kind: queueKind,
      status: queueStatus,
      readiness: queueReadiness,
      scope: queueScope,
      state: queueState.trim(),
      search: queueSearch.trim(),
      ids: selectedIds,
    }, { entity })
    : ''
  const selectedEligibilitySummary = selectedReviewEligibilitySummary(queueRows, selectedIds)

  return (
    <div style={panelStyle}>
      <StatusMessage>
        <strong style={{ color: '#f8fafc' }}>Local-only source evidence.</strong>{' '}
        {payload.syncPolicy}
      </StatusMessage>

      <section style={blockStyle}>
        <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>FSQ OS Places Sample</h2>
        <div style={{ display: 'grid', gap: '0.65rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...badgeStyle, color: fsqSample.state === 'sample_ready' ? '#86efac' : ['hf_export_ready', 'portal_export_ready', 'portal_setup_needed'].includes(fsqSample.state) ? '#fbbf24' : '#fca5a5' }}>
              {fsqSample.state || 'unknown'}
            </span>
            <span style={badgeStyle}>{fsqSample.recommendedAction || 'no action available'}</span>
            <span style={badgeStyle}>{fsqSample.sampleExists ? 'sample present' : 'sample missing'}</span>
            <span style={badgeStyle}>portal SQL: {fsqSample.portalInitSqlExists ? 'present' : 'missing'}</span>
            <span style={badgeStyle}>portal Python: {fsqSample.portalPythonDuckdbExists ? 'present' : 'missing'}</span>
            {(fsqSample.tokenStatus || []).map(token => (
              <span key={token.name} style={badgeStyle}>
                {token.name}: {token.present ? 'present' : 'missing'}
              </span>
            ))}
          </div>
          <p style={{ margin: 0, color: '#94a3b8' }}>
            Real FSQ import remains sample-first. This panel only reports readiness; it does not download FSQ data or write source evidence.
          </p>
          {fsqSample.samplePath ? (
            <p style={{ margin: 0, color: '#cbd5e1' }}>Sample path: <code>{fsqSample.samplePath}</code></p>
          ) : null}
          {Array.isArray(fsqSample.missing) && fsqSample.missing.length ? (
            <div style={{ color: '#fca5a5' }}>
              Missing: {fsqSample.missing.join('; ')}
            </div>
          ) : null}
          {Array.isArray(fsqSample.portalSetupSteps) && fsqSample.portalSetupSteps.length ? (
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <strong style={{ color: '#f8fafc' }}>Places Portal setup checklist</strong>
              <div style={{ display: 'grid', gap: '0.3rem' }}>
                {fsqSample.portalSetupSteps.map(step => (
                  <div key={step.id} style={{ display: 'grid', gap: '0.15rem', padding: '0.55rem', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: 8, background: 'rgba(15, 23, 42, 0.55)' }}>
                    <span style={{ color: step.status === 'done' || step.status === 'ready' ? '#86efac' : step.status === 'needed' ? '#fbbf24' : '#fca5a5', fontWeight: 800 }}>
                      {step.status}: {step.title}
                    </span>
                    <span style={{ color: '#94a3b8' }}>{step.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {fsqSample.portalSetupCommand ? (
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <strong style={{ color: '#f8fafc' }}>Places Portal setup command</strong>
              <code style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{fsqSample.portalSetupCommand}</code>
            </div>
          ) : null}
          {fsqSample.adapterCommand ? (
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <strong style={{ color: '#f8fafc' }}>Adapter report</strong>
              <code style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{fsqSample.adapterCommand}</code>
            </div>
          ) : null}
          {fsqSample.exportCommand ? (
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <strong style={{ color: '#f8fafc' }}>HF export</strong>
              <code style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{fsqSample.exportCommand}</code>
            </div>
          ) : null}
          {fsqSample.portalExportCommand ? (
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <strong style={{ color: '#f8fafc' }}>Places Portal export</strong>
              <code style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{fsqSample.portalExportCommand}</code>
            </div>
          ) : null}
        </div>
      </section>

      <section style={blockStyle}>
        <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Promotion Policy</h2>
        <p style={{ margin: '0 0 0.75rem', color: '#94a3b8' }}>
          Source adapters preserve evidence first. Canonical fields change only through explicit promotion or review paths.
        </p>
        <div style={tableWrapStyle}>
          <table style={{ ...tableStyle, minWidth: 640 }}>
            <thead>
              <tr>
                <th style={thStyle}>Fields</th>
                <th style={thStyle}>Policy</th>
              </tr>
            </thead>
            <tbody>
              {promotionPolicyRows.map(row => (
                <tr key={row.fields}>
                  <td style={tdStyle}>{row.fields}</td>
                  <td style={tdStyle}>{row.policy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: '0.85rem', display: 'grid', gap: '0.65rem' }}>
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '0.92rem' }}>Contact Promotion Candidates</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.86rem' }}>
            Read-only preview of blank canonical website/phone fields that have high-confidence local source evidence. Apply remains a bounded local CLI action.
          </p>
          {promotionCounts.length ? (
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {promotionCounts.map(row => (
                <span key={`${row.field}-${row.source}`} style={badgeStyle}>
                  {row.field} · {row.source}: {formatCount(row.rows)}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, color: '#94a3b8' }}>No current website/phone promotion candidates under the default policy.</p>
          )}
          {promotionSample.length ? (
            <div style={tableWrapStyle}>
              <table style={{ ...tableStyle, minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Field</th>
                    <th style={thStyle}>Place</th>
                    <th style={thStyle}>Value</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionSample.map(row => (
                    <tr key={`${row.field}-${row.place_id}-${row.source}-${row.source_id}`}>
                      <td style={tdStyle}>{row.field}</td>
                      <td style={tdStyle}>
                        <div>{row.place_name || 'n/a'}</div>
                        <div style={{ color: '#94a3b8' }}>id {row.place_id}{row.google_place_id ? ` · ${row.google_place_id}` : ''}</div>
                      </td>
                      <td style={tdStyle}>{row.proposed_value || 'n/a'}</td>
                      <td style={tdStyle}>{row.source} · {row.source_id}</td>
                      <td style={tdStyle}>{row.match_method} · {Number(row.match_confidence || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

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
            <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Review Workflow</h2>
            <button
              type="button"
              onClick={() => focusReviewBucket(reviewPressure.filter)}
              style={{
                ...bucketButtonStyle,
                marginBottom: '0.85rem',
                borderColor: reviewPressure.tone,
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.72))',
              }}
              title={reviewPressure.detail}
            >
              <span style={{ color: reviewPressure.tone, fontSize: '1.25rem', fontWeight: 900 }}>{formatCount(reviewPressure.rows)}</span>
              <span style={{ fontWeight: 900 }}>Current bottleneck: {reviewPressure.title}</span>
              <span style={{ color: '#94a3b8' }}>{reviewPressure.detail}</span>
            </button>
            {reviewPressureExportCommand ? (
              <div style={{ marginBottom: '0.85rem', border: '1px solid rgba(56, 189, 248, 0.24)', borderRadius: 10, background: 'rgba(14, 165, 233, 0.08)', padding: '0.75rem', display: 'grid', gap: '0.35rem' }}>
                <strong style={{ color: '#bae6fd', fontSize: '0.84rem' }}>Export current bottleneck</strong>
                <code style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reviewPressureExportCommand}</code>
              </div>
            ) : null}
            {nextReviewActions.length > 0 ? (
              <div style={{ marginBottom: '0.85rem', display: 'grid', gap: '0.55rem' }}>
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '0.95rem' }}>Recommended Queue Order</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.65rem' }}>
                  {nextReviewActions.map(action => (
                    <button
                      key={`${action.review_kind}-${action.status}-${action.readiness || 'all'}`}
                      type="button"
                      onClick={() => focusReviewBucket(action.filter)}
                      style={bucketButtonStyle}
                      title={action.detail}
                    >
                      <span style={{ color: action.tone, fontSize: '1.15rem', fontWeight: 900 }}>{formatCount(action.rows)}</span>
                      <span style={{ fontWeight: 850 }}>{action.title}</span>
                      <span style={{ color: '#94a3b8' }}>{action.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => focusReviewBucket({ kind: 'ambiguous', status: 'pending', readiness: 'link_review' })}
                style={bucketButtonStyle}
                title="Review possible duplicate/source links before importing new places"
              >
                <span style={{ color: '#fbbf24', fontSize: '1.25rem', fontWeight: 900 }}>{formatCount(totals.pendingAmbiguous)}</span>
                <span style={{ fontWeight: 850 }}>Link ambiguous rows</span>
                <span style={{ color: '#94a3b8' }}>Attach source evidence to existing canonical places.</span>
              </button>
              <button
                type="button"
                onClick={() => focusReviewBucket({ kind: 'likely_new', status: 'pending', readiness: 'candidate_ready' })}
                style={bucketButtonStyle}
                title="Review likely-new rows that have enough source data for later import preflight"
              >
                <span style={{ color: '#fb923c', fontSize: '1.25rem', fontWeight: 900 }}>{formatCount(totals.candidateReady)}</span>
                <span style={{ fontWeight: 850 }}>Accept likely-new candidates</span>
                <span style={{ color: '#94a3b8' }}>Stage import candidates; no canonical rows are created here.</span>
              </button>
              <button
                type="button"
                onClick={() => focusReviewBucket({ kind: 'likely_new', status: 'accepted' })}
                style={bucketButtonStyle}
                title="Inspect accepted likely-new rows before running import preflight"
              >
                <span style={{ color: '#86efac', fontSize: '1.25rem', fontWeight: 900 }}>{formatCount(totals.acceptedLikelyNew)}</span>
                <span style={{ fontWeight: 850 }}>Preflight accepted rows</span>
                <span style={{ color: '#94a3b8' }}>These are the only rows eligible for reviewed-new import.</span>
              </button>
            </div>
            <div style={{ marginTop: '0.85rem', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 10, padding: '0.85rem', background: '#101820' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '0.95rem' }}>Reviewed-New Import Preflight</h3>
                  <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.86rem' }}>
                    Read-only duplicate/readiness check for accepted likely-new rows. Import remains local-only through the guarded admin action or local script.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportPreflightRefreshKey(value => value + 1)}
                  disabled={importPreflightLoading || importReviewedNewBusy}
                  style={{ ...reviewFilterButtonStyle, cursor: importPreflightLoading || importReviewedNewBusy ? 'not-allowed' : 'pointer', opacity: importPreflightLoading || importReviewedNewBusy ? 0.65 : 1 }}
                >
                  Refresh
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'end', marginTop: '0.75rem' }}>
                <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700, flex: '1 1 220px' }}>
                  Preflight source
                  <select
                    value={importPreflightSource}
                    onChange={event => {
                      setImportPreflightSource(event.target.value)
                      setImportPreflightReportFile('')
                    }}
                    disabled={importPreflightLoading || importReviewedNewBusy}
                    style={{ minWidth: 0, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                  >
                    <option value="">All sources</option>
                    {queueSourceOptions.map(source => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700, flex: '1 1 260px' }}>
                  Preflight report
                  <select
                    value={importPreflightReportFile}
                    onChange={event => setImportPreflightReportFile(event.target.value)}
                    disabled={importPreflightLoading || importReviewedNewBusy}
                    style={{ minWidth: 0, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                  >
                    <option value="">All reports</option>
                    {importPreflightReportOptions.map(file => (
                      <option key={file} value={file}>{file.replace(/-review\.json$/, '')}</option>
                    ))}
                  </select>
                </label>
              </div>
              {importPreflightLoading ? (
                <p style={{ margin: '0.75rem 0 0', color: '#fbbf24' }}>Checking accepted rows…</p>
              ) : importPreflightError ? (
                <p style={{ margin: '0.75rem 0 0', color: '#f87171' }}>{importPreflightError}</p>
              ) : importPreflight ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.55rem', marginTop: '0.8rem' }}>
                    {[
                      ['Scope', importPreflight.reportFile === 'all' ? importPreflight.source : importPreflight.reportFile, '#bae6fd'],
                      ['Accepted', importPreflight.acceptedTotal, '#86efac'],
                      ['Inspected', importPreflight.rowsInspected, '#e5e7eb'],
                      ['Ready', importPreflight.candidateReady, '#22c55e'],
                      ['Not Inspected', importPreflight.rowsNotInspected, importPreflight.rowsNotInspected ? '#fbbf24' : '#94a3b8'],
                    ].map(([label, value, tone]) => (
                      <div key={label} style={{ borderTop: '1px solid rgba(148, 163, 184, 0.18)', paddingTop: '0.45rem' }}>
                        <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                        <div style={{ color: tone, fontSize: '1.15rem', fontWeight: 900, overflowWrap: 'anywhere' }}>
                          {label === 'Scope' ? value : formatCount(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {importReadinessRows.length ? (
                    <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                      {importReadinessRows.map(row => (
                        <span key={row.readiness} style={badgeStyle}>
                          {row.readiness}: {formatCount(row.rows)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: '0.75rem 0 0', color: '#94a3b8' }}>No accepted likely-new rows are waiting for import preflight.</p>
                  )}
                  {Number(importPreflight.canonicalRowsPrefetched) > 0 ? (
                    <p style={{ margin: '0.65rem 0 0', color: '#94a3b8', fontSize: '0.82rem' }}>
                      Duplicate check used {formatCount(importPreflight.canonicalRowsPrefetched)} prefetched canonical rows across {formatCount(importPreflight.coordinateGridCellsBuilt)} grid cells.
                    </p>
                  ) : null}
                  {importCandidateRows.length ? (
                    <div style={{ marginTop: '0.85rem' }}>
                      <h4 style={{ margin: '0 0 0.45rem', color: '#e5e7eb', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Candidate Preview</h4>
                      <div style={tableWrapStyle}>
                        <table style={{ ...tableStyle, minWidth: 980 }}>
                          <thead>
                            <tr>
                              <th style={thStyle}>Readiness</th>
                              <th style={thStyle}>Canonical Name</th>
                              <th style={thStyle}>Source Label</th>
                              <th style={thStyle}>Address</th>
                              <th style={thStyle}>Nearest Canonical</th>
                              <th style={thStyle}>Links</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importCandidateRows.map(row => {
                              const sourceUrl = safeHttpUrl(row.proposed_website_url)
                              const mapsUrl = googleMapsCoordinateUrl(
                                Number.isFinite(Number(row.proposed_lat)) && Number.isFinite(Number(row.proposed_lng))
                                  ? { lat: Number(row.proposed_lat), lng: Number(row.proposed_lng) }
                                  : null
                              )
                              return (
                                <tr key={row.review_id}>
                                  <td style={tdStyle}>
                                    <span style={badgeStyle}>{row.readiness}</span>
                                  </td>
                                  <td style={tdStyle}>{row.proposed_name || 'n/a'}</td>
                                  <td style={tdStyle}>{row.source_name || 'n/a'}</td>
                                  <td style={tdStyle}>{row.proposed_address || 'n/a'}</td>
                                  <td style={tdStyle}>
                                    {row.nearest_place_name
                                      ? `${row.nearest_place_name} (${Math.round(Number(row.nearest_distance_m) || 0)}m)`
                                      : 'none inside radius'}
                                  </td>
                                  <td style={tdStyle}>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Source</a> : null}
                                      {mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Map</a> : null}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                  {Number(importPreflight.candidateReady) > 0 ? (
                    <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={importReviewedNewCandidates}
                        disabled={importReviewedNewBusy || importPreflightLoading}
                        style={{ border: '1px solid #16a34a', borderRadius: 8, background: 'transparent', color: '#86efac', padding: '0.55rem 0.75rem', fontWeight: 900, cursor: importReviewedNewBusy || importPreflightLoading ? 'not-allowed' : 'pointer', opacity: importReviewedNewBusy || importPreflightLoading ? 0.55 : 1 }}
                      >
                        {importReviewedNewBusy ? 'Importing…' : `Import ${formatCount(importPreflight.candidateReady)} ready locally`}
                      </button>
                      <span style={{ color: '#94a3b8', fontSize: '0.84rem' }}>
                        Writes local canonical rows and source evidence only.
                      </span>
                    </div>
                  ) : null}
                  {(reviewedNewSyncHandoff || reviewedNewEnrichmentHandoff) ? (
                    <div style={{ marginTop: '0.85rem', border: '1px solid rgba(56, 189, 248, 0.28)', borderRadius: 10, background: 'rgba(14, 165, 233, 0.08)', padding: '0.85rem', display: 'grid', gap: '0.55rem' }}>
                      {reviewedNewEnrichmentHandoff ? (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                            <strong style={{ color: '#dcfce7' }}>Local enrichment handoff</strong>
                            <span style={badgeStyle}>{formatCount(reviewedNewEnrichmentHandoff.ids.length)} reviewed-new ids</span>
                          </div>
                          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.84rem' }}>
                            Enqueue scrape first. Enqueue classify after scrape has written fetched page data.
                          </p>
                          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.84rem' }}>
                            For reviewed ATP imports without websites, run the deterministic dry-run before the apply command.
                          </p>
                          <div style={{ display: 'grid', gap: '0.25rem' }}>
                            <strong style={{ color: '#bbf7d0', fontSize: '0.82rem' }}>Scrape queue</strong>
                            {reviewedNewEnrichmentHandoff.scrape.map(command => (
                              <code key={command} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1' }}>{command}</code>
                            ))}
                          </div>
                          {reviewedNewEnrichmentHandoff.classify ? (
                            <div style={{ display: 'grid', gap: '0.25rem' }}>
                              <strong style={{ color: '#bbf7d0', fontSize: '0.82rem' }}>Classify queue</strong>
                              {reviewedNewEnrichmentHandoff.classify.map(command => (
                                <code key={command} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1' }}>{command}</code>
                              ))}
                            </div>
                          ) : null}
                          {reviewedNewEnrichmentHandoff.deterministic ? (
                            <div style={{ display: 'grid', gap: '0.25rem' }}>
                              <strong style={{ color: '#bbf7d0', fontSize: '0.82rem' }}>Deterministic no-website classification</strong>
                              <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1' }}>{reviewedNewEnrichmentHandoff.deterministic.dryRun}</code>
                              <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1' }}>{reviewedNewEnrichmentHandoff.deterministic.apply}</code>
                            </div>
                          ) : null}
                          {reviewedNewEnrichmentHandoff.unsupported ? (
                            <div style={{ display: 'grid', gap: '0.25rem', color: '#fbbf24', fontSize: '0.84rem' }}>
                              <strong>Not yet automated for this dataset</strong>
                              <span>{reviewedNewEnrichmentHandoff.unsupported.classify}</span>
                              <span>{reviewedNewEnrichmentHandoff.unsupported.deterministic}</span>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {reviewedNewSyncHandoff?.unsupported ? (
                        <div style={{ display: 'grid', gap: '0.25rem', color: '#fbbf24', fontSize: '0.84rem' }}>
                          <strong>Supabase publish handoff unavailable</strong>
                          <span>{reviewedNewSyncHandoff.reason}</span>
                        </div>
                      ) : reviewedNewSyncHandoff ? (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                            <strong style={{ color: '#e0f2fe' }}>Supabase publish handoff</strong>
                            <span style={badgeStyle}>{formatCount(reviewedNewSyncHandoff.ids.length)} reviewed-new ids</span>
                          </div>
                          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.84rem' }}>
                            Run the dry-run first, then the apply command only if it shows reviewed-new inserts for this exact id list.
                          </p>
                          <div style={{ display: 'grid', gap: '0.25rem' }}>
                            <strong style={{ color: '#bae6fd', fontSize: '0.82rem' }}>Dry run</strong>
                            <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1' }}>{reviewedNewSyncHandoff.dryRun}</code>
                          </div>
                          <div style={{ display: 'grid', gap: '0.25rem' }}>
                            <strong style={{ color: '#bae6fd', fontSize: '0.82rem' }}>Apply</strong>
                            <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#cbd5e1' }}>{reviewedNewSyncHandoff.apply}</code>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>

          <section id="source-review-queue" style={blockStyle}>
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
            <h2 style={{ margin: '0 0 0.75rem', color: '#f8fafc', fontSize: '1rem' }}>Recent Source Links</h2>
            <p style={{ margin: '0 0 0.75rem', color: '#94a3b8' }}>
              Latest local place_sources evidence attached to canonical places. This table is provenance visibility only; it does not sync raw evidence to Supabase.
            </p>
            <div style={tableWrapStyle}>
              <table style={{ ...tableStyle, minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Canonical Place</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Source ID</th>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>Confidence</th>
                    <th style={thStyle}>Updated</th>
                    <th style={thStyle}>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {(database.recentPlaceSources || []).map(row => {
                    const sourceUrl = safeHttpUrl(row.source_url)
                    return (
                      <tr key={`${row.source}-${row.source_id}-${row.place_id}`}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 800, color: '#f8fafc' }}>{row.place_name || `Place ${row.place_id}`}</div>
                          <div style={{ color: '#94a3b8' }}>
                            id {row.place_id}{row.google_place_id ? ` · ${row.google_place_id}` : ''}
                          </div>
                        </td>
                        <td style={tdStyle}>{row.source}</td>
                        <td style={{ ...tdStyle, overflowWrap: 'anywhere' }}>{row.source_id}</td>
                        <td style={tdStyle}>{row.match_method}</td>
                        <td style={tdStyle}>{row.match_confidence == null ? 'n/a' : Number(row.match_confidence).toFixed(2)}</td>
                        <td style={tdStyle}>{formatDateTime(row.updated_at || row.retrieved_at)}</td>
                        <td style={tdStyle}>
                          {sourceUrl ? (
                            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8' }}>Open source</a>
                          ) : (
                            <span style={{ color: '#64748b' }}>n/a</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
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

                {pendingReadinessBuckets.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.65rem' }}>
                    <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '0.95rem' }}>Pending Readiness</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem' }}>
                      {pendingReadinessBuckets.map(row => (
                        <button
                          key={`${row.review_kind}-${row.status}-${row.readiness}`}
                          type="button"
                          onClick={() => focusReviewBucket({
                            kind: row.review_kind,
                            status: row.status,
                            readiness: row.readiness,
                          })}
                          style={bucketButtonStyle}
                          title="Show this readiness bucket"
                        >
                          <span style={{ color: '#38bdf8', fontSize: '1.15rem', fontWeight: 900 }}>{formatCount(row.rows)}</span>
                          <span style={{ fontWeight: 850 }}>{String(row.readiness || '').replace(/_/g, ' ')}</span>
                          <span style={{ color: '#94a3b8' }}>{row.review_kind} · {row.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {nextReviewWork.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.65rem' }}>
                    <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '0.95rem' }}>Review Worklist</h3>
                    <div style={tableWrapStyle}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Next</th>
                            <th style={thStyle}>Source</th>
                            <th style={thStyle}>Ambiguous</th>
                            <th style={thStyle}>Likely New</th>
                            <th style={thStyle}>Priority</th>
                            <th style={thStyle}>Report</th>
                          </tr>
                        </thead>
                        <tbody>
                          {nextReviewWork.map(row => (
                            <tr key={`${row.source}-${row.reportFile || 'none'}`}>
                              <td style={tdStyle}>
                                <button
                                  type="button"
                                  onClick={() => focusReviewBucket(row.plan.filter)}
                                  style={{
                                    border: `1px solid ${row.plan.tone}`,
                                    borderRadius: 8,
                                    background: 'rgba(15, 23, 42, 0.72)',
                                    color: row.plan.tone,
                                    padding: '0.45rem 0.65rem',
                                    fontWeight: 850,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                  title={row.plan.detail}
                                >
                                  {row.plan.title}
                                </button>
                              </td>
                              <td style={tdStyle}>{row.source || 'unknown'}</td>
                              <td style={tdStyle}>{formatCount(row.ambiguous)}</td>
                              <td style={tdStyle}>{formatCount(row.likelyNew)}</td>
                              <td style={tdStyle}>{formatCount(row.priority)}</td>
                              <td style={{ ...tdStyle, overflowWrap: 'anywhere', color: '#94a3b8' }}>{row.reportFile || 'no report file'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.86rem' }}>
                      Work ambiguous rows first, then likely-new candidates. Accepting likely-new rows does not create places; import still requires reviewed-new preflight.
                    </p>
                  </div>
                ) : null}

                {pendingReviewBuckets.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.65rem' }}>
                    <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '0.95rem' }}>Largest Pending Buckets</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.65rem' }}>
                      {pendingReviewBuckets.map(row => (
                        <button
                          key={`${row.source}-${row.report_file}-${row.review_kind}-${row.status}`}
                          type="button"
                          onClick={() => focusReviewBucket({
                            source: row.source,
                            reportFile: row.report_file,
                            kind: row.review_kind,
                            status: row.status,
                          })}
                          style={bucketButtonStyle}
                          title="Show this durable review queue bucket"
                        >
                          <span style={{ color: '#38bdf8', fontSize: '1.15rem', fontWeight: 900 }}>{formatCount(row.rows)}</span>
                          <span style={{ fontWeight: 850 }}>{row.review_kind} · {row.source}</span>
                          <span style={{ color: '#94a3b8', overflowWrap: 'anywhere' }}>{row.report_file || 'no report file'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

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
                    Readiness
                    <select
                      value={queueReadiness}
                      onChange={event => setQueueReadiness(event.target.value)}
                      style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    >
                      {REVIEW_READINESS_OPTIONS.map(option => (
                        <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700 }}>
                    Feed scope
                    <select
                      value={queueScope}
                      onChange={event => setQueueScope(event.target.value)}
                      style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    >
                      {REVIEW_SCOPE_OPTIONS.map(option => (
                        <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem', color: '#cbd5e1', fontWeight: 700 }}>
                    State / region
                    <input
                      value={queueState}
                      onChange={event => setQueueState(event.target.value)}
                      placeholder="MI, NY, Ontario"
                      style={{ width: 110, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                    />
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
                    {selectableVisibleIds.length > 0 ? (
                      <button
                        type="button"
                        disabled={queueLoading || bulkBusy || importReviewedNewBusy}
                        onClick={toggleVisibleSelection}
                        style={{ border: '1px solid #475569', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.55rem 0.75rem', fontWeight: 800, cursor: queueLoading || bulkBusy || importReviewedNewBusy ? 'not-allowed' : 'pointer', opacity: queueLoading || bulkBusy || importReviewedNewBusy ? 0.5 : 1 }}
                      >
                        {allVisibleSelected ? 'Clear visible' : 'Select visible'}
                      </button>
                    ) : null}
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
                    {queueSearch || queueSource || queueReportFile || queueKind || queueReadiness || queueScope || queueState ? (
                      <button
                        type="button"
                        onClick={() => {
                          setQueueSearch('')
                          setQueueSource('')
                          setQueueKind('')
                          setQueueReadiness('')
                          setQueueScope('')
                          setQueueReportFile('')
                        }}
                        style={{ border: '1px solid #475569', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.55rem 0.75rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>

                {queueTotal > 0 ? (
                  <div
                    aria-label="Current queue export command"
                    style={{
                      border: '1px solid rgba(56, 189, 248, 0.24)',
                      borderRadius: 10,
                      background: 'rgba(14, 165, 233, 0.08)',
                      padding: '0.75rem',
                      display: 'grid',
                      gap: '0.35rem',
                    }}
                  >
                    <strong style={{ color: '#bae6fd', fontSize: '0.84rem' }}>Export current filtered queue</strong>
                    <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>
                      Uses the current status, kind, source, report, readiness, and search filters.
                    </span>
                    <code style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {currentQueueExportCommand}
                    </code>
                  </div>
                ) : null}

                {queueStatus === 'pending' && selectedIds.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.65rem', border: '1px solid rgba(251, 191, 36, 0.28)', borderRadius: 10, background: 'rgba(251, 191, 36, 0.08)', padding: '0.7rem' }}>
                    <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong style={{ color: '#fde68a' }}>{formatCount(selectedIds.length)} selected</strong>
                      <span style={{ color: '#94a3b8' }}>Bulk accept affects pending likely-new rows; bulk link affects pending ambiguous rows with a nearest canonical place.</span>
                      <button
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => recordBulkDecision('accepted')}
                        style={{ border: '1px solid #16a34a', borderRadius: 8, background: 'transparent', color: '#86efac', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.5 : 1 }}
                      >
                        Accept selected as new candidates
                      </button>
                      <button
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => recordBulkDecision('linked')}
                        style={{ border: '1px solid #38bdf8', borderRadius: 8, background: 'transparent', color: '#7dd3fc', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.5 : 1 }}
                      >
                        Link selected to nearest
                      </button>
                      <button
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => recordBulkDecision('rejected')}
                        style={{ border: '1px solid #f87171', borderRadius: 8, background: 'transparent', color: '#fca5a5', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.5 : 1 }}
                      >
                        Reject selected
                      </button>
                      <button
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => recordBulkDecision('ignored')}
                        style={{ border: '1px solid #64748b', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.5 : 1 }}
                      >
                        Ignore selected
                      </button>
                    </div>
                    <div aria-label="Selected row eligibility" style={{ color: '#fde68a', fontSize: '0.84rem', fontWeight: 800 }}>
                      {selectedEligibilitySummary.text}
                    </div>
                    {selectedQueueExportCommand ? (
                      <div aria-label="Selected queue export command" style={{ display: 'grid', gap: '0.25rem' }}>
                        <strong style={{ color: '#fde68a', fontSize: '0.82rem' }}>Export selected rows</strong>
                        <code style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selectedQueueExportCommand}</code>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {queueStatus === 'accepted' && queueKind === 'likely_new' && selectedIds.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.65rem', border: '1px solid rgba(34, 197, 94, 0.28)', borderRadius: 10, background: 'rgba(34, 197, 94, 0.08)', padding: '0.7rem' }}>
                    <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong style={{ color: '#bbf7d0' }}>{formatCount(selectedIds.length)} selected</strong>
                      <span style={{ color: '#94a3b8' }}>Imports selected accepted likely-new rows by exact review ID after a fresh duplicate check.</span>
                      <button
                        type="button"
                        disabled={importReviewedNewBusy}
                        onClick={importSelectedReviewedNewCandidates}
                        style={{ border: '1px solid #16a34a', borderRadius: 8, background: 'transparent', color: '#86efac', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: importReviewedNewBusy ? 'not-allowed' : 'pointer', opacity: importReviewedNewBusy ? 0.5 : 1 }}
                      >
                        Import selected locally
                      </button>
                    </div>
                    <div aria-label="Selected row eligibility" style={{ color: '#bbf7d0', fontSize: '0.84rem', fontWeight: 800 }}>
                      {selectedEligibilitySummary.text}
                    </div>
                    {selectedQueueExportCommand ? (
                      <div aria-label="Selected queue export command" style={{ display: 'grid', gap: '0.25rem' }}>
                        <strong style={{ color: '#bbf7d0', fontSize: '0.82rem' }}>Export selected rows</strong>
                        <code style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selectedQueueExportCommand}</code>
                      </div>
                    ) : null}
                  </div>
                ) : null}

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
                      const nearestWebsite = safeHttpUrl(row.nearest_website_url || '')
                      const nearestLat = Number(row.nearest_lat)
                      const nearestLng = Number(row.nearest_lng)
                      const canonicalMapsUrl = Number.isFinite(nearestLat) && Number.isFinite(nearestLng)
                        ? googleMapsCoordinateUrl({ lat: nearestLat, lng: nearestLng })
                        : ''
                      const decisionWebsite = safeHttpUrl(row.decision_canonical_website_url || '')
                      const decisionLat = Number(row.decision_canonical_lat)
                      const decisionLng = Number(row.decision_canonical_lng)
                      const decisionMapsUrl = Number.isFinite(decisionLat) && Number.isFinite(decisionLng)
                        ? googleMapsCoordinateUrl({ lat: decisionLat, lng: decisionLng })
                        : ''
                      const decisionOsmUrl = osmUrl(row.decision_canonical_google_place_id)
                      const distanceLabel = row.nearest_distance_m != null
                        ? `${Number(row.nearest_distance_m).toFixed(1)}m`
                        : 'no distance'
                      const scoreLabel = row.nearest_name_score != null
                        ? Number(row.nearest_name_score).toFixed(2)
                        : 'n/a'
                      const sourceSignalCount = Number(row.source_signal_count) || 0
                      const readinessLabel = String(row.review_readiness || '').replace(/_/g, ' ') || 'n/a'
                      const decisionHint = row.review_kind === 'likely_new'
                        ? 'Likely-new rows are sorted by source evidence first, then by farther distance from the nearest canonical place.'
                        : 'Link ambiguous rows to an existing canonical place or reject/ignore them.'
                      const busy = Boolean(actionState[row.id])
                      const canAcceptNew = row.review_kind === 'likely_new'
                      const draft = decisionDrafts[row.id] || {}
                      const draftCanonicalPlaceId = draft.canonicalPlaceId ?? (row.nearest_place_id ? String(row.nearest_place_id) : '')
                      const draftNotes = draft.reviewerNotes || ''
                      const rowSelected = Boolean(selectedReviewIds[String(row.id)])
                      const recommendation = reviewRecommendation(row)
                      const expectedBrand = sourceReviewBrand(row)
                      const canonicalLines = canonicalContextLines(row)
                      const decisionLines = decisionCanonicalContextLines(row)
                      const lifecycle = reviewLifecycleCopy(row)
                      const checklist = reviewDecisionChecklist(row)
                      return (
                        <article key={row.id} style={{ border: '1px solid rgba(148, 163, 184, 0.16)', borderRadius: 10, padding: '0.9rem', background: '#101418' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                              {row.status === 'pending' || (row.status === 'accepted' && row.review_kind === 'likely_new') ? (
                                <input
                                  type="checkbox"
                                  checked={rowSelected}
                                  onChange={() => toggleReviewSelection(row.id)}
                                  disabled={busy || bulkBusy || importReviewedNewBusy}
                                  aria-label={`Select ${row.source_name || row.source_id}`}
                                  style={{ marginTop: '0.18rem', width: 18, height: 18, accentColor: '#38bdf8' }}
                                />
                              ) : null}
                              <div>
                                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1rem' }}>{row.source_name || row.source_id}</h3>
                                <p style={{ margin: '0.25rem 0 0', color: '#94a3b8' }}>
                                  {row.review_kind} · {row.source} · {row.source_id}
                                </p>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                  <span style={badgeStyle}>{row.report_file || 'no report'}</span>
                                  <span style={badgeStyle}>distance {distanceLabel}</span>
                                  <span style={badgeStyle}>score {scoreLabel}</span>
                                  <span style={badgeStyle}>signals {sourceSignalCount}/4</span>
                                  <span style={badgeStyle}>{readinessLabel}</span>
                                  {expectedBrand ? <span style={badgeStyle}>expected {expectedBrand.label}</span> : null}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'end', minWidth: 150 }}>
                              <div style={{ color: '#cbd5e1', fontWeight: 800 }}>{row.status}</div>
                              <div style={{ border: `1px solid ${lifecycle.tone}`, borderRadius: 999, color: lifecycle.tone, padding: '0.22rem 0.55rem', fontSize: '0.74rem', fontWeight: 900 }}>
                                {lifecycle.label}
                              </div>
                              <div style={{ border: `1px solid ${recommendation.tone}`, borderRadius: 999, color: recommendation.tone, padding: '0.22rem 0.55rem', fontSize: '0.74rem', fontWeight: 900 }}>
                                {recommendation.label}
                              </div>
                            </div>
                          </div>
                          <p style={{ margin: '0.7rem 0 0', color: '#94a3b8', fontSize: '0.84rem' }}>{recommendation.detail}</p>
                          <p style={{ margin: '0.35rem 0 0', color: lifecycle.tone, fontSize: '0.84rem' }}>{lifecycle.detail}</p>
                          {checklist.length ? (
                            <div style={{ marginTop: '0.65rem', border: '1px solid rgba(148, 163, 184, 0.14)', borderRadius: 8, padding: '0.65rem', background: 'rgba(15, 23, 42, 0.4)' }}>
                              <strong style={{ color: '#f8fafc', fontSize: '0.82rem' }}>Decision checklist</strong>
                              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', color: '#cbd5e1', fontSize: '0.82rem' }}>
                                {checklist.map(item => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
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
                              {canonicalLines.map(line => (
                                <div key={line}>{line}</div>
                              ))}
                              <div>{row.nearest_place_id ? `id ${row.nearest_place_id}` : ''}</div>
                              <div>
                                {distanceLabel}
                                {row.nearest_name_score != null ? ` · score ${scoreLabel}` : ''}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', marginTop: '0.35rem' }}>
                                {nearestOsmUrl ? <a href={nearestOsmUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Open OSM</a> : null}
                                {canonicalMapsUrl ? <a href={canonicalMapsUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Open canonical map</a> : null}
                                {nearestWebsite ? <a href={nearestWebsite} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Canonical website</a> : null}
                              </div>
                            </div>
                            <div>
                              <strong style={{ color: '#f8fafc' }}>Review</strong>
                              <div>{row.review_reason || 'n/a'}</div>
                              <div>{row.report_file || ''}</div>
                              {decisionLines.length ? (
                                <div style={{ marginTop: '0.55rem', borderTop: '1px solid rgba(148, 163, 184, 0.14)', paddingTop: '0.55rem' }}>
                                  <strong style={{ color: '#f8fafc' }}>Decision canonical</strong>
                                  {decisionLines.map(line => (
                                    <div key={line}>{line}</div>
                                  ))}
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', marginTop: '0.35rem' }}>
                                    {decisionOsmUrl ? <a href={decisionOsmUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Open OSM</a> : null}
                                    {decisionMapsUrl ? <a href={decisionMapsUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Open map</a> : null}
                                    {decisionWebsite ? <a href={decisionWebsite} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Website</a> : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {queueStatus === 'pending' ? (
                            <div style={{ marginTop: '0.85rem', display: 'grid', gap: '0.65rem' }}>
                              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.84rem' }}>{decisionHint}</p>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.65rem', alignItems: 'end' }}>
                                <label style={{ display: 'grid', gap: '0.3rem', color: '#cbd5e1', fontWeight: 700 }}>
                                  Canonical place id
                                  <input
                                    type="number"
                                    min="1"
                                    value={draftCanonicalPlaceId}
                                    onChange={event => updateDecisionDraft(row.id, { canonicalPlaceId: event.target.value })}
                                    disabled={busy}
                                    style={{ minWidth: 0, padding: '0.5rem 0.65rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                                  />
                                </label>
                                <label style={{ display: 'grid', gap: '0.3rem', color: '#cbd5e1', fontWeight: 700 }}>
                                  Notes
                                  <input
                                    type="text"
                                    value={draftNotes}
                                    onChange={event => updateDecisionDraft(row.id, { reviewerNotes: event.target.value })}
                                    placeholder="Optional review note"
                                    disabled={busy}
                                    style={{ minWidth: 0, padding: '0.5rem 0.65rem', borderRadius: 8, border: '1px solid #374151', background: '#0f172a', color: '#f8fafc' }}
                                  />
                                </label>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {canAcceptNew ? (
                                  <button type="button" disabled={busy} onClick={() => recordDecision(row, 'accepted')} style={{ border: '1px solid #16a34a', borderRadius: 8, background: 'transparent', color: '#86efac', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>Accept new</button>
                                ) : null}
                                <button type="button" disabled={busy} onClick={() => recordDecision(row, 'linked')} style={{ border: '1px solid #38bdf8', borderRadius: 8, background: 'transparent', color: '#7dd3fc', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>Link</button>
                                {row.review_kind === 'ambiguous' ? (
                                  <button type="button" disabled={busy} onClick={() => reclassifyAsLikelyNew(row)} style={{ border: '1px solid #fb923c', borderRadius: 8, background: 'transparent', color: '#fdba74', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>Review as likely-new</button>
                                ) : null}
                                <button type="button" disabled={busy} onClick={() => recordDecision(row, 'rejected')} style={{ border: '1px solid #f87171', borderRadius: 8, background: 'transparent', color: '#fca5a5', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>Reject</button>
                                <button type="button" disabled={busy} onClick={() => recordDecision(row, 'ignored')} style={{ border: '1px solid #64748b', borderRadius: 8, background: 'transparent', color: '#cbd5e1', padding: '0.45rem 0.65rem', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>Ignore</button>
                              </div>
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
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => focusReviewReport(row.file)}
                        style={{ ...reviewFilterButtonStyle, maxWidth: 260, overflowWrap: 'anywhere', textAlign: 'left' }}
                        title="Show this report in the durable review queue"
                      >
                        {row.file}
                      </button>
                    </td>
                    <td style={tdStyle}>{row.sourceLabel || row.source}</td>
                    <td style={tdStyle}>{formatCount(row.inputRows)}</td>
                    <td style={tdStyle}>{formatCount(row.matched)}</td>
                    <td style={tdStyle}>
                      {Number(row.ambiguous) > 0 ? (
                        <button
                          type="button"
                          onClick={() => focusReviewReport(row.file, 'ambiguous')}
                          style={reviewFilterButtonStyle}
                          title="Show ambiguous rows from this report"
                        >
                          {formatCount(row.ambiguous)}
                        </button>
                      ) : formatCount(row.ambiguous)}
                    </td>
                    <td style={tdStyle}>
                      {Number(row.likelyNew) > 0 ? (
                        <button
                          type="button"
                          onClick={() => focusReviewReport(row.file, 'likely_new')}
                          style={reviewFilterButtonStyle}
                          title="Show likely-new rows from this report"
                        >
                          {formatCount(row.likelyNew)}
                        </button>
                      ) : formatCount(row.likelyNew)}
                    </td>
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
