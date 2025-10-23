import React from 'react'

export default function InlineSpinner({ variant = 'pizza', size = 24, label = 'Loading' }) {
  const src = variant === 'taco' ? '/assets/tortilla-spinner.svg' : '/assets/pizza-spinner.svg'
  return (
    <span role="status" aria-live="polite" className="inline-spinner">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="spin"
        style={{ width: `${size}px`, height: `${size}px`, display: 'inline-block', verticalAlign: 'middle' }}
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}
