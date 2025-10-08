import React, { useMemo } from 'react'

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
      <span style={{ fontSize: '0.9rem', color: 'var(--app-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--app-text)' }}>{value}</span>
    </div>
  )
}

export function StatsPanel({ places = [] }) {
  const stats = useMemo(() => {
    const safePlaces = Array.isArray(places) ? places : []
    const tried = safePlaces.filter(p => ['visited', 'golden'].includes(p.status || 'visited'))
    const unvisited = safePlaces.filter(p => (p.status || 'visited') === 'unvisited')
    const rated = tried.filter(p => typeof p.rating === 'number' && !Number.isNaN(p.rating))
    const average = rated.length
      ? rated.reduce((sum, place) => sum + (place.rating ?? 0), 0) / rated.length
      : null

    return {
      tried: tried.length,
      unvisited: unvisited.length,
      average: average ? average.toFixed(1) : '—',
    }
  }, [places])

  return (
    <div style={{ marginBottom: '1rem' }}>
      <h3 className="filter-section__title" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        Stats
      </h3>
      <section
        style={{
          border: '1px solid var(--app-border)',
          borderRadius: '16px',
          padding: '0.75rem 1rem',
          background: 'var(--app-card)',
        }}
      >
        <StatRow label="Number of places tried" value={stats.tried} />
        <StatRow label="Number of unvisited suggestions" value={stats.unvisited} />
        <StatRow label="Average rating" value={stats.average} />
      </section>
    </div>
  )
}
