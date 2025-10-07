import React from 'react'

const STATUS_OPTIONS = [
  { value: 'visited', label: 'Visited', color: '#f97316' },
  { value: 'unvisited', label: 'Unvisited', color: '#9ca3af' },
  { value: 'golden', label: 'Golden', color: '#facc15' },
]

export function StatusFilter({ value, onChange }) {
  return (
    <section className="filter-section" aria-label="Status">
      <h3 className="filter-section__title">Status</h3>
      <div className="filter-section__options">
        {STATUS_OPTIONS.map(option => {
          const selected = value.has(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              aria-current={selected ? 'true' : undefined}
              className={`filter-option${selected ? ' is-selected' : ''}`}
              onClick={() => {
                const next = new Set(value)
                if (selected && next.size > 1) {
                  next.delete(option.value)
                } else if (!selected) {
                  next.add(option.value)
                }
                onChange(next)
              }}
            >
              <span
                className="filter-option__swatch"
                style={{ background: option.color }}
                aria-hidden="true"
              />
              <span className="filter-option__label">{option.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
