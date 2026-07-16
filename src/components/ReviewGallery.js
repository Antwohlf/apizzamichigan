import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './ReviewGallery.css'

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
  const eventShieldRef = useRef(null)
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

  const clearEventShield = useCallback(() => {
    const shield = eventShieldRef.current
    if (!shield) return
    shield.events.forEach(eventName => {
      document.removeEventListener(eventName, shield.handler, true)
    })
    clearTimeout(shield.timeoutId)
    eventShieldRef.current = null
  }, [])

  const blockUnderlyingMapEvents = useCallback(() => {
    if (process.env.NODE_ENV === 'test') return
    if (typeof document === 'undefined') return
    clearEventShield()
    const events = ['click', 'dblclick', 'pointerup', 'mouseup', 'touchend', 'wheel']
    const handler = event => {
      event.preventDefault?.()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
    }
    events.forEach(eventName => {
      document.addEventListener(eventName, handler, true)
    })
    const timeoutId = setTimeout(clearEventShield, 350)
    eventShieldRef.current = { events, handler, timeoutId }
  }, [clearEventShield])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        blockUnderlyingMapEvents()
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
  }, [blockUnderlyingMapEvents, isOpen, normalizedPhotos.length])

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

  const close = useCallback(() => {
    blockUnderlyingMapEvents()
    setIsOpen(false)
  }, [blockUnderlyingMapEvents])

  useEffect(() => clearEventShield, [clearEventShield])

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

  const captionText = placeName
    ? `${placeName} detail ${activeIndex + 1} of ${normalizedPhotos.length}`
    : `Review detail ${activeIndex + 1} of ${normalizedPhotos.length}`

  const lightbox = isOpen && activePhoto && (
    <div
      className="review-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={captionText}
      onClickCapture={event => {
        if (event.target === event.currentTarget) {
          stopMapEvent(event)
          close()
        }
      }}
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
        className="review-lightbox__dialog"
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
        <div className="review-lightbox__header">
          <div className="review-lightbox__caption">{captionText}</div>
          <button
            type="button"
            className="review-lightbox__icon-button"
            onClick={event => {
              stopMapEvent(event)
              close()
            }}
            onMouseDown={stopMapEvent}
            onPointerDown={stopMapEvent}
            onTouchStart={stopMapEvent}
            aria-label="Close photo viewer"
          >
            ×
          </button>
        </div>
        <div className="review-lightbox__image-frame">
          <img
            className={`review-lightbox__image${hasMultiplePhotos ? ' review-lightbox__image--with-controls' : ''}`}
            src={activePhoto.largeSrc}
            alt={captionText}
            loading="eager"
          />
          {hasMultiplePhotos && (
            <>
              <button
                type="button"
                className="review-lightbox__arrow review-lightbox__arrow--prev"
                onClick={event => {
                  stopMapEvent(event)
                  showPrev()
                }}
                onMouseDown={stopMapEvent}
                onPointerDown={stopMapEvent}
                onTouchStart={stopMapEvent}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                type="button"
                className="review-lightbox__arrow review-lightbox__arrow--next"
                onClick={event => {
                  stopMapEvent(event)
                  showNext()
                }}
                onMouseDown={stopMapEvent}
                onPointerDown={stopMapEvent}
                onTouchStart={stopMapEvent}
                aria-label="Next photo"
              >
                ›
              </button>
            </>
          )}
        </div>
        {hasMultiplePhotos && (
          <div className="review-lightbox__controls">
            <span>{activeIndex + 1} / {normalizedPhotos.length}</span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div className="review-gallery">
        {normalizedPhotos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className="review-gallery__thumb"
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
            aria-label={`Open photo ${index + 1}${placeName ? ` for ${placeName}` : ''}`}
          >
            <img
              data-testid="review-gallery-thumbnail"
              className="review-gallery__thumb-image"
              src={photo.smallSrc}
              alt=""
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {lightbox && typeof document !== 'undefined' ? createPortal(lightbox, document.body) : lightbox}
    </>
  )
}
