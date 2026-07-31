import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { readSupabase } from '../lib/supabaseRead'

function StatRow({ label, value, loading, compact = false }) {
  if (compact) {
    return (
      <span className="stats-panel__item">
        <strong>{loading ? '...' : value}</strong>
        <span>{label}</span>
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
      <span style={{ fontSize: '0.9rem', color: 'var(--app-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--app-text)' }}>
        {loading ? '...' : value}
      </span>
    </div>
  )
}

async function fetchStats(table, states = []) {
  const stateScope = Array.isArray(states) && states.length ? states : null
  const buildUnvisitedQuery = () => {
    let query = supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .ilike('status', 'unvisited')
    if (stateScope) query = query.in('state', stateScope)
    return query
  }
  const buildRatingsQuery = () => {
    let query = supabase
      .from(table)
      .select('rating')
      .or('status.ilike.visited*,status.ilike.golden*')
      .not('rating', 'is', null)
    if (stateScope) query = query.in('state', stateScope)
    return query
  }

  const [{ count: unvisited, error: unvisitedError }, { data: ratings, error: ratingsError }] = await Promise.all([
    readSupabase(buildUnvisitedQuery),
    readSupabase(buildRatingsQuery),
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

export function StatsPanel({ table = 'pizza_places', states = [], variant = 'default' }) {
  const [stats, setStats] = useState({ tried: 0, unvisited: 0, average: '—' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadStats() {
      setLoading(true)
      try {
        const nextStats = await fetchStats(table, states)
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
  }, [table, states])

  if (variant === 'compact') {
    return (
      <div className="stats-panel stats-panel--compact" aria-label="APizzaMichigan statistics">
        <StatRow
          compact
          label="tried"
          value={stats.tried.toLocaleString()}
          loading={loading}
        />
        <StatRow
          compact
          label="to discover"
          value={stats.unvisited.toLocaleString()}
          loading={loading}
        />
        <StatRow
          compact
          label="average rating"
          value={stats.average}
          loading={loading}
        />
      </div>
    )
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <h2 className="filter-section__title" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        Stats
      </h2>
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
