import React, { useEffect, useMemo, useState } from 'react'
import './MapControls.css'

const placePrice = place => place?.price_range || place?.priceRange || place?.price || ''
const placeLocation = place => {
  const parts = [place?.address, place?.city, place?.state].filter(Boolean)
  return [...new Set(parts)].join(' · ')
}
const placeMeta = place => {
  const parts = [place?.style, placePrice(place), place?.status].filter(Boolean)
  if (typeof place?.rating === 'number' && !Number.isNaN(place.rating)) parts.unshift(`★ ${place.rating}`)
  return parts.join(' · ')
}

// Debounced search bar component
function SearchBar({ value, onChange, onKeyDown, onFocus }) {
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
        onFocus={onFocus}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            onChange(localValue)
          }
          if (onKeyDown) onKeyDown(event)
        }}
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
  searchLoading = false,
  searchError = null,
  onNearMeToggle,
  onRadiusChange,
  filteredPlaces = [],
  onPlaceClick,
}) {
  const [isResultsOpen, setIsResultsOpen] = useState(true)
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const hasSearch = Boolean(searchQuery.trim())
  const shouldShowResultPanel = hasSearch || nearMeActive
  const resultLimit = hasSearch ? 12 : 20
  const visibleResults = useMemo(
    () => filteredPlaces.slice(0, resultLimit),
    [filteredPlaces, resultLimit]
  )

  useEffect(() => {
    if (shouldShowResultPanel) {
      setIsResultsOpen(true)
    }
    setActiveResultIndex(0)
  }, [shouldShowResultPanel, filteredPlaces.length])

  const openResult = (place) => {
    if (!place || !onPlaceClick) return
    setIsResultsOpen(false)
    onPlaceClick(place)
  }

  const handleSearchKeyDown = (event) => {
    if (!shouldShowResultPanel || !visibleResults.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsResultsOpen(true)
      setActiveResultIndex(index => Math.min(index + 1, visibleResults.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIsResultsOpen(true)
      setActiveResultIndex(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openResult(visibleResults[activeResultIndex] || visibleResults[0])
    }
  }

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

  const showResults = isResultsOpen && shouldShowResultPanel && onPlaceClick

  return (
    <div className="map-controls">
      <div className="map-controls-row">
        {onSearchChange && (
          <SearchBar
            value={searchQuery}
            onChange={onSearchChange}
            onFocus={() => {
              if (shouldShowResultPanel) setIsResultsOpen(true)
            }}
            onKeyDown={handleSearchKeyDown}
          />
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
        <div className="map-results-dropdown" id="map-search-results">
          <div className="map-results-header">
            <span>
              {searchLoading
                ? 'Searching places'
                : `${filteredPlaces.length} ${filteredPlaces.length === 1 ? 'place' : 'places'} found${filteredPlaces.length > visibleResults.length ? ` · showing ${visibleResults.length}` : ''}`}
            </span>
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
            {searchError ? (
              <div className="map-results-empty">Search is unavailable right now</div>
            ) : null}
            {!searchError && searchLoading ? (
              <div className="map-results-empty">Searching...</div>
            ) : null}
            {!searchError && !searchLoading && visibleResults.length === 0 ? (
              <div className="map-results-empty">No matching places found</div>
            ) : null}
            {visibleResults.map((place, index) => (
              <button
                key={place.id}
                type="button"
                className={`map-result-item${index === activeResultIndex ? ' active' : ''}`}
                onClick={() => {
                  openResult(place)
                }}
                onMouseEnter={() => setActiveResultIndex(index)}
              >
                <span className="map-result-main">
                  <span className="map-result-name">{place.name}</span>
                  {placeLocation(place) ? (
                    <span className="map-result-location">{placeLocation(place)}</span>
                  ) : null}
                  {placeMeta(place) ? (
                    <span className="map-result-meta">{placeMeta(place)}</span>
                  ) : null}
                </span>
                <span className="map-result-side">
                  {typeof place._distance === 'number' ? `${place._distance.toFixed(1)} mi` : ''}
                </span>
              </button>
            ))}
            {filteredPlaces.length > visibleResults.length && (
              <div className="map-results-more">+ {filteredPlaces.length - visibleResults.length} more matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
