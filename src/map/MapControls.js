import React, { useEffect, useState } from 'react'
import './MapControls.css'

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
  const showResults = (searchQuery.trim() || nearMeActive) && filteredPlaces.length > 0

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
            {filteredPlaces.length} {filteredPlaces.length === 1 ? 'place' : 'places'} found
          </div>
          <div className="map-results-list">
            {filteredPlaces.slice(0, 50).map(place => (
              <button
                key={place.id}
                type="button"
                className="map-result-item"
                onClick={() => onPlaceClick(place)}
              >
                <span className="map-result-name">{place.name}</span>
                {typeof place._distance === 'number' && (
                  <span className="map-result-distance">{place._distance.toFixed(1)} mi</span>
                )}
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
