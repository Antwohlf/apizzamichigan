// src/FrozenPizzaDirectory.js
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { DEFAULT_THEME_KEY, ThemeKeys } from './themes/siteTheme'
import { frozenTacosFallback } from './data/frozenTacos'

const TABLE_BY_THEME = {
  [ThemeKeys.PIZZA]: 'frozen_pizzas',
  [ThemeKeys.TACO]: 'frozen_tacos',
}

export default function FrozenPizzaDirectory({ filters, theme, themeKey = DEFAULT_THEME_KEY }) {
  const [pizzas, setPizzas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: 'Brand', direction: 'asc' })

  useEffect(() => {
    setSortConfig({ key: 'Brand', direction: 'asc' })
  }, [themeKey])

  useEffect(() => {
    async function fetchPizzas() {
      setLoading(true)
      const table = TABLE_BY_THEME[themeKey] || TABLE_BY_THEME[DEFAULT_THEME_KEY]
      const fallbackRows = themeKey === ThemeKeys.TACO ? frozenTacosFallback : []

      const canQuery = typeof supabase?.from === 'function'
      let data = null
      let error = null

      if (canQuery) {
        try {
          const fromResult = supabase.from(table)
          if (fromResult && typeof fromResult.select === 'function') {
            const selectResult = fromResult.select('*')
            if (selectResult && typeof selectResult.order === 'function') {
              const response = await selectResult.order('Brand', { ascending: true })
              data = response?.data ?? null
              error = response?.error ?? null
            } else {
              const response = await selectResult
              data = response?.data ?? response ?? null
              error = response?.error ?? null
            }
          } else {
            error = new Error('Query builder missing select method')
          }
        } catch (err) {
          error = err
        }
      }

      if (!canQuery || error) {
        setPizzas(fallbackRows)
        setError(canQuery ? error : null)
      } else {
        const normalized = (data || []).map(p => ({
          ...p,
          Type: p.Type === 'Standard' || p.Type === 'Traditional' ? 'Standard Round' : p.Type,
        }))
        if (normalized.length === 0 && themeKey === ThemeKeys.TACO) {
          setPizzas(frozenTacosFallback)
          setError(null)
        } else {
          setPizzas(normalized)
          setError(null)
        }
      }
      setLoading(false)
    }
    fetchPizzas()
  }, [themeKey])

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

  if (loading) return <div style={{ padding: '2rem', color: theme.palette.accent }}>Loading…</div>
  if (error)   return <div style={{ padding: '2rem', color: '#c0392b' }}>{theme.copy.errorPrefix}: {error.message}</div>
  if (displayedPizzas.length === 0)
    return <div style={{ padding: '2rem', color: theme.palette.mutedText }}>Nothing matches your filters.</div>

  const headers = ['Brand','Type','Price','Rating','Notes']

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '1rem 2rem 2.5rem',
        background: theme.palette.card,
        color: theme.palette.text,
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}
    >
      <h2 style={{ color: theme.palette.accent, margin: '0 auto 1rem', textAlign: 'center' }}>
        {themeKey === ThemeKeys.TACO ? 'Frozen Taco Directory' : 'Frozen Pizza Directory'}
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
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
                    borderBottom: `1px solid ${theme.palette.border}`,
                    cursor: isSortable ? 'pointer' : 'default',
                    color: isSortable ? theme.palette.text : theme.palette.mutedText,
                    userSelect: 'none'
                  }}
                >
                  <span>{h}</span>
                  {isSorted && (
                    <span style={{ marginLeft: '0.25rem', fontSize: '0.75rem', color: theme.palette.accent }}>
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
            <tr key={i} style={{ borderTop: `1px solid ${theme.palette.border}` }}>
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
