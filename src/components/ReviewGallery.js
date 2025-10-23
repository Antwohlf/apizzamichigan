import React, { useCallback, useEffect, useMemo, useState } from 'react'

const SMALL_TRANSFORM = 'width=480&quality=70&format=webp'
const LARGE_TRANSFORM = 'width=1600&quality=75&format=webp'

const appendQuery = (url, query) => {
  if (!url) return ''
  if (/^data:/.test(url) || /^blob:/.test(url) || !/^https?:/i.test(url)) {
    return url
  }
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${query}`
}

const normalizePhoto = (photo, index) => {
  if (!photo) return null

  if (typeof photo === 'string') {
    return {
      id: `${photo}-${index}`,
      baseUrl: photo,
      sortOrder: index + 1,
    }
  }

  const baseUrl = photo.publicUrl || photo.url || photo.path
  if (!baseUrl) return null

  return {
    id: photo.id || `${baseUrl}-${index}`,
    baseUrl,
    sortOrder: typeof photo.sortOrder === 'number' ? photo.sortOrder : index + 1,
  }
}

export default function ReviewGallery({ photos = [], placeName }) {
  const normalizedPhotos = useMemo(() => {
    const entries = Array.isArray(photos) ? photos : []
    return entries
      .map((photo, index) => normalizePhoto(photo, index))
      .filter(Boolean)
      .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))
      .map((item, index) => ({
        ...item,
        index,
        smallSrc: appendQuery(item.baseUrl, SMALL_TRANSFORM),
        largeSrc: appendQuery(item.baseUrl, LARGE_TRANSFORM),
      }))
  }, [photos])

  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex(prev => (prev - 1 + normalizedPhotos.length) % normalizedPhotos.length)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex(prev => (prev + 1) % normalizedPhotos.length)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, normalizedPhotos.length])

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined
    const { body } = document
    if (!body) return undefined
    const previous = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = previous
    }
  }, [isOpen])

  const openAt = useCallback(
    index => {
      if (!normalizedPhotos.length) return
      setActiveIndex(index)
      setIsOpen(true)
    },
    [normalizedPhotos.length]
  )

  const close = useCallback(() => setIsOpen(false), [])

  const showPrev = useCallback(() => {
    setActiveIndex(prev => (prev - 1 + normalizedPhotos.length) % normalizedPhotos.length)
  }, [normalizedPhotos.length])

  const showNext = useCallback(() => {
    setActiveIndex(prev => (prev + 1) % normalizedPhotos.length)
  }, [normalizedPhotos.length])

  if (!normalizedPhotos.length) {
    return null
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
    gap: '8px',
    marginTop: '0.75rem',
  }

  const thumbStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: '6px',
  }

  const overlayStyle = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    zIndex: 1400,
  }

  const dialogStyle = {
    background: '#0f172a',
    borderRadius: '12px',
    maxWidth: 'min(960px, 92vw)',
    maxHeight: '90vh',
    padding: '1rem',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    boxShadow: '0 32px 120px rgba(15, 23, 42, 0.55)',
  }

  const fullImageStyle = {
    maxHeight: '70vh',
    maxWidth: '86vw',
    objectFit: 'contain',
    borderRadius: '8px',
    background: '#0b1220',
  }

  const controlsStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
  }

  const controlButtonStyle = {
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    background: 'rgba(30, 41, 59, 0.9)',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontWeight: 600,
  }

  const captionText = placeName
    ? `${placeName} detail ${activeIndex + 1} of ${normalizedPhotos.length}`
    : `Review detail ${activeIndex + 1} of ${normalizedPhotos.length}`

  return (
    <>
      <div style={gridStyle}>
        {normalizedPhotos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => openAt(index)}
            style={{
              padding: 0,
              border: '1px solid var(--app-border)',
              borderRadius: '6px',
              background: 'var(--app-card)',
              cursor: 'pointer',
              overflow: 'hidden',
              aspectRatio: '1 / 1',
            }}
            aria-label={`Open photo ${index + 1}${placeName ? ` for ${placeName}` : ''}`}
          >
            <img src={photo.smallSrc} alt="" loading="lazy" style={thumbStyle} />
          </button>
        ))}
      </div>

      {isOpen && normalizedPhotos[activeIndex] && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label={captionText} onClick={close}>
          <div style={dialogStyle} onClick={event => event.stopPropagation()}>
            <img
              src={normalizedPhotos[activeIndex].largeSrc}
              alt={captionText}
              loading="lazy"
              style={fullImageStyle}
            />
            <div style={controlsStyle}>
              <button type="button" onClick={showPrev} style={controlButtonStyle}>
                Prev
              </button>
              <div style={{ color: '#cbd5f5', fontSize: '0.85rem', fontWeight: 500 }}>{captionText}</div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={close} style={controlButtonStyle}>
                  Close
                </button>
                <button type="button" onClick={showNext} style={controlButtonStyle}>
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
