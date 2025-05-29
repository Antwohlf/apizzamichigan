// src/FrozenPizzaDirectory.js
import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'

export default function FrozenPizzaDirectory({ filters }) {
  const [pizzas, setPizzas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: 'Brand', direction: 'asc' })

  useEffect(() => {
    async function fetchPizzas() {
      setLoading(true)
      const { data, error } = await supabase
        .from('frozen_pizzas')
        .select('*')
      if (error) setError(error)
      else setPizzas(data)
      setLoading(false)
    }
    fetchPizzas()
  }, [])

  // sort first
  const sortedPizzas = useMemo(() => {
    const { key, direction } = sortConfig
    return [...pizzas].sort((a, b) => {
      let aVal = a[key] ?? ''
      let bVal = b[key] ?? ''
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }
      if (aVal < bVal) return direction === 'asc' ? -1 : 1
      if (aVal > bVal) return direction === 'asc' ? 1 : -1
      return 0
    })
  }, [pizzas, sortConfig])

  // then filter by sidebar selections
  const displayedPizzas = useMemo(() => {
    return sortedPizzas.filter(p =>
      (filters.styles.length === 0 || filters.styles.includes(p.Type)) &&
      (filters.prices.length === 0 || filters.prices.includes(p.Price.toString()))
    )
  }, [sortedPizzas, filters])

  const requestSort = key => {
    const sortable = ['Brand','Type','Price','Rating']
    if (!sortable.includes(key)) return
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    )
  }

  if (loading) return <div style={{ padding: '2rem', color: '#FFA500' }}>Loading…</div>
  if (error)   return <div style={{ padding: '2rem', color: 'red' }}>Error: {error.message}</div>
  if (displayedPizzas.length === 0)
    return <div style={{ padding: '2rem', color: '#EEE' }}>No pizzas found.</div>

  const headers = ['Brand','Type','Price','Rating','Notes']

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '1rem 2rem',
        background: '#1f1f1f',
        color: '#EEE',
        overflowY: 'auto',
      }}
    >
      <h2 style={{ color: '#FFA500', margin: '0 auto 1rem', textAlign: 'center' }}>
        Frozen Pizza Directory
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map(h => {
              const isSorted = sortConfig.key === h
              const arrow = isSorted
                ? sortConfig.direction === 'asc' ? '▲' : '▼'
                : ''
              const isSortable = h !== 'Notes'
              return (
                <th
                  key={h}
                  onClick={() => isSortable && requestSort(h)}
                  style={{
                    textAlign: h === 'Price' || h === 'Rating' ? 'center' : 'left',
                    padding: '.5rem',
                    borderBottom: '1px solid #444',
                    cursor: isSortable ? 'pointer' : 'default',
                    color: isSortable ? '#EEE' : '#888',
                    userSelect: 'none'
                  }}
                >
                  <span>{h}</span>
                  {isSorted && (
                    <span style={{ marginLeft: '0.25rem', fontSize: '0.75rem', color: '#FFA500' }}>
                      {arrow}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {displayedPizzas.map((p, i) => (
            <tr key={i} style={{ borderTop: '1px solid #444' }}>
              <td style={{ padding: '.5rem' }}>{p.Brand}</td>
              <td style={{ padding: '.5rem' }}>{p.Type}</td>
              <td style={{ padding: '.5rem', textAlign: 'center' }}>{p.Price}</td>
              <td style={{ padding: '.5rem', textAlign: 'center' }}>{p.Rating}</td>
              <td style={{ padding: '.5rem' }}>{p.Notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
