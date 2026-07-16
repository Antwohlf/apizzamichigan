import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

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

const stopMapEvent = event => {
  event.preventDefault?.()
  event.stopPropagation()
  event.nativeEvent?.stopImmediatePropagation?.()
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

  const activePhoto = normalizedPhotos[activeIndex]
  const hasMultiplePhotos = normalizedPhotos.length > 1

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
    padding: 'clamp(12px, 3vw, 32px)',
    zIndex: 10000,
  }

  const dialogStyle = {
    position: 'relative',
    width: 'min(1040px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 32px)',
    background: '#0b1220',
    border: '1px solid rgba(148, 163, 184, 0.28)',
    borderRadius: '10px',
    padding: '12px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxShadow: '0 32px 120px rgba(15, 23, 42, 0.55)',
  }

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    minHeight: '36px',
  }

  const captionStyle = {
    color: '#dbeafe',
    fontSize: '0.9rem',
    fontWeight: 650,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const imageFrameStyle = {
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#020617',
    borderRadius: '8px',
    overflow: 'hidden',
  }

  const fullImageStyle = {
    display: 'block',
    width: '100%',
    height: 'auto',
    maxHeight: hasMultiplePhotos ? 'calc(100vh - 160px)' : 'calc(100vh - 108px)',
    objectFit: 'contain',
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
    background: 'rgba(15, 23, 42, 0.94)',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontWeight: 600,
  }

  const captionText = placeName
    ? `${placeName} detail ${activeIndex + 1} of ${normalizedPhotos.length}`
    : `Review detail ${activeIndex + 1} of ${normalizedPhotos.length}`

  const lightbox = isOpen && activePhoto && (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={captionText}
      onClick={event => {
        stopMapEvent(event)
        close()
      }}
      onContextMenu={stopMapEvent}
      onDoubleClick={stopMapEvent}
      onMouseDown={stopMapEvent}
      onMouseUp={stopMapEvent}
      onPointerDown={stopMapEvent}
      onPointerUp={stopMapEvent}
      onTouchStart={stopMapEvent}
      onTouchEnd={stopMapEvent}
      onWheel={stopMapEvent}
    >
      <div
        style={dialogStyle}
        onClick={stopMapEvent}
        onContextMenu={stopMapEvent}
        onDoubleClick={stopMapEvent}
        onMouseDown={stopMapEvent}
        onMouseUp={stopMapEvent}
        onPointerDown={stopMapEvent}
        onPointerUp={stopMapEvent}
        onTouchStart={stopMapEvent}
        onTouchEnd={stopMapEvent}
        onWheel={stopMapEvent}
      >
        <div style={headerStyle}>
          <div style={captionStyle}>{captionText}</div>
          <button type="button" onClick={close} style={controlButtonStyle} aria-label="Close photo viewer">
            Close
          </button>
        </div>
        <div style={imageFrameStyle}>
          <img src={activePhoto.largeSrc} alt={captionText} loading="eager" style={fullImageStyle} />
        </div>
        {hasMultiplePhotos && (
          <div style={controlsStyle}>
            <button type="button" onClick={showPrev} style={controlButtonStyle}>
              Prev
            </button>
            <button type="button" onClick={showNext} style={controlButtonStyle}>
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div style={gridStyle}>
        {normalizedPhotos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={event => {
              stopMapEvent(event)
              openAt(index)
            }}
            onDoubleClick={stopMapEvent}
            onMouseDown={stopMapEvent}
            onMouseUp={stopMapEvent}
            onPointerDown={stopMapEvent}
            onPointerUp={stopMapEvent}
            onTouchStart={stopMapEvent}
            onTouchEnd={stopMapEvent}
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
            <img data-testid="review-gallery-thumbnail" src={photo.smallSrc} alt="" loading="lazy" style={thumbStyle} />
          </button>
        ))}
      </div>

      {lightbox && typeof document !== 'undefined' ? createPortal(lightbox, document.body) : lightbox}
    </>
  )
}
