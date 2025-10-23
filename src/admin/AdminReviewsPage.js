import React, { useCallback, useEffect, useMemo, useState } from 'react'
import AdminReviewEditor from './AdminReviewEditor'
import AdminSuggestionsPanel from './AdminSuggestionsPanel'
import { REVIEW_PHOTO_BUCKET, uploadReviewPhoto } from '../utils/uploadPhoto'
import { supabase } from '../supabaseClient'

const MAX_PHOTOS = 10
const ENTITY_OPTIONS = [
  { label: 'Pizza Reviews', value: 'pizza' },
  { label: 'Taco Reviews', value: 'taco' },
]

const ADMIN_TABS = [
  { id: 'photos', label: 'Photo Manager' },
  { id: 'suggestions', label: 'Suggestions' },
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
      const safeFiles = Array.isArray(files) ? files : []
      const currentCount = Array.isArray(review.photos) ? review.photos.length : 0
      const remaining = MAX_PHOTOS - currentCount
      if (remaining <= 0) {
        throw new Error('Photo limit reached for this review.')
      }
      const uploadQueue = safeFiles.slice(0, remaining)
      if (uploadQueue.length === 0) {
        throw new Error('No valid images selected.')
      }

      const uploadedPaths = []
      try {
        for (const file of uploadQueue) {
          const { path } = await uploadReviewPhoto(file, { reviewId })
          uploadedPaths.push(path)
        }
      } catch (err) {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from(REVIEW_PHOTO_BUCKET).remove(uploadedPaths)
        }
        throw err
      }

      try {
        const res = await fetch(`/api/admin/reviews/${reviewId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paths: uploadedPaths }),
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || 'Failed to attach photo metadata.')
        }
        const payload = await res.json()
        updatePhotosState(reviewId, payload?.data)
        return payload?.data
      } catch (err) {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from(REVIEW_PHOTO_BUCKET).remove(uploadedPaths)
        }
        throw err
      }
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
  const headerTitle = isPhotosTab ? 'Review Photos' : 'Suggestions Inbox'
  const headerSubtitle = isPhotosTab
    ? 'Manage Supabase-hosted photos for each review. Drag to reorder, or remove any photo that needs to be replaced.'
    : 'Review community suggestions and decide what should move onto the official map.'

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
            {!loading && !error && reviews.length === 0 && (
              <p style={{ color: '#94a3b8' }}>No reviews found for this dataset yet.</p>
            )}
            {reviews.map(review => (
              <AdminReviewEditor
                key={review.id}
                review={review}
                isAdmin={isAuthed}
                maxPhotos={MAX_PHOTOS}
                onUpload={files => handleUpload(review.id, files)}
                onReorder={next => handleReorder(review.id, next)}
                onDelete={photoId => handleDelete(review.id, photoId)}
              />
            ))}
          </>
        ) : (
          <AdminSuggestionsPanel entity={entity} />
        )}
      </section>
    </div>
  )
}
