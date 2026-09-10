import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import AdminReviewEditor from './AdminReviewEditor'
import { isSupportedReviewPhotoFile, prepareReviewPhotoUpload } from '../utils/uploadPhoto'

const MAX_PHOTOS = 10
const normalize = value => String(value || '').trim().toLowerCase()

const reviewLocation = review => {
  const parts = [review?.address, review?.city, review?.state].filter(Boolean)
  return parts.length ? parts.join(', ') : 'No address'
}

const readErrorMessage = async (response, fallback) => {
  const text = await response.text()
  if (response.status === 413) return 'That upload is too large after processing. Try fewer photos or a smaller image.'
  try {
    return JSON.parse(text)?.error || fallback
  } catch (err) {
    return text || fallback
  }
}

export default function AdminPhotosPanel({ entity }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/admin/reviews?entity=${entity}`, { credentials: 'include' })
        if (!response.ok) throw new Error(await response.text())
        const payload = await response.json()
        if (!cancelled) setReviews(Array.isArray(payload?.data) ? payload.data : [])
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load reviewed places.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setSearch('')
    setFilter('all')
    setSelectedId(null)
    load()
    return () => {
      cancelled = true
    }
  }, [entity])

  const filtered = useMemo(() => {
    const terms = normalize(search).split(/\s+/).filter(Boolean)
    return reviews.filter(review => {
      const photoCount = Array.isArray(review.photos) ? review.photos.length : 0
      if (filter === 'missing' && photoCount > 0) return false
      if (filter === 'has' && photoCount === 0) return false
      if (!terms.length) return true
      const text = normalize([
        review.name,
        review.address,
        review.city,
        review.state,
        review.style,
        review.price_range,
      ].filter(Boolean).join(' '))
      return terms.every(term => text.includes(term))
    })
  }, [filter, reviews, search])

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null)
      return
    }
    if (!filtered.some(review => review.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  const selected = filtered.find(review => review.id === selectedId) || null
  const selectedIndex = selected ? filtered.findIndex(review => review.id === selected.id) : -1
  const visibleStart = Math.min(
    Math.max(0, selectedIndex - 3),
    Math.max(0, filtered.length - 8)
  )
  const visibleResults = filtered.slice(visibleStart, visibleStart + 8)

  const updatePhotos = useCallback((reviewId, photos) => {
    setReviews(current => current.map(review =>
      review.id === reviewId ? { ...review, photos: Array.isArray(photos) ? photos : [] } : review
    ))
  }, [])

  const upload = useCallback(async (reviewId, files) => {
    const review = reviews.find(item => item.id === reviewId)
    if (!review) throw new Error('Review not found.')
    const currentPhotos = Array.isArray(review.photos) ? review.photos : []
    const remaining = MAX_PHOTOS - currentPhotos.length
    if (remaining <= 0) throw new Error('Photo limit reached.')
    const queue = Array.isArray(files) ? files.filter(isSupportedReviewPhotoFile).slice(0, remaining) : []
    if (!queue.length) throw new Error('No supported images were selected.')

    let latest = currentPhotos
    for (const file of queue) {
      const prepared = await prepareReviewPhotoUpload(file, { reviewId })
      const response = await fetch(`/api/admin/reviews/${reviewId}/photos/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity,
          files: [{
            path: prepared.path,
            size: prepared.size,
            mimeType: prepared.mimeType,
            dataBase64: prepared.dataBase64,
          }],
        }),
      })
      if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to upload photo.'))
      const payload = await response.json()
      latest = Array.isArray(payload?.data) ? payload.data : latest
      updatePhotos(reviewId, latest)
    }
    return latest
  }, [entity, reviews, updatePhotos])

  const reorder = useCallback(async (reviewId, photos) => {
    const order = Array.isArray(photos) ? photos.map(photo => photo.id).filter(Boolean) : []
    if (!order.length) throw new Error('Unable to determine the new order.')
    const response = await fetch(`/api/admin/reviews/${reviewId}/photos/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ entity, order }),
    })
    if (!response.ok) throw new Error(await response.text() || 'Failed to update photo order.')
    const payload = await response.json()
    updatePhotos(reviewId, payload?.data)
    return payload?.data
  }, [entity, updatePhotos])

  const remove = useCallback(async (reviewId, photoId) => {
    const response = await fetch(`/api/admin/review-photos/${photoId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!response.ok) throw new Error(await response.text() || 'Failed to delete photo.')
    const payload = await response.json()
    updatePhotos(reviewId, payload?.data)
    return payload?.data
  }, [updatePhotos])

  const selectOffset = offset => {
    const next = filtered[selectedIndex + offset]
    if (next) setSelectedId(next.id)
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
            placeholder="Search name, city, address, or style"
            aria-label="Find reviewed place"
          />
        </div>
        <label className="admin-field">
          <span className="sr-only">Photo status</span>
          <select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Photo status">
            <option value="all">All reviewed places</option>
            <option value="missing">Needs photos</option>
            <option value="has">Has photos</option>
          </select>
        </label>
        <div className="admin-toolbar__spacer" />
        <span className="admin-progress">{filtered.length} found</span>
      </div>

      {loading ? <div className="admin-alert" role="status">Loading reviewed places…</div> : null}
      {error ? <div className="admin-alert admin-alert--error" role="alert">{error}</div> : null}
      {!loading && !error && !filtered.length ? <div className="admin-empty">No reviewed places match this search.</div> : null}

      {!loading && !error && selected ? (
        <div className="admin-split">
          <aside aria-label="Matching reviewed places">
            <div className="admin-result-list">
              {visibleResults.map(review => {
                const count = Array.isArray(review.photos) ? review.photos.length : 0
                return (
                  <button
                    className={`admin-result-item${review.id === selected.id ? ' is-active' : ''}`}
                    type="button"
                    key={review.id}
                    onClick={() => setSelectedId(review.id)}
                    aria-pressed={review.id === selected.id}
                  >
                    <strong>{review.name || 'Untitled place'}</strong>
                    <span>{review.state || 'No state'} · {count}/{MAX_PHOTOS} photos</span>
                  </button>
                )
              })}
            </div>
            {filtered.length > visibleResults.length ? (
              <p className="admin-task__detail">Showing the closest matches. Narrow the search to jump directly.</p>
            ) : null}
          </aside>

          <section>
            <div className="admin-selected-header" aria-label="Selected review">
              <div>
                <div className="admin-progress">{selectedIndex + 1} of {filtered.length}</div>
                <h2>{selected.name || 'Untitled place'}</h2>
                <p>{reviewLocation(selected)}</p>
              </div>
              <div className="admin-inline-actions">
                <button
                  className="admin-button admin-button--icon"
                  type="button"
                  onClick={() => selectOffset(-1)}
                  disabled={selectedIndex <= 0}
                  aria-label="Previous reviewed place"
                  title="Previous"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button
                  className="admin-button admin-button--icon"
                  type="button"
                  onClick={() => selectOffset(1)}
                  disabled={selectedIndex >= filtered.length - 1}
                  aria-label="Next reviewed place"
                  title="Next"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <AdminReviewEditor
              key={selected.id}
              review={selected}
              isAdmin
              maxPhotos={MAX_PHOTOS}
              onUpload={files => upload(selected.id, files)}
              onReorder={photos => reorder(selected.id, photos)}
              onDelete={photoId => remove(selected.id, photoId)}
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}
