import React, { useCallback, useEffect, useMemo, useState } from 'react'
import AdminReviewEditor from './AdminReviewEditor'
import AdminSourceProvenancePanel from './AdminSourceProvenancePanel'
import AdminSuggestionsPanel from './AdminSuggestionsPanel'
import { isSupportedReviewPhotoFile, prepareReviewPhotoUpload } from '../utils/uploadPhoto'

const MAX_PHOTOS = 10
const ENTITY_OPTIONS = [
  { label: 'Pizza Reviews', value: 'pizza' },
  { label: 'Taco Reviews', value: 'taco' },
]

const ADMIN_TABS = [
  { id: 'photos', label: 'Photo Manager' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'sources', label: 'Sources' },
]

const authShellStyle = {
  display: 'grid',
  placeItems: 'center',
  minHeight: '100vh',
  backgroundColor: '#181a1b',
  padding: '2rem',
}

const cardStyle = {
  background: '#202224',
  borderRadius: 12,
  padding: '2rem',
  boxShadow: '0 18px 44px rgba(0,0,0,0.25)',
  width: 'min(720px, 95vw)',
}

const normalizeSearchText = value => String(value ?? '').trim().toLowerCase()

const formatReviewLocation = review => {
  const parts = [review?.address, review?.city, review?.state].filter(Boolean)
  return parts.length ? parts.join(', ') : 'No address on this review'
}

const readErrorMessage = async (res, fallback) => {
  const text = await res.text()
  if (res.status === 413) {
    return 'Photo upload is too large after processing. Try a smaller image or upload fewer photos at once.'
  }
  try {
    const parsed = JSON.parse(text)
    return parsed?.error || fallback
  } catch (err) {
    return text || fallback
  }
}

export default function AdminReviewsPage() {
  const [authChecked, setAuthChecked] = useState(false)
  const [isAuthed, setIsAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')

  const [entity, setEntity] = useState('pizza')
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('photos')
  const [reviewSearch, setReviewSearch] = useState('')
  const [photoFilter, setPhotoFilter] = useState('all')
  const [selectedReviewId, setSelectedReviewId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function checkAuth() {
      try {
        const res = await fetch('/api/admin/check', { credentials: 'include' })
        if (!res.ok) throw new Error('unauthorized')
        const data = await res.json()
        if (!cancelled && data?.authorized) {
          setIsAuthed(true)
        }
      } catch (err) {
        if (!cancelled) {
          setIsAuthed(false)
        }
      } finally {
        if (!cancelled) setAuthChecked(true)
      }
    }
    checkAuth()
    return () => {
      cancelled = true
    }
  }, [])

  const fetchReviews = useCallback(
    async currentEntity => {
      if (!isAuthed) return
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/admin/reviews?entity=${currentEntity}`, { credentials: 'include' })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to load reviews')
        }
        const payload = await res.json()
        if (!Array.isArray(payload?.data)) {
          throw new Error('Unexpected response from server')
        }
        setReviews(payload.data)
      } catch (err) {
        setError(err?.message || 'Failed to load reviews.')
      } finally {
        setLoading(false)
      }
    },
    [isAuthed]
  )

  useEffect(() => {
    if (isAuthed && activeTab === 'photos') {
      fetchReviews(entity)
    }
  }, [entity, isAuthed, fetchReviews, activeTab])

  useEffect(() => {
    setReviewSearch('')
    setPhotoFilter('all')
    setSelectedReviewId(null)
  }, [entity])

  const handleLogin = async event => {
    event.preventDefault()
    if (!password) return
    setLoginError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        throw new Error('Invalid password')
      }
      setIsAuthed(true)
      setPassword('')
      if (activeTab === 'photos') {
        fetchReviews(entity)
      }
    } catch (err) {
      setLoginError('Access denied. Double-check the password.')
    }
  }

  const updatePhotosState = useCallback((reviewId, nextPhotos) => {
    setReviews(prev =>
      prev.map(review => (review.id === reviewId ? { ...review, photos: Array.isArray(nextPhotos) ? nextPhotos : [] } : review))
    )
  }, [])

  const handleUpload = useCallback(
    async (reviewId, files) => {
      const review = reviews.find(item => item.id === reviewId)
      if (!review) throw new Error('Review not found')
      const safeFiles = Array.isArray(files) ? files.filter(isSupportedReviewPhotoFile) : []
      const currentCount = Array.isArray(review.photos) ? review.photos.length : 0
      const remaining = MAX_PHOTOS - currentCount
      if (remaining <= 0) {
        throw new Error('Photo limit reached for this review.')
      }
      const uploadQueue = safeFiles.slice(0, remaining)
      if (uploadQueue.length === 0) {
        throw new Error('No valid images selected.')
      }

      let latestPhotos = Array.isArray(review.photos) ? review.photos : []
      for (const file of uploadQueue) {
        const prepared = await prepareReviewPhotoUpload(file, { reviewId })
        const res = await fetch(`/api/admin/reviews/${reviewId}/photos/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            files: [{
              path: prepared.path,
              size: prepared.size,
              mimeType: prepared.mimeType,
              dataBase64: prepared.dataBase64,
            }],
          }),
        })
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, 'Failed to upload review photo.'))
        }
        const payload = await res.json()
        latestPhotos = Array.isArray(payload?.data) ? payload.data : latestPhotos
        updatePhotosState(reviewId, latestPhotos)
      }

      return latestPhotos
    },
    [reviews, updatePhotosState]
  )

  const handleReorder = useCallback(
    async (reviewId, nextPhotos) => {
      const order = Array.isArray(nextPhotos) ? nextPhotos.map(photo => photo.id).filter(Boolean) : []
      if (order.length === 0) {
        throw new Error('Unable to determine new order.')
      }
      const res = await fetch(`/api/admin/reviews/${reviewId}/photos/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to update photo order.')
      }
      const payload = await res.json()
      updatePhotosState(reviewId, payload?.data)
      return payload?.data
    },
    [updatePhotosState]
  )

  const handleDelete = useCallback(
    async (reviewId, photoId) => {
      const res = await fetch(`/api/admin/review-photos/${photoId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to delete review photo.')
      }
      const payload = await res.json()
      updatePhotosState(reviewId, payload?.data)
      return payload?.data
    },
    [updatePhotosState]
  )

  const entityLabel = useMemo(() => ENTITY_OPTIONS.find(option => option.value === entity)?.label || 'Pizza Reviews', [entity])
  const isPhotosTab = activeTab === 'photos'
  const isSuggestionsTab = activeTab === 'suggestions'
  const isSourcesTab = activeTab === 'sources'
  const headerTitle = isPhotosTab ? 'Review Photos' : isSuggestionsTab ? 'Suggestions Inbox' : 'Source Provenance'
  const headerSubtitle = isPhotosTab
    ? 'Manage Supabase-hosted photos for each review. Drag to reorder, or remove any photo that needs to be replaced.'
    : isSuggestionsTab
      ? 'Review community suggestions and decide what should move onto the official map.'
      : 'Inspect local source evidence, match methods, and review backlog before promoting data into the canonical map.'
  const filteredReviews = useMemo(() => {
    const terms = normalizeSearchText(reviewSearch).split(/\s+/).filter(Boolean)
    return reviews.filter(review => {
      const photoCount = Array.isArray(review.photos) ? review.photos.length : 0
      if (photoFilter === 'needsPhotos' && photoCount > 0) return false
      if (photoFilter === 'hasPhotos' && photoCount === 0) return false
      if (terms.length === 0) return true

      const haystack = normalizeSearchText([
        review.name,
        review.address,
        review.city,
        review.state,
        review.notes,
        review.rating,
        review.status,
        review.style,
        review.type,
        review.price_range,
        review.google_place_id,
      ].filter(Boolean).join(' '))
      return terms.every(term => haystack.includes(term))
    })
  }, [photoFilter, reviewSearch, reviews])

  const filteredReviewIds = useMemo(() => filteredReviews.map(review => review.id), [filteredReviews])

  useEffect(() => {
    if (!filteredReviewIds.length) {
      setSelectedReviewId(null)
      return
    }
    if (!filteredReviewIds.includes(selectedReviewId)) {
      setSelectedReviewId(filteredReviewIds[0])
    }
  }, [filteredReviewIds, selectedReviewId])

  const selectedReview = useMemo(
    () => filteredReviews.find(review => review.id === selectedReviewId) || filteredReviews[0] || null,
    [filteredReviews, selectedReviewId]
  )
  const selectedReviewIndex = useMemo(
    () => (selectedReview ? filteredReviews.findIndex(review => review.id === selectedReview.id) : -1),
    [filteredReviews, selectedReview]
  )
  const selectedPhotoCount = Array.isArray(selectedReview?.photos) ? selectedReview.photos.length : 0
  const canSelectPreviousReview = selectedReviewIndex > 0
  const canSelectNextReview = selectedReviewIndex >= 0 && selectedReviewIndex < filteredReviews.length - 1
  const selectAdjacentReview = useCallback(
    offset => {
      if (selectedReviewIndex < 0) return
      const next = filteredReviews[selectedReviewIndex + offset]
      if (next) setSelectedReviewId(next.id)
    },
    [filteredReviews, selectedReviewIndex]
  )

  const photoStats = useMemo(() => {
    return reviews.reduce(
      (acc, review) => {
        const hasPhotos = Array.isArray(review.photos) && review.photos.length > 0
        if (hasPhotos) acc.withPhotos += 1
        else acc.needsPhotos += 1
        return acc
      },
      { withPhotos: 0, needsPhotos: 0 }
    )
  }, [reviews])

  if (!authChecked) {
    return (
      <div style={authShellStyle}>
        <p style={{ color: '#fff', fontSize: '1rem' }}>Checking admin access…</p>
      </div>
    )
  }

  if (!isAuthed) {
    return (
      <div style={authShellStyle}>
        <form onSubmit={handleLogin} style={cardStyle}>
          <h2 style={{ marginTop: 0, marginBottom: '0.5rem', textAlign: 'center', color: '#f97316' }}>Admin Access</h2>
          <p style={{ marginTop: 0, marginBottom: '1.5rem', color: '#d1d5db', textAlign: 'center' }}>
            Enter the admin password to manage review photos and suggestions.
          </p>
          <label style={{ display: 'grid', gap: '0.5rem', color: '#f8fafc', fontWeight: 600 }}>
            Password
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              style={{
                padding: '0.75rem',
                borderRadius: 8,
                border: '1px solid #2b2f31',
                background: '#181a1b',
                color: '#f8fafc',
              }}
            />
          </label>
          {loginError && (
            <p style={{ marginTop: '0.75rem', color: '#f87171', fontSize: '0.95rem' }}>{loginError}</p>
          )}
          <button
            type="submit"
            style={{
              marginTop: '1.5rem',
              width: '100%',
              padding: '0.9rem',
              borderRadius: 8,
              border: 'none',
              background: '#f97316',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Unlock
          </button>
        </form>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#111315', color: '#f8fafc', padding: '2rem 1.5rem 4rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, color: '#f97316' }}>{headerTitle}</h1>
          <p style={{ margin: '0.35rem 0 0', color: '#94a3b8' }}>
            {headerSubtitle}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label htmlFor="review-entity-select" style={{ fontWeight: 600, color: '#cbd5f5' }}>
            Dataset
          </label>
          <select
            id="review-entity-select"
            value={entity}
            onChange={event => setEntity(event.target.value)}
            style={{
              padding: '0.6rem 0.9rem',
              borderRadius: 8,
              border: '1px solid #2b2f31',
              background: '#1f2933',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            {ENTITY_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {ADMIN_TABS.map(tab => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '0.55rem 1.2rem',
                borderRadius: 999,
                border: active ? '1px solid #f97316' : '1px solid #374151',
                background: active ? '#f97316' : 'transparent',
                color: active ? '#fff' : '#cbd5f5',
                fontWeight: 600,
                letterSpacing: '0.03em',
                cursor: 'pointer',
                transition: 'background 120ms ease, color 120ms ease, transform 120ms ease',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <section style={{ marginTop: '2rem' }}>
        {isPhotosTab ? (
          <>
            {loading && <p style={{ color: '#fbbf24' }}>Loading {entityLabel.toLowerCase()}…</p>}
            {error && !loading && <p style={{ color: '#f87171' }}>{error}</p>}
            {!loading && !error && reviews.length > 0 && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 5,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  alignItems: 'center',
                  marginBottom: '1rem',
                  padding: '0.9rem',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 12,
                  background: 'rgba(17, 19, 21, 0.96)',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.24)',
                }}
              >
                <label htmlFor="review-search" style={{ display: 'grid', gap: '0.35rem', flex: '1 1 280px', minWidth: 0 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Find Review
                  </span>
                  <input
                    id="review-search"
                    type="search"
                    value={reviewSearch}
                    onChange={event => setReviewSearch(event.target.value)}
                    placeholder="Search name, address, style, rating, or notes"
                    style={{
                      width: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      padding: '0.7rem 0.8rem',
                      borderRadius: 8,
                      border: '1px solid #374151',
                      background: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '0.95rem',
                    }}
                  />
                </label>
                <label htmlFor="photo-filter" style={{ display: 'grid', gap: '0.35rem', flex: '0 1 180px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Photos
                  </span>
                  <select
                    id="photo-filter"
                    value={photoFilter}
                    onChange={event => setPhotoFilter(event.target.value)}
                    style={{
                      padding: '0.7rem 0.8rem',
                      borderRadius: 8,
                      border: '1px solid #374151',
                      background: '#0f172a',
                      color: '#f8fafc',
                      fontWeight: 600,
                    }}
                  >
                    <option value="all">All reviews</option>
                    <option value="needsPhotos">Needs photos</option>
                    <option value="hasPhotos">Has photos</option>
                  </select>
                </label>
                <div style={{ display: 'flex', alignItems: 'end', gap: '0.75rem', alignSelf: 'stretch' }}>
                  <div style={{ alignSelf: 'center', color: '#cbd5e1', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {filteredReviews.length}/{reviews.length}
                  </div>
                  {reviewSearch || photoFilter !== 'all' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReviewSearch('')
                        setPhotoFilter('all')
                        setSelectedReviewId(null)
                      }}
                      style={{
                        alignSelf: 'center',
                        border: '1px solid #475569',
                        borderRadius: 8,
                        background: 'transparent',
                        color: '#cbd5e1',
                        padding: '0.65rem 0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div style={{ flex: '1 0 100%', display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#94a3b8', fontSize: '0.85rem' }}>
                  <span>{photoStats.needsPhotos} need photos</span>
                  <span>{photoStats.withPhotos} have photos</span>
                </div>
                {filteredReviews.length > 1 && (
                  <div
                    style={{
                      flex: '1 0 100%',
                      display: 'flex',
                      gap: '0.5rem',
                      overflowX: 'auto',
                      padding: '0.15rem 0 0.1rem',
                    }}
                    aria-label="Matching reviews"
                  >
                    {filteredReviews.slice(0, 40).map(review => {
                      const isSelected = selectedReview?.id === review.id
                      const photoCount = Array.isArray(review.photos) ? review.photos.length : 0
                      return (
                        <button
                          key={review.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedReviewId(review.id)}
                          style={{
                            flex: '0 0 auto',
                            border: isSelected ? '1px solid #f97316' : '1px solid #334155',
                            borderRadius: 8,
                            background: isSelected ? 'rgba(249, 115, 22, 0.18)' : '#0f172a',
                            color: isSelected ? '#fed7aa' : '#cbd5e1',
                            padding: '0.45rem 0.65rem',
                            maxWidth: 220,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 }}>
                            {review.name || 'Untitled Location'}
                          </span>
                          <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {review.state || '—'} · {photoCount}/{MAX_PHOTOS} photos
                          </span>
                        </button>
                      )
                    })}
                    {filteredReviews.length > 40 && (
                      <span style={{ alignSelf: 'center', flex: '0 0 auto', color: '#94a3b8', fontSize: '0.8rem' }}>
                        + {filteredReviews.length - 40} more; narrow search to jump directly
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {!loading && !error && reviews.length === 0 && (
              <p style={{ color: '#94a3b8' }}>No reviews found for this dataset yet.</p>
            )}
            {!loading && !error && reviews.length > 0 && filteredReviews.length === 0 && (
              <p style={{ color: '#94a3b8' }}>No reviews match the current search.</p>
            )}
            {selectedReview && (
              <aside
                aria-label="Selected review"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: '1rem',
                  alignItems: 'center',
                  marginBottom: '1rem',
                  padding: '1rem',
                  border: '1px solid rgba(249, 115, 22, 0.28)',
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(15, 23, 42, 0.82))',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: '0 0 0.25rem', color: '#fed7aa', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Editing {selectedReviewIndex + 1} of {filteredReviews.length} matching reviews
                  </p>
                  <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedReview.name || 'Untitled Location'}
                  </h2>
                  <p style={{ margin: '0.35rem 0 0', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatReviewLocation(selectedReview)}
                  </p>
                  <p style={{ margin: '0.45rem 0 0', color: '#94a3b8', fontSize: '0.88rem' }}>
                    {[selectedReview.style || selectedReview.type, selectedReview.price_range || selectedReview.price, `${selectedPhotoCount}/${MAX_PHOTOS} photos`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    disabled={!canSelectPreviousReview}
                    onClick={() => selectAdjacentReview(-1)}
                    style={{
                      border: '1px solid #475569',
                      borderRadius: 8,
                      background: canSelectPreviousReview ? '#0f172a' : 'rgba(15, 23, 42, 0.45)',
                      color: canSelectPreviousReview ? '#e2e8f0' : '#64748b',
                      padding: '0.6rem 0.75rem',
                      fontWeight: 800,
                      cursor: canSelectPreviousReview ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!canSelectNextReview}
                    onClick={() => selectAdjacentReview(1)}
                    style={{
                      border: '1px solid #f97316',
                      borderRadius: 8,
                      background: canSelectNextReview ? '#f97316' : 'rgba(249, 115, 22, 0.32)',
                      color: canSelectNextReview ? '#fff' : '#fed7aa',
                      padding: '0.6rem 0.75rem',
                      fontWeight: 800,
                      cursor: canSelectNextReview ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Next
                  </button>
                </div>
              </aside>
            )}
            {selectedReview && (
              <AdminReviewEditor
                key={selectedReview.id}
                review={selectedReview}
                isAdmin={isAuthed}
                maxPhotos={MAX_PHOTOS}
                onUpload={files => handleUpload(selectedReview.id, files)}
                onReorder={next => handleReorder(selectedReview.id, next)}
                onDelete={photoId => handleDelete(selectedReview.id, photoId)}
              />
            )}
          </>
        ) : isSuggestionsTab ? (
          <AdminSuggestionsPanel entity={entity} />
        ) : isSourcesTab ? (
          <AdminSourceProvenancePanel entity={entity} />
        ) : (
          <p style={{ color: '#94a3b8' }}>Unknown admin tab.</p>
        )}
      </section>
    </div>
  )
}
