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

// Fetch stats from database (lightweight query - only status and rating fields)
async function fetchStats(table) {
  const pageSize = 1000
  let allData = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('status, rating')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allData = allData.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return allData
}

export function StatsPanel({ table = 'pizza_places' }) {
  const [stats, setStats] = useState({ tried: 0, unvisited: 0, average: '—' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadStats() {
      setLoading(true)
      try {
        const data = await fetchStats(table)

        if (!isMounted) return

        const tried = data.filter(p => ['visited', 'golden'].includes(p.status || 'visited'))
        const unvisited = data.filter(p => (p.status || 'visited') === 'unvisited')
        const rated = tried.filter(p => typeof p.rating === 'number' && !Number.isNaN(p.rating))
        const average = rated.length
          ? rated.reduce((sum, place) => sum + (place.rating ?? 0), 0) / rated.length
          : null

        setStats({
          tried: tried.length,
          unvisited: unvisited.length,
          average: average ? average.toFixed(1) : '—',
        })
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
