import React, { useEffect, useMemo, useState } from 'react'
import './MapControls.css'

const placePrice = place => place?.price_range || place?.priceRange || place?.price || ''
const placeLocation = place => {
  const parts = [place?.address, place?.city, place?.state].filter(Boolean)
  return [...new Set(parts)].join(' · ')
}
const isReviewedPlace = place => {
  const status = String(place?.statusRaw ?? place?.status ?? '').trim().toLowerCase()
  return (
    (status.startsWith('visited') || status.startsWith('golden')) &&
    typeof place?.rating === 'number' &&
    !Number.isNaN(place.rating)
  )
}
const placeMeta = place => {
  const statusLabel = isReviewedPlace(place) ? 'Anthony reviewed' : ''
  const parts = [place?.style, placePrice(place), statusLabel].filter(Boolean)
  if (typeof place?.rating === 'number' && !Number.isNaN(place.rating)) parts.unshift(`★ ${place.rating}`)
  return parts.join(' · ')
}

export const searchResultBadge = place => {
  if (!place) return ''
  if (isReviewedPlace(place)) return 'Reviewed'
  const status = String(place?.statusRaw ?? place?.status ?? '').trim().toLowerCase()
  if (status === 'golden') return 'Favorite'
  return 'Suggestion'
}

const resultDomId = place => `map-search-result-${String(place?.id ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`

export const searchResultSummary = places => {
  const list = Array.isArray(places) ? places : []
  const reviewed = list.filter(isReviewedPlace).length
  const suggestions = Math.max(0, list.length - reviewed)
  const distances = list
    .map(place => place?._distance)
    .filter(distance => typeof distance === 'number' && Number.isFinite(distance))
  const averageDistance = distances.length
    ? distances.reduce((sum, distance) => sum + distance, 0) / distances.length
    : null

  return {
    total: list.length,
    reviewed,
    suggestions,
    averageDistance,
  }
}

const reviewedSortScore = place => {
  if (!isReviewedPlace(place)) return -1
  const rating = typeof place?.rating === 'number' && Number.isFinite(place.rating) ? place.rating : 0
  return 100 + rating
}

const normalizeSearchText = value =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const termMatches = (text, terms) => {
  const normalized = normalizeSearchText(text)
  return Boolean(normalized && terms.some(term => normalized.includes(term)))
}

const queryMatchesPrice = (price, query) => {
  const normalizedPrice = String(price || '').trim()
  if (!normalizedPrice) return false
  const rawQuery = String(query || '').toLowerCase()
  const priceTokens = rawQuery.match(/\${1,4}/g) || []
  if (normalizedPrice.includes('$') && priceTokens.includes(normalizedPrice.toLowerCase())) return true
  const normalizedQuery = normalizeSearchText(query)
  const priceWords = {
    '$': ['cheap', 'budget', 'inexpensive'],
    '$$': ['moderate', 'mid range', 'midrange'],
    '$$$': ['expensive', 'upscale'],
    '$$$$': ['premium', 'splurge'],
  }[normalizedPrice] || []
  return priceWords.some(word => normalizedQuery.includes(word))
}

export const searchResultReason = (place, query = '') => {
  const terms = normalizeSearchText(query).split(/\s+/).filter(term => term.length >= 2)
  if (!place) return ''

  const name = normalizeSearchText(place.name)
  const brand = place.brand && normalizeSearchText(place.brand) !== name ? place.brand : ''
  const operator = place.operator && normalizeSearchText(place.operator) !== name && normalizeSearchText(place.operator) !== normalizeSearchText(brand) ? place.operator : ''
  const address = place.address || ''
  const location = [place.city, place.state].filter(Boolean).join(', ')
  const style = place.style || place.type || ''
  const price = placePrice(place)
  const reviewed = isReviewedPlace(place)
  if (!terms.length && !queryMatchesPrice(price, query)) return ''
  const addressOnlyTerms = address
    ? terms.filter(term =>
      termMatches(address, [term]) &&
      !termMatches(place.name, [term]) &&
      (!brand || !termMatches(brand, [term])) &&
      (!operator || !termMatches(operator, [term]))
    )
    : []

  if (brand && termMatches(brand, terms)) return `Brand match: ${brand}`
  if (operator && termMatches(operator, terms)) return `Operator match: ${operator}`
  if (style && termMatches(style, terms) && !termMatches(place.name, terms)) return `Style match: ${style}`
  if (queryMatchesPrice(price, query) && !termMatches(place.name, terms)) return `Price match: ${price}`
  if (reviewed && termMatches('reviewed visited anthony tried favorite favorites', terms) && !termMatches(place.name, terms)) return 'Status match: Anthony reviewed'
  if (addressOnlyTerms.length) return `Address match: ${address}`
  if (location && termMatches(location, terms) && !termMatches(place.name, terms)) return `Location match: ${location}`
  return ''
}

// Debounced search bar component
function SearchBar({ value, onChange, onKeyDown, onFocus, resultsId, activeDescendantId, expanded }) {
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
        role="combobox"
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
        aria-autocomplete="list"
        aria-controls={resultsId}
        aria-expanded={expanded}
        aria-activedescendant={activeDescendantId || undefined}
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
  const [visibleResultLimit, setVisibleResultLimit] = useState(null)
  const [reviewedFirst, setReviewedFirst] = useState(false)
  const hasSearch = Boolean(searchQuery.trim())
  const shouldShowResultPanel = hasSearch || nearMeActive
  const defaultResultLimit = hasSearch ? 12 : 20
  const resultLimit = visibleResultLimit || defaultResultLimit
  const displayPlaces = useMemo(() => {
    if (!reviewedFirst) return filteredPlaces
    return filteredPlaces
      .map((place, index) => ({ place, index }))
      .sort((left, right) => {
        const reviewedDelta = reviewedSortScore(right.place) - reviewedSortScore(left.place)
        if (reviewedDelta !== 0) return reviewedDelta
        const distanceDelta = (left.place?._distance ?? Number.POSITIVE_INFINITY) - (right.place?._distance ?? Number.POSITIVE_INFINITY)
        if (Number.isFinite(distanceDelta) && distanceDelta !== 0) return distanceDelta
        return left.index - right.index
      })
      .map(row => row.place)
  }, [filteredPlaces, reviewedFirst])
  const visibleResults = useMemo(
    () => displayPlaces.slice(0, resultLimit),
    [displayPlaces, resultLimit]
  )
  const resultSummary = useMemo(() => searchResultSummary(filteredPlaces), [filteredPlaces])
  const resultListId = 'map-search-results-list'
  const activeResultId = visibleResults[activeResultIndex] ? resultDomId(visibleResults[activeResultIndex]) : ''

  useEffect(() => {
    if (shouldShowResultPanel) {
      setIsResultsOpen(true)
    }
    setActiveResultIndex(0)
    setVisibleResultLimit(null)
    setReviewedFirst(false)
  }, [shouldShowResultPanel, filteredPlaces.length, searchQuery])

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
            resultsId={resultListId}
            activeDescendantId={showResults ? activeResultId : ''}
            expanded={Boolean(showResults)}
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
          {!searchError && !searchLoading && filteredPlaces.length > 0 ? (
            <div className="map-results-summary-row">
              <div className="map-results-summary" aria-label="Search result summary">
                <span>{resultSummary.reviewed} Anthony reviewed</span>
                <span>{resultSummary.suggestions} suggestions</span>
                {resultSummary.averageDistance !== null ? (
                  <span>{resultSummary.averageDistance.toFixed(1)} mi avg</span>
                ) : null}
              </div>
              {resultSummary.reviewed > 0 && resultSummary.suggestions > 0 ? (
                <label className="map-results-reviewed-toggle">
                  <input
                    type="checkbox"
                    checked={reviewedFirst}
                    onChange={event => {
                      setReviewedFirst(event.target.checked)
                      setActiveResultIndex(0)
                    }}
                  />
                  <span>Reviewed first</span>
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="map-results-list" id={resultListId} role="listbox" aria-label="Search results">
            {searchError ? (
              <div className="map-results-empty">Search is unavailable right now</div>
            ) : null}
            {!searchError && searchLoading ? (
              <div className="map-results-empty">Searching...</div>
            ) : null}
            {!searchError && !searchLoading && visibleResults.length === 0 ? (
              <div className="map-results-empty">No matching places found</div>
            ) : null}
            {visibleResults.map((place, index) => {
              const resultReason = searchResultReason(place, searchQuery)
              return (
                <button
                  id={resultDomId(place)}
                  key={place.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeResultIndex}
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
                    {resultReason ? (
                      <span className="map-result-reason">{resultReason}</span>
                    ) : null}
                  </span>
                  <span className="map-result-side">
                    <span className={`map-result-badge map-result-badge--${searchResultBadge(place).toLowerCase()}`}>
                      {searchResultBadge(place)}
                    </span>
                    {typeof place._distance === 'number' ? (
                      <span className="map-result-distance">{place._distance.toFixed(1)} mi</span>
                    ) : null}
                  </span>
                </button>
              )
            })}
            {filteredPlaces.length > visibleResults.length && (
              <button
                type="button"
                className="map-results-more"
                onClick={() => {
                  setVisibleResultLimit(prev => Math.min((prev || defaultResultLimit) + defaultResultLimit, filteredPlaces.length))
                }}
              >
                Show {Math.min(defaultResultLimit, filteredPlaces.length - visibleResults.length)} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
