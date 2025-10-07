import React, { useState } from 'react'

export default function ReviewGallery({ photos = [] }) {
  const safePhotos = Array.isArray(photos) ? photos.filter(Boolean) : []
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  if (safePhotos.length === 0) {
    return null
  }

  const openAt = index => {
    setActiveIndex(index)
    setIsOpen(true)
  }

  const close = () => setIsOpen(false)

  const showPrev = () => {
    setActiveIndex(prev => (prev - 1 + safePhotos.length) % safePhotos.length)
  }

  const showNext = () => {
    setActiveIndex(prev => (prev + 1) % safePhotos.length)
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    zIndex: 1000,
  }

  const dialogStyle = {
    background: '#fff',
    borderRadius: '8px',
    maxWidth: '90vw',
    maxHeight: '90vh',
    padding: '1rem',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  }

  const fullImageStyle = {
    maxHeight: '70vh',
    maxWidth: '80vw',
    objectFit: 'contain',
  }

  const controlsStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.5rem',
  }

  const controlButtonStyle = {
    padding: '0.5rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #ccc',
    background: '#f8f8f8',
    cursor: 'pointer',
  }

  return (
    <>
      <div style={gridStyle}>
        {safePhotos.slice(0, 6).map((src, index) => (
          <button
            key={`${src}-${index}`}
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
          >
            <img src={src} alt="Preview of the place" loading="lazy" style={thumbStyle} />
          </button>
        ))}
      </div>

      {isOpen && (
        <div style={overlayStyle} role="dialog" aria-modal="true" onClick={close}>
          <div style={dialogStyle} onClick={event => event.stopPropagation()}>
            <img
              src={safePhotos[activeIndex]}
              alt="Expanded review detail"
              loading="lazy"
              style={fullImageStyle}
            />
            <div style={controlsStyle}>
              <button type="button" onClick={showPrev} style={controlButtonStyle}>
                Prev
              </button>
              <button type="button" onClick={close} style={controlButtonStyle}>
                Close
              </button>
              <button type="button" onClick={showNext} style={controlButtonStyle}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
