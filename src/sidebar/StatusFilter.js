import React from 'react'

const STATUS_OPTIONS = [
  { value: 'visited', label: 'Visited', color: '#f97316' },
  { value: 'unvisited', label: 'Unvisited', color: '#9ca3af' },
  { value: 'golden', label: 'Golden', color: '#facc15' },
]

export function StatusFilter({ value, onChange }) {
  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h3
        style={{
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--app-text-muted)',
          marginBottom: '0.5rem',
        }}
      >
        Status
      </h3>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {STATUS_OPTIONS.map(option => {
          const selected = value.has(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                const next = new Set(value)
                if (selected && next.size > 1) {
                  next.delete(option.value)
                } else if (!selected) {
                  next.add(option.value)
                }
                onChange(next)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                borderRadius: '12px',
                border: selected ? '1px solid var(--app-border)' : '1px solid var(--app-border)',
                background: selected ? 'rgba(255,255,255,0.08)' : 'transparent',
                padding: '0.5rem 0.75rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: '999px',
                  background: option.color,
                }}
              />
              <span style={{ fontSize: '0.9rem', color: 'var(--app-text)' }}>{option.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
