import React from 'react'
import { LATIN_MARKETS_PLACEHOLDER } from './data/latinMarkets.placeholder'

const rowStyle = {
  border: '1px solid var(--app-border)',
  borderRadius: 6,
  padding: '0.75rem 1rem',
  background: 'rgba(0,0,0,0.05)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
}

export default function LatinMarkets() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '1rem 1.5rem',
        background: 'var(--app-card)',
        color: 'var(--app-text)',
        overflowY: 'auto',
      }}
    >
      <h2 style={{ textAlign: 'center', margin: '0 0 1rem', color: 'var(--app-accent)' }}>
        Latin Markets Directory
      </h2>
      <p style={{ maxWidth: 520, margin: '0 auto 1.5rem', textAlign: 'center', color: 'var(--app-text-muted)' }}>
        Mapping mercados, tortillerías, and specialty grocers while Supabase latin_markets data is prepared.
      </p>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {LATIN_MARKETS_PLACEHOLDER.map(market => (
          <div key={market.id} style={rowStyle}>
            <div>
              <div style={{ fontWeight: 600 }}>{market.name}</div>
              {market.city && (
                <div style={{ color: 'var(--app-text-muted)', fontSize: '0.9rem' }}>{market.city}</div>
              )}
              {market.notes && (
                <div style={{ color: 'var(--app-text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  {market.notes}
                </div>
              )}
            </div>
            {market.url && (
              <a
                href={market.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--app-accent)', fontWeight: 600 }}
              >
                Visit
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
