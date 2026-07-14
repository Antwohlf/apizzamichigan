import React, { useEffect, useState } from 'react'
import './MapControls.css'

const placePrice = place => place?.price_range || place?.priceRange || place?.price || ''

// Debounced search bar component
function SearchBar({ value, onChange }) {
  const [localValue, setLocalValue] = useState(value || '')

  useEffect(() => {
    setLocalValue(value || '')
  }, [value])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [localValue, onChange, value])

  return (
    <div className="map-search-bar">
      <span className="map-search-icon">🔍</span>
      <input
        type="text"
        placeholder="Search places..."
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        aria-label="Search places"
      />
      {localValue && (
        <button
          className="map-search-clear"
          onClick={() => {
            setLocalValue('')
            onChange('')
          }}
          aria-label="Clear search"
          type="button"
        >
          ×
        </button>
      )}
    </div>
  )
}

export function MapControls({
  searchQuery = '',
  onSearchChange,
  nearMeActive = false,
  nearMeRadius = 25,
  locationError = null,
  onNearMeToggle,
  onRadiusChange,
  filteredPlaces = [],
  onPlaceClick,
}) {
  const [isResultsOpen, setIsResultsOpen] = useState(true)

  useEffect(() => {
    if ((searchQuery.trim() || nearMeActive) && filteredPlaces.length > 0) {
      setIsResultsOpen(true)
    }
  }, [searchQuery, nearMeActive, filteredPlaces.length])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsResultsOpen(false)
      }
    }
    const handlePointerDown = (event) => {
      const target = event?.target
      if (target && typeof target.closest === 'function' && !target.closest('.map-controls')) {
        setIsResultsOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown, { passive: true })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [])

  const showResults = isResultsOpen && (searchQuery.trim() || nearMeActive) && filteredPlaces.length > 0

  return (
    <div className="map-controls">
      <div className="map-controls-row">
        {onSearchChange && (
          <SearchBar value={searchQuery} onChange={onSearchChange} />
        )}

        {onNearMeToggle && (
          <div className="map-near-me-group">
            <button
              className={`map-near-me-btn${nearMeActive ? ' active' : ''}`}
              onClick={onNearMeToggle}
              type="button"
            >
              <span className="near-me-icon">📍</span>
              Near Me
            </button>
            {nearMeActive && onRadiusChange && (
              <select
                value={nearMeRadius}
                onChange={e => onRadiusChange(Number(e.target.value))}
                className="map-radius-select"
                aria-label="Search radius"
              >
                <option value={5}>5 mi</option>
                <option value={10}>10 mi</option>
                <option value={25}>25 mi</option>
                <option value={50}>50 mi</option>
              </select>
            )}
          </div>
        )}
      </div>

      {locationError && (
        <div className="map-location-error">{locationError}</div>
      )}

      {showResults && onPlaceClick && (
        <div className="map-results-dropdown">
          <div className="map-results-header">
            <span>{filteredPlaces.length} {filteredPlaces.length === 1 ? 'place' : 'places'} found</span>
            <button
              type="button"
              className="map-results-close"
              onClick={() => setIsResultsOpen(false)}
              aria-label="Hide results"
            >
              Hide
            </button>
          </div>
          <div className="map-results-list">
            {filteredPlaces.slice(0, 50).map(place => (
              <button
                key={place.id}
                type="button"
                className="map-result-item"
                onClick={() => {
                  setIsResultsOpen(false)
                  onPlaceClick(place)
                }}
              >
                <span className="map-result-main">
                  <span className="map-result-name">{place.name}</span>
                  {(place.style || placePrice(place)) && (
                    <span className="map-result-meta">
                      {[place.style, placePrice(place)].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="map-result-side">
                  {typeof place._distance === 'number' ? `${place._distance.toFixed(1)} mi` : ''}
                </span>
              </button>
            ))}
            {filteredPlaces.length > 50 && (
              <div className="map-results-more">+ {filteredPlaces.length - 50} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
