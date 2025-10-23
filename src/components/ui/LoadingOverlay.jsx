import React from 'react'

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(10, 12, 14, 0.72)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1400,
  pointerEvents: 'none',
  padding: '1.5rem',
}

const cardStyle = {
  background: 'rgba(17, 25, 40, 0.92)',
  borderRadius: '20px',
  padding: '1.5rem 1.75rem',
  display: 'grid',
  gap: '0.75rem',
  alignItems: 'center',
  justifyItems: 'center',
  color: '#f8fafc',
  minWidth: '220px',
  pointerEvents: 'auto',
  boxShadow: '0 30px 80px rgba(15, 23, 42, 0.6)',
}

export default function LoadingOverlay({ isOpen, variant = 'pizza', label }) {
  if (!isOpen) return null

  const src = variant === 'taco' ? '/assets/tortilla-spinner.svg' : '/assets/pizza-spinner.svg'

  return (
    <div style={overlayStyle} role="status" aria-live="polite">
      <div style={cardStyle}>
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="spin"
          style={{ width: '64px', height: '64px', userSelect: 'none' }}
        />
        <span>{label || 'Loading…'}</span>
      </div>
    </div>
  )
}
