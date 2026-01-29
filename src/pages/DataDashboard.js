import React, { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabaseClient'
import './DataDashboard.css'

// Animated counter hook - counts up from 0 to target value
function useAnimatedCounter(target, duration = 1000) {
  const [count, setCount] = useState(0)
  const startTimeRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    if (typeof target !== 'number' || target === 0) {
      setCount(target || 0)
      return
    }

    startTimeRef.current = performance.now()

    const animate = (currentTime) => {
      const elapsed = currentTime - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(eased * target))

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        setCount(target)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [target, duration])

  return count
}

// Compute aggregated stats from raw place data
function computeStats(places, groupByField) {
  const distribution = {}
  const byState = {}
  const byPrice = {}
  let visited = 0, unvisited = 0, golden = 0

  places.forEach(p => {
    // Group by field (style)
    const key = p[groupByField] || 'Unknown'
    // For tacos, style can be comma-separated proteins - count each
    if (key.includes(',')) {
      key.split(',').map(t => t.trim()).forEach(t => {
        distribution[t] = (distribution[t] || 0) + 1
      })
    } else {
      distribution[key] = (distribution[key] || 0) + 1
    }

    // State counts
    const state = p.state || 'Unknown'
    byState[state] = (byState[state] || 0) + 1

    // Price counts
    const price = p.price || 'Unknown'
    byPrice[price] = (byPrice[price] || 0) + 1

    // Status counts
    if (p.status === 'visited') visited++
    else if (p.status === 'golden') golden++
    else unvisited++
  })

  return {
    total: places.length,
    distribution: Object.entries(distribution)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => b[1] - a[1]),
    byState: Object.entries(byState)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
    byPrice: Object.entries(byPrice)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => {
        const order = { '$': 0, '$$': 1, '$$$': 2, '$$$$': 3 }
        return (order[a[0]] ?? 99) - (order[b[0]] ?? 99)
      }),
    visited,
    unvisited,
    golden,
  }
}

// Stat Card Component with animated counter
function StatCard({ label, value, subtext, accent }) {
  const animatedValue = useAnimatedCounter(typeof value === 'number' ? value : 0, 1200)
  const displayValue = typeof value === 'number' ? animatedValue.toLocaleString() : value

  return (
    <div className="stat-card" style={accent ? { '--card-accent': accent } : undefined}>
      <div className="stat-value">{displayValue}</div>
      <div className="stat-label">{label}</div>
      {subtext && <div className="stat-subtext">{subtext}</div>}
    </div>
  )
}

// Bar Chart Component with animated bars
function BarChart({ data, maxValue, accentColor, showPercent }) {
  const [animated, setAnimated] = useState(false)
  const max = maxValue || Math.max(...data.map(d => d[1]))

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setAnimated(true), 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="bar-chart">
      {data.map(([label, count], index) => (
        <div key={label} className="bar-row" style={{ '--bar-delay': `${index * 80}ms` }}>
          <span className="bar-label">{label}</span>
          <div className="bar-track">
            <div
              className={`bar-fill ${animated ? 'animated' : ''}`}
              style={{
                '--bar-width': `${(count / max) * 100}%`,
                background: accentColor || 'var(--app-accent)',
              }}
            />
          </div>
          <span className="bar-value">
            {count.toLocaleString()}
            {showPercent && <span className="bar-percent"> ({((count / max) * 100).toFixed(0)}%)</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// Status Breakdown Component with animated segments
function StatusBreakdown({ visited, unvisited, golden, total }) {
  const [animated, setAnimated] = useState(false)
  const pctVisited = total ? ((visited / total) * 100).toFixed(1) : 0
  const pctUnvisited = total ? ((unvisited / total) * 100).toFixed(1) : 0
  const pctGolden = total ? ((golden / total) * 100).toFixed(1) : 0

  const animatedVisited = useAnimatedCounter(visited, 1200)
  const animatedGolden = useAnimatedCounter(golden, 1200)
  const animatedUnvisited = useAnimatedCounter(unvisited, 1200)

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="status-breakdown">
      <div className="status-bar">
        <div
          className={`status-segment visited ${animated ? 'animated' : ''}`}
          style={{ '--segment-width': `${pctVisited}%` }}
          title={`Visited: ${pctVisited}%`}
        />
        <div
          className={`status-segment golden ${animated ? 'animated' : ''}`}
          style={{ '--segment-width': `${pctGolden}%`, '--segment-delay': '150ms' }}
          title={`Golden: ${pctGolden}%`}
        />
        <div
          className={`status-segment unvisited ${animated ? 'animated' : ''}`}
          style={{ '--segment-width': `${pctUnvisited}%`, '--segment-delay': '300ms' }}
          title={`Unvisited: ${pctUnvisited}%`}
        />
      </div>
      <div className="status-legend">
        <span className="legend-item"><span className="dot visited" /> Visited ({animatedVisited.toLocaleString()})</span>
        <span className="legend-item"><span className="dot golden" /> Golden ({animatedGolden.toLocaleString()})</span>
        <span className="legend-item"><span className="dot unvisited" /> Unvisited ({animatedUnvisited.toLocaleString()})</span>
      </div>
    </div>
  )
}

// Overview Tab
function OverviewTab({ pizzaStats, tacoStats }) {
  if (!pizzaStats || !tacoStats) return null

  const totalPlaces = pizzaStats.total + tacoStats.total
  const allStates = new Set([
    ...pizzaStats.byState.map(s => s[0]),
    ...tacoStats.byState.map(s => s[0]),
  ])

  return (
    <div className="tab-content">
      <div className="stats-row">
        <StatCard label="Total Places" value={totalPlaces} subtext="Pizza + Taco combined" />
        <StatCard label="Pizza Places" value={pizzaStats.total} accent="#f97316" />
        <StatCard label="Taco Places" value={tacoStats.total} accent="#b57c3b" />
        <StatCard label="States Covered" value={allStates.size} />
      </div>

      <div className="section">
        <h3>Coverage Comparison</h3>
        <div className="comparison-grid">
          <div className="comparison-card">
            <h4>Pizza Coverage</h4>
            <StatusBreakdown {...pizzaStats} total={pizzaStats.total} />
          </div>
          <div className="comparison-card">
            <h4>Taco Coverage</h4>
            <StatusBreakdown {...tacoStats} total={tacoStats.total} />
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Top States (Combined)</h3>
        <div className="top-states-grid">
          <div>
            <h4>Pizza</h4>
            <BarChart data={pizzaStats.byState.slice(0, 5)} accentColor="#f97316" />
          </div>
          <div>
            <h4>Taco</h4>
            <BarChart data={tacoStats.byState.slice(0, 5)} accentColor="#b57c3b" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Pizza Tab
function PizzaTab({ stats }) {
  if (!stats) return null

  return (
    <div className="tab-content">
      <div className="stats-row">
        <StatCard label="Total Pizza Places" value={stats.total} accent="#f97316" />
        <StatCard label="Styles Tracked" value={stats.distribution.length} />
        <StatCard label="States" value={stats.byState.length} />
      </div>

      <div className="section">
        <h3>Pizza Style Distribution</h3>
        <BarChart data={stats.distribution} accentColor="#f97316" />
      </div>

      <div className="section">
        <h3>Price Breakdown</h3>
        <BarChart data={stats.byPrice} accentColor="#f97316" />
      </div>

      <div className="section">
        <h3>Visit Status</h3>
        <StatusBreakdown {...stats} total={stats.total} />
      </div>

      <div className="section">
        <h3>Top 10 States</h3>
        <BarChart data={stats.byState} accentColor="#f97316" />
      </div>
    </div>
  )
}

// Taco Tab
function TacoTab({ stats }) {
  if (!stats) return null

  return (
    <div className="tab-content">
      <div className="stats-row">
        <StatCard label="Total Taco Places" value={stats.total} accent="#b57c3b" />
        <StatCard label="Protein Types" value={stats.distribution.length} />
        <StatCard label="States" value={stats.byState.length} />
      </div>

      <div className="section">
        <h3>Taco Type Distribution</h3>
        <BarChart data={stats.distribution} accentColor="#b57c3b" />
      </div>

      <div className="section">
        <h3>Price Breakdown</h3>
        <BarChart data={stats.byPrice} accentColor="#b57c3b" />
      </div>

      <div className="section">
        <h3>Visit Status</h3>
        <StatusBreakdown {...stats} total={stats.total} />
      </div>

      <div className="section">
        <h3>Top 10 States</h3>
        <BarChart data={stats.byState} accentColor="#b57c3b" />
      </div>
    </div>
  )
}

// Main Dashboard Component
export default function DataDashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [pizzaData, setPizzaData] = useState([])
  const [tacoData, setTacoData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Fetch all data with pagination
        const fetchAll = async (table, selectFields) => {
          const pageSize = 1000
          let allData = []
          let offset = 0

          while (true) {
            const { data, error } = await supabase
              .from(table)
              .select(selectFields)
              .range(offset, offset + pageSize - 1)

            if (error) throw error
            if (!data || data.length === 0) break

            allData = allData.concat(data)
            if (data.length < pageSize) break
            offset += pageSize
          }

          return allData
        }

        const [pizza, taco] = await Promise.all([
          fetchAll('pizza_places', 'style, price, status, state'),
          fetchAll('taco_places', 'style, price, status, state'),
        ])

        setPizzaData(pizza)
        setTacoData(taco)
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const pizzaStats = useMemo(() => computeStats(pizzaData, 'style'), [pizzaData])
  const tacoStats = useMemo(() => computeStats(tacoData, 'style'), [tacoData])

  if (loading) {
    return (
      <div className="data-dashboard">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading dashboard data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="data-dashboard">
        <div className="error-state">
          <p>Failed to load data: {error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="data-dashboard">
      <header className="dashboard-header">
        <h1>Data Dashboard</h1>
        <p className="dashboard-subtitle">Pizza and taco place statistics across the US</p>
      </header>

      <nav className="dashboard-tabs">
        {['overview', 'pizza', 'taco'].map(tab => (
          <button
            key={tab}
            className={`dashboard-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main className="dashboard-content">
        {activeTab === 'overview' && <OverviewTab pizzaStats={pizzaStats} tacoStats={tacoStats} />}
        {activeTab === 'pizza' && <PizzaTab stats={pizzaStats} />}
        {activeTab === 'taco' && <TacoTab stats={tacoStats} />}
      </main>

      <footer className="dashboard-footer">
        <a href="/">Back to Map</a>
      </footer>
    </div>
  )
}
