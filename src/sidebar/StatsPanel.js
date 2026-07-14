import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

function StatRow({ label, value, loading }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
      <span style={{ fontSize: '0.9rem', color: 'var(--app-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--app-text)' }}>
        {loading ? '...' : value}
      </span>
    </div>
  )
}

async function fetchStats(table) {
  const [{ count: unvisited, error: unvisitedError }, { data: ratings, error: ratingsError }] = await Promise.all([
    supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .ilike('status', 'unvisited'),
    supabase
      .from(table)
      .select('rating')
      .or('status.ilike.visited*,status.ilike.golden*')
      .not('rating', 'is', null),
  ])

  if (unvisitedError) throw unvisitedError
  if (ratingsError) throw ratingsError

  const numericRatings = (ratings || [])
    .map(place => Number(place.rating))
    .filter(rating => Number.isFinite(rating))
  const average = numericRatings.length
    ? (numericRatings.reduce((sum, rating) => sum + rating, 0) / numericRatings.length).toFixed(1)
    : '—'

  return {
    tried: numericRatings.length,
    unvisited: Number(unvisited || 0),
    average,
  }
}

export function StatsPanel({ table = 'pizza_places' }) {
  const [stats, setStats] = useState({ tried: 0, unvisited: 0, average: '—' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadStats() {
      setLoading(true)
      try {
        const nextStats = await fetchStats(table)
        if (!isMounted) return
        setStats(nextStats)
      } catch (err) {
        console.error('[StatsPanel] Failed to fetch stats:', err)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadStats()

    return () => {
      isMounted = false
    }
  }, [table])

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
        <StatRow label="Number of places tried" value={stats.tried.toLocaleString()} loading={loading} />
        <StatRow label="Number of unvisited suggestions" value={stats.unvisited.toLocaleString()} loading={loading} />
        <StatRow label="Average rating" value={stats.average} loading={loading} />
      </section>
    </div>
  )
}
