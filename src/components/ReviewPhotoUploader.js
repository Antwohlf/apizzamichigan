import React, { useState } from 'react'

export default function ReviewPhotoUploader({ onUploaded }) {
  const [localPreviews, setLocalPreviews] = useState([])

  const handleFileChange = event => {
    const nextFiles = event.target.files
    if (!nextFiles || nextFiles.length === 0) {
      setLocalPreviews([])
      if (typeof onUploaded === 'function') {
        onUploaded([])
      }
      return
    }

    const previews = Array.from(nextFiles).map(file => URL.createObjectURL(file))
    setLocalPreviews(previews)

    if (typeof onUploaded === 'function') {
      onUploaded(previews)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        style={{ color: 'var(--app-text)', background: 'transparent' }}
      />
      {localPreviews.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
            gap: '8px',
          }}
        >
          {localPreviews.map((src, index) => (
            <div
              key={`${src}-${index}`}
              style={{
                border: '1px solid var(--app-border)',
                borderRadius: '6px',
                overflow: 'hidden',
                aspectRatio: '1 / 1',
              }}
            >
              <img src={src} alt="Selected preview" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
