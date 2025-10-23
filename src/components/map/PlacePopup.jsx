import React, { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'

const badgeStyles = {
  base: {
    borderRadius: '999px',
    padding: '0.2rem 0.6rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  price: {
    background: 'rgba(15,23,42,0.08)',
    color: '#f97316',
    border: '1px solid rgba(249,115,22,0.35)',
  },
  status: {
    background: 'rgba(148,163,184,0.1)',
    color: '#cbd5f5',
    border: '1px solid rgba(148,163,184,0.25)',
  },
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'row',
  gap: '0.75rem',
  padding: '1rem',
  borderRadius: '18px',
  background: 'rgba(17,25,40,0.96)',
  color: '#f8fafc',
  boxShadow: '0 24px 60px rgba(15,23,42,0.45)',
  maxWidth: '320px',
  minWidth: '260px',
  position: 'relative',
}

export function PlacePopup({ place, onClose }) {
  const primaryButtonRef = useRef(null)
  const location = useLocation()

  useEffect(() => {
    if (primaryButtonRef.current && typeof primaryButtonRef.current.focus === 'function') {
      primaryButtonRef.current.focus()
    }
  }, [])

  if (!place) return null

  const { id, type, name, price, status, rating, address, photoUrl, lat, lng } = place
  const ratingLabel = typeof rating === 'number' ? rating.toFixed(1) : null

  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`
  const poiParam = `${type}:${id}`
  const viewDetailsHref = type === 'taco' ? `/tacos?poi=${poiParam}` : `/?poi=${poiParam}`

  return (
    <div className="place-popup-shell" role="dialog" aria-modal="true">
      <div style={cardStyle}>
        {photoUrl ? (
          <div className="place-popup-thumb">
            <img src={`${photoUrl}?width=160&quality=70`} alt="" loading="lazy" />
          </div>
        ) : null}
        <div className="place-popup-content">
          <header className="place-popup-header">
            <h3>{name}</h3>
            <div className="place-popup-badges">
              {price ? (
                <span style={{ ...badgeStyles.base, ...badgeStyles.price }} aria-label={`Price ${price}`}>
                  {price}
                </span>
              ) : null}
              {status ? (
                <span style={{ ...badgeStyles.base, ...badgeStyles.status }} aria-label={`Status ${status}`}>
                  {status}
                </span>
              ) : null}
            </div>
          </header>

          <div className="place-popup-meta">
            {ratingLabel ? (
              <span className="place-popup-rating" aria-label={`Rating ${ratingLabel}`}>
                ★ {ratingLabel}
              </span>
            ) : null}
            {address ? <span className="place-popup-address">{address}</span> : null}
          </div>

          <div className="place-popup-actions">
            <Link
              to={viewDetailsHref}
              state={{ from: location.pathname + location.search }}
              className="place-popup-button primary"
              ref={primaryButtonRef}
              onClick={onClose}
            >
              View details
            </Link>
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="place-popup-button subtle"
              onClick={onClose}
            >
              Directions
            </a>
          </div>
        </div>

        <button type="button" className="place-popup-close" onClick={onClose} aria-label="Close popup">
          ×
        </button>
      </div>
    </div>
  )
}
