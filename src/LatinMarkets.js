import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { LATIN_MARKETS_PLACEHOLDER } from './data/latinMarkets.placeholder'

const containerStyle = {
  width: '100%',
  height: '100%',
  padding: '1rem 1.5rem',
  background: 'var(--app-card)',
  color: 'var(--app-text)',
  overflowY: 'auto',
}

const gridStyle = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  alignItems: 'stretch',
}

const cardStyle = {
  border: '1px solid var(--app-border)',
  borderRadius: 12,
  padding: '0.85rem 1rem',
  background: 'rgba(0,0,0,0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  minWidth: 0,
  height: '100%',
  boxSizing: 'border-box',
}

const headingStyle = {
  margin: 0,
  fontSize: '1.25rem',
  fontWeight: 600,
}

const subheadingStyle = {
  margin: 0,
  fontSize: '0.9rem',
  color: 'var(--app-text-muted)',
}

const detailsListStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '0.35rem',
}

const detailRowStyle = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'baseline',
  fontSize: '0.9rem',
  flexWrap: 'wrap',
  rowGap: '0.25rem',
}

const labelStyle = {
  minWidth: '4.75rem',
  fontWeight: 600,
  color: 'var(--app-text-muted)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

export default function LatinMarkets() {
  const [markets, setMarkets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchMarkets() {
      setLoading(true)
      const { data, error } = await supabase
        .from('latin_markets')
        .select('*')
        .order('name', { ascending: true })

      if (cancelled) return

      if (error) {
        console.error('Failed to load latin markets:', error)
        setError(error)
        setMarkets(LATIN_MARKETS_PLACEHOLDER)
      } else {
        const normalized = (data || []).map(row => {
          const toStr = value => (value === null || value === undefined ? '' : String(value))
          return {
            id: row.id,
            name: toStr(row.name).trim() || 'Unnamed Market',
            address: toStr(row.address).trim(),
            type: toStr(row.type).trim(),
            phone: toStr(row.phone_number || row.phone).trim(),
            website: toStr(row.website).trim(),
            notes: toStr(row.notes).trim(),
          }
        })

        if (normalized.length === 0) {
          console.info('latin_markets table returned 0 rows — showing empty state', { data })
        } else {
          console.debug('Fetched latin_markets rows', normalized.length, normalized)
        }

        setMarkets(normalized)
        setError(null)
      }
      setLoading(false)
    }

    fetchMarkets()

    return () => {
      cancelled = true
    }
  }, [])

  const hasData = useMemo(() => Array.isArray(markets) && markets.length > 0, [markets])

  const emptyState = !loading && !hasData && !error
  const fallbackState = !loading && !hasData && !!error

  const marketsToDisplay = hasData ? markets : error ? LATIN_MARKETS_PLACEHOLDER : []

  return (
    <div style={containerStyle}>
      <h2 style={{ textAlign: 'center', margin: '0 0 0.75rem', color: 'var(--app-accent)' }}>
        Latin Markets Directory
      </h2>
      <p style={{ maxWidth: 560, margin: '0 auto 1.5rem', textAlign: 'center', color: 'var(--app-text-muted)' }}>
        Spotlighting mercados, tortillerías, and specialty grocers across Michigan.
      </p>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--app-text-muted)', padding: '2rem 0' }}>
          Loading markets…
        </div>
      )}

      {emptyState && (
        <div style={{ textAlign: 'center', color: 'var(--app-text-muted)', padding: '2rem 0' }}>
          No markets published yet — try adding one from the admin dashboard.
        </div>
      )}

      {fallbackState && (
        <div style={{ textAlign: 'center', color: 'var(--app-text-muted)', padding: '2rem 0' }}>
          Showing a short list while we reconnect to Supabase.
        </div>
      )}

      {!loading && marketsToDisplay.length > 0 && (
        <div style={gridStyle}>
          {marketsToDisplay.map(market => (
            <article key={market.id || market.name} style={cardStyle}>
              <header>
                <h3 style={headingStyle}>{market.name}</h3>
                {market.type && <p style={subheadingStyle}>{market.type}</p>}
              </header>

              <ul style={detailsListStyle}>
                {market.address && (
                  <li style={detailRowStyle}>
                    <span style={labelStyle}>Address</span>
                    <span style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>{market.address}</span>
                  </li>
                )}
                {market.phone && (
                  <li style={detailRowStyle}>
                    <span style={labelStyle}>Phone</span>
                    <a href={`tel:${market.phone}`} style={{ color: 'var(--app-accent)', overflowWrap: 'anywhere' }}>
                      {market.phone}
                    </a>
                  </li>
                )}
                {market.website && (
                  <li style={detailRowStyle}>
                    <span style={labelStyle}>Website</span>
                    <a
                      href={market.website.startsWith('http') ? market.website : `https://${market.website}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--app-accent)', overflowWrap: 'anywhere' }}
                    >
                      {market.website.replace(/https?:\/\//i, '')}
                    </a>
                  </li>
                )}
                {market.notes && (
                  <li style={detailRowStyle}>
                    <span style={labelStyle}>Notes</span>
                    <span style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>{market.notes}</span>
                  </li>
                )}
              </ul>
            </article>
          ))}
        </div>
      )}

      {error && (
        <p style={{ textAlign: 'center', color: '#f87171', marginTop: '1.5rem' }}>
          Couldn’t reach Supabase just now; check the console for details.
        </p>
      )}
    </div>
  )
}
