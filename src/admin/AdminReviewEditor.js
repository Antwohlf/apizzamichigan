import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUnsupportedReviewPhotoMessage, isSupportedReviewPhotoFile } from '../utils/uploadPhoto'

const SMALL_THUMB_PARAMS = 'width=280&quality=70&format=webp'
const MAX_PHOTO_COUNT = 10

const gridStyles = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: '12px',
  marginTop: '12px',
}

const DROPZONE_BORDER_COLOR = 'var(--app-border, #2b2f31)'

const dropzoneBaseStyles = {
  border: '2px dashed var(--app-border, #2b2f31)',
  borderRadius: 8,
  padding: '1.5rem',
  textAlign: 'center',
  background: 'rgba(32,34,36,0.4)',
  color: '#f1f5f9',
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background 120ms ease',
}

const arrayMove = (list, fromIndex, toIndex) => {
  const next = [...list]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

const appendQuery = (url, query) => {
  if (!url) return ''
  if (/^data:/.test(url) || /^blob:/.test(url) || !/^https?:/i.test(url)) {
    return url
  }
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${query}`
}

function formatLabel(label, fallback = '—') {
  if (label === null || label === undefined || label === '') return fallback
  return label
}

export default function AdminReviewEditor({
  review,
  isAdmin = false,
  maxPhotos = MAX_PHOTO_COUNT,
  onUpload,
  onReorder,
  onDelete,
}) {
  const [localPhotos, setLocalPhotos] = useState(Array.isArray(review?.photos) ? review.photos : [])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')
  const dragIndexRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    setLocalPhotos(Array.isArray(review?.photos) ? review.photos : [])
  }, [review?.photos])

  const remainingSlots = useMemo(() => Math.max(0, maxPhotos - localPhotos.length), [maxPhotos, localPhotos.length])

  const emitUpload = useCallback(
    async files => {
      if (!onUpload || !Array.isArray(files) || files.length === 0) {
        return
      }
      setError('')
      setUploading(true)
      try {
        const updated = await onUpload(files)
        if (Array.isArray(updated)) {
          setLocalPhotos(updated)
        }
      } catch (err) {
        setError(err?.message || 'Failed to upload photo(s).')
      } finally {
        setUploading(false)
      }
    },
    [onUpload]
  )

  const handleBrowseClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = event => {
    const list = event?.target?.files
    if (!list) return
    const selected = Array.from(list)
    const files = selected.filter(isSupportedReviewPhotoFile).slice(0, remainingSlots)
    if (files.length === 0) {
      setError(remainingSlots === 0 ? 'Photo limit reached.' : getUnsupportedReviewPhotoMessage(selected[0]))
      return
    }
    emitUpload(files)
    event.target.value = ''
  }

  const handleDragEnter = event => {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingOver(true)
  }

  const handleDragLeave = event => {
    event.preventDefault()
    event.stopPropagation()
    if (event.target === event.currentTarget) {
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = event => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = event => {
    event.preventDefault()
    setIsDraggingOver(false)
    const list = event.dataTransfer?.files
    if (!list) return
    const dropped = Array.from(list)
    const files = dropped.filter(isSupportedReviewPhotoFile).slice(0, remainingSlots)
    if (files.length === 0) {
      setError(remainingSlots === 0 ? 'Photo limit reached.' : getUnsupportedReviewPhotoMessage(dropped[0]))
      return
    }
    emitUpload(files)
  }

  const handleCardDragStart = index => event => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    dragIndexRef.current = index
  }

  const handleCardDragOver = index => event => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleCardDrop = index => event => {
    event.preventDefault()
    const fromIndexRaw = event.dataTransfer.getData('text/plain')
    const fromIndex = Number.parseInt(fromIndexRaw, 10)
    dragIndexRef.current = null
    if (!Number.isInteger(fromIndex) || fromIndex === index) return

    const next = arrayMove(localPhotos, fromIndex, index)
    setLocalPhotos(next)
    if (!onReorder) return

    setReordering(true)
    Promise.resolve(onReorder(next))
      .then(updated => {
        if (Array.isArray(updated)) {
          setLocalPhotos(updated)
        }
      })
      .catch(err => {
        setError(err?.message || 'Unable to update order.')
        setLocalPhotos(Array.isArray(review?.photos) ? review.photos : [])
      })
      .finally(() => {
        setReordering(false)
      })
  }

  const handleDelete = photo => async () => {
    if (!onDelete || !photo?.id) return
    setDeletingId(photo.id)
    setError('')
    try {
      const updated = await onDelete(photo.id)
      if (Array.isArray(updated)) {
        setLocalPhotos(updated)
      }
    } catch (err) {
      setError(err?.message || 'Failed to delete photo.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!review) return null
  if (!isAdmin) return null

  const dropzoneStyles = {
    ...dropzoneBaseStyles,
    borderColor: isDraggingOver ? '#f97316' : DROPZONE_BORDER_COLOR,
    background: isDraggingOver ? 'rgba(249,115,22,0.1)' : dropzoneBaseStyles.background,
  }

  return (
    <section
      className="admin-photo-editor"
      style={{
        border: '1px solid var(--app-border, #2b2f31)',
        borderRadius: 8,
        padding: '1.25rem',
        background: '#191b1a',
        marginBottom: '1.25rem',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, color: '#f3f4f2', fontSize: '1rem' }}>Review details</h3>
          <p style={{ margin: '0.5rem 0', color: 'var(--app-text-muted, #9ca3af)', maxWidth: '56ch' }}>
            {formatLabel(review.review || review.notes || review.description, 'No review text provided yet.')}
          </p>
        </div>
        <dl style={{ margin: 0, display: 'grid', gap: '0.35rem', minWidth: '140px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <dt style={{ fontWeight: 500, color: 'var(--app-text-muted, #94a3b8)' }}>Rating</dt>
            <dd style={{ margin: 0, fontWeight: 600, color: 'var(--app-text, #f1f5f9)' }}>
              {formatLabel(review.rating, '—')}
            </dd>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <dt style={{ fontWeight: 500, color: 'var(--app-text-muted, #94a3b8)' }}>Style</dt>
            <dd style={{ margin: 0, fontWeight: 600, color: 'var(--app-text, #f1f5f9)' }}>
              {formatLabel(review.style || review.type, '—')}
            </dd>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <dt style={{ fontWeight: 500, color: 'var(--app-text-muted, #94a3b8)' }}>Price</dt>
            <dd style={{ margin: 0, fontWeight: 600, color: 'var(--app-text, #f1f5f9)' }}>
              {formatLabel(review.price_range || review.price, '—')}
            </dd>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <dt style={{ fontWeight: 500, color: 'var(--app-text-muted, #94a3b8)' }}>Photos</dt>
            <dd style={{ margin: 0, fontWeight: 600, color: 'var(--app-text, #f1f5f9)' }}>
              {localPhotos.length}/{maxPhotos}
            </dd>
          </div>
        </dl>
      </header>

      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        aria-label={remainingSlots > 0 ? 'Upload review photos' : 'Photo limit reached'}
        aria-busy={uploading}
        style={dropzoneStyles}
      >
        <p style={{ margin: '0 0 0.5rem' }}>
          Drag &amp; drop review photos here, or{' '}
          <button
            className="admin-button admin-button--primary"
            type="button"
            onClick={handleBrowseClick}
            disabled={uploading || remainingSlots === 0}
          >
            Browse
          </button>
        </p>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--app-text-muted, #94a3b8)' }}>
          Up to {maxPhotos} photos per review. Images are converted to WebP and downscaled automatically.
        </p>
        {remainingSlots === 0 && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#fbbf24' }}>
            Photo limit reached. Delete or reorder existing photos before adding more.
          </p>
        )}
        {uploading && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#f97316' }}>Uploading photos…</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          onChange={handleFileInputChange}
          aria-label="Choose review photos"
          style={{ display: 'none' }}
        />
      </div>

      {error && (
        <p style={{ marginTop: '0.75rem', color: '#f87171', fontSize: '0.9rem' }}>{error}</p>
      )}

      {localPhotos.length > 0 && (
        <div style={gridStyles}>
          {localPhotos.map((photo, index) => {
            const baseUrl = photo.publicUrl || photo.url || photo.path || ''
            const previewUrl = photo.publicUrl ? appendQuery(baseUrl, SMALL_THUMB_PARAMS) : baseUrl
            const altText = review?.name
              ? `${review.name} preview ${index + 1}`
              : `Gallery entry ${index + 1}`
            return (
              <div
                key={photo.id || photo.path || index}
                draggable={!reordering && !uploading && !deletingId}
                onDragStart={handleCardDragStart(index)}
                onDragOver={handleCardDragOver(index)}
                onDrop={handleCardDrop(index)}
                style={{
                  background: 'rgba(17,17,17,0.8)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  isolation: 'isolate',
                }}
              >
                <img
                  src={previewUrl}
                  alt={altText}
                  loading="lazy"
                  style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem',
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                  }}
                >
                  <small style={{ fontSize: '0.75rem', opacity: 0.9 }}>#{index + 1}</small>
                  <button
                    className="admin-button admin-button--danger"
                    type="button"
                    onClick={handleDelete(photo)}
                    disabled={deletingId === photo.id || reordering}
                    style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      cursor: deletingId === photo.id ? 'progress' : 'pointer',
                    }}
                  >
                    {deletingId === photo.id ? 'Removing…' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reordering && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#93c5fd' }}>
          Saving new order…
        </p>
      )}
    </section>
  )
}
