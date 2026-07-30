import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  List,
  ListFilter,
  Map as MapIcon,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import './ProductionDiscoveryShell.css'

const placePrice = place => place?.price_range || place?.priceRange || place?.price || ''

const placeRating = place => {
  const rating = Number(place?.rating)
  return Number.isFinite(rating) && rating > 0 ? rating : null
}

const placeAddress = place => (
  [place?.address, place?.city, place?.state]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' · ')
)

const sortValue = (place, mode) => {
  if (mode === 'name') return String(place?.name || '')
  if (mode === 'price') {
    const price = String(placePrice(place))
    return price ? price.replace(/[^$]/g, '').length : 99
  }
  return placeRating(place) ?? -1
}

export const sortProductionPlaces = (places, mode = 'recommended') => {
  const rows = Array.isArray(places) ? places.map((place, index) => ({ place, index })) : []
  return rows.sort((left, right) => {
    if (mode === 'recommended') return left.index - right.index
    if (mode === 'name') {
      const difference = sortValue(left.place, mode).localeCompare(sortValue(right.place, mode))
      return difference || left.index - right.index
    }
    if (mode === 'price') {
      const difference = sortValue(left.place, mode) - sortValue(right.place, mode)
      return difference || left.index - right.index
    }
    const difference = sortValue(right.place, mode) - sortValue(left.place, mode)
    return difference || left.index - right.index
  }).map(row => row.place)
}

const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'price', label: 'Lowest price' },
]

function ResultCard({ place, selected, onSelect, iconPath, picksLabel, isPickForPlace }) {
  const rating = placeRating(place)
  const price = placePrice(place)
  const address = placeAddress(place)
  const isPick = isPickForPlace ? isPickForPlace(place) : rating !== null && rating >= 8

  return (
    <button
      type="button"
      className={`production-result${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(place)}
      aria-pressed={selected}
    >
      <span className="production-result__media" aria-hidden="true">
        <img src={iconPath} alt="" />
      </span>
      <span className="production-result__body">
        <span className="production-result__heading">
          <strong>{place.name || 'Unnamed place'}</strong>
          {isPick ? (
            <span className="production-result__pick" title={picksLabel}>
              <Star size={12} fill="currentColor" aria-hidden="true" />
              Pick
            </span>
          ) : null}
        </span>
        <span className="production-result__meta">
          {rating !== null ? <b>{rating.toFixed(1)}</b> : null}
          {place.style ? <span>{place.style}</span> : null}
          {price ? <span>{price}</span> : null}
        </span>
        {address ? <span className="production-result__address">{address}</span> : null}
      </span>
      <ArrowUpRight className="production-result__arrow" size={16} aria-hidden="true" />
    </button>
  )
}

export default function ProductionDiscoveryShell({
  theme,
  entity,
  view,
  setView,
  mapLoading,
  mapError,
  mapNode,
  mapControls,
  places,
  hasMapAggregates,
  searchActive,
  selectedPlace,
  onPlaceClick,
  onPicksToggle,
  showPicks,
  picksLabel,
  isPickForPlace,
  sortMode,
  onSortChange,
  filterPanel,
  filtersOpen,
  onFiltersToggle,
  statsPanel,
  suggestionPanel,
  switchTarget,
  switchLabel,
  onSwitch,
  isPizza,
  scopeNotice,
  onSearchArea,
  frozenNode,
}) {
  const [sortOpen, setSortOpen] = useState(false)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [mobilePanel, setMobilePanel] = useState('map')
  const suggestionCloseRef = useRef(null)
  const iconPath = isPizza ? '/pizza-icon.svg' : '/taco-icon.svg'
  const scopedPlaces = useMemo(() => sortProductionPlaces(places, sortMode), [places, sortMode])
  const visiblePlaces = scopedPlaces.slice(0, 250)
  const title = theme.brandName

  const handlePlaceSelect = place => {
    onPlaceClick(place)
    setMobilePanel('map')
  }

  useEffect(() => {
    if (!suggestionOpen) return undefined

    const previousActiveElement = document.activeElement
    const handleKeyDown = event => {
      if (event.key === 'Escape') setSuggestionOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    suggestionCloseRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      if (previousActiveElement instanceof HTMLElement) previousActiveElement.focus()
    }
  }, [suggestionOpen])

  return (
    <div className={`production-discovery production-discovery--${entity}`}>
      <header className="production-discovery__topbar">
        <div className="production-discovery__mode-switch" aria-label="Content">
          <button type="button" className={view === 'map' ? 'is-active' : ''} onClick={() => setView('map')}>
            {isPizza ? 'Pizza Map' : 'Taco Map'}
          </button>
          <button
            type="button"
            className={view === 'frozen' ? 'is-active' : ''}
            onClick={() => setView('frozen')}
          >
            {isPizza ? 'Frozen Pizzas' : 'Recipes'}
          </button>
        </div>

        <a className="production-discovery__brand" href={isPizza ? '/' : '/tacos'} aria-label={`${title} home`}>
          <h1 className="title-gradient">{title}</h1>
          <small>by Anthony Wohlfeil</small>
        </a>

        <div className="production-discovery__actions">
          <a className="production-discovery__switch" href={switchTarget} onClick={onSwitch} aria-label={switchLabel}>
            <img src={isPizza ? '/taco-icon.svg' : '/pizza-icon.svg'} alt="" />
            <span>{switchLabel.replace('Check out ', '')}</span>
          </a>
          <button
            type="button"
            className="production-discovery__suggest"
            onClick={() => setSuggestionOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={suggestionOpen}
          >
            <span>Suggest a place</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      {suggestionOpen ? (
        <div
          className="production-discovery__dialog-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setSuggestionOpen(false)
          }}
        >
          <section
            className="production-discovery__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="production-suggestion-title"
          >
            <div className="production-discovery__dialog-header">
              <div>
                <span>{isPizza ? 'Pizza recommendations' : 'Taco recommendations'}</span>
                <h2 id="production-suggestion-title">Suggest a place</h2>
              </div>
              <button
                type="button"
                className="production-discovery__dialog-close"
                ref={suggestionCloseRef}
                onClick={() => setSuggestionOpen(false)}
                aria-label="Close suggestion form"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="production-discovery__dialog-copy">
              Share a spot I should add to the map and what I should order there.
            </p>
            {suggestionPanel}
          </section>
        </div>
      ) : null}

      {view === 'frozen' ? (
        <main className="production-discovery__frozen">{frozenNode}</main>
      ) : (
        <main className="production-discovery__workspace" data-mobile-panel={mobilePanel}>
          <section className="production-discovery__results" aria-label={`${entity} places`}>
            <div className="production-discovery__mobile-view-switch" role="group" aria-label="Browse view">
              <button
                type="button"
                className={mobilePanel === 'map' ? 'is-active' : ''}
                onClick={() => setMobilePanel('map')}
                aria-pressed={mobilePanel === 'map'}
              >
                <MapIcon size={15} aria-hidden="true" />
                Map
              </button>
              <button
                type="button"
                className={mobilePanel === 'list' ? 'is-active' : ''}
                onClick={() => setMobilePanel('list')}
                aria-pressed={mobilePanel === 'list'}
              >
                <List size={15} aria-hidden="true" />
                Places
              </button>
            </div>
            <div className="production-discovery__search">{mapControls}</div>

            <div className="production-discovery__toolbar">
              <button
                type="button"
                className={`production-discovery__tool${filtersOpen ? ' is-active' : ''}`}
                onClick={onFiltersToggle}
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                Filters
              </button>
              <button
                type="button"
                className={`production-discovery__tool${showPicks ? ' is-active' : ''}`}
                onClick={() => onPicksToggle(!showPicks)}
                aria-pressed={showPicks}
              >
                <Star size={15} fill={showPicks ? 'currentColor' : 'none'} aria-hidden="true" />
                {picksLabel}
              </button>
              <div className="production-discovery__sort">
                <button
                  type="button"
                  className={`production-discovery__tool${sortOpen ? ' is-active' : ''}`}
                  onClick={() => setSortOpen(open => !open)}
                  aria-expanded={sortOpen}
                  aria-haspopup="menu"
                >
                  <ArrowDownUp size={15} aria-hidden="true" />
                  Sort
                </button>
                {sortOpen ? (
                  <div className="production-discovery__sort-menu" role="menu" aria-label="Sort places">
                    {SORT_OPTIONS.map(option => (
                      <button
                        type="button"
                        key={option.value}
                        role="menuitemradio"
                        aria-checked={sortMode === option.value}
                        className={sortMode === option.value ? 'is-selected' : ''}
                        onClick={() => {
                          onSortChange(option.value)
                          setSortOpen(false)
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {filtersOpen ? <div className="production-discovery__filter-drawer">{filterPanel}</div> : null}

            <div className="production-discovery__summary">
              <div>
                <span>{entity === 'pizza' ? 'Pizza worth knowing' : 'Tacos worth knowing'}</span>
                <h1>{entity === 'pizza' ? 'Explore the map' : 'Explore the map'}</h1>
              </div>
              <strong>
                {scopedPlaces.length
                  ? `${scopedPlaces.length}${scopedPlaces.length >= 250 ? '+' : ''} places`
                  : hasMapAggregates && !searchActive ? 'Map has places' : '0 places'}
              </strong>
            </div>
            {statsPanel}
            {scopeNotice ? <div className="production-discovery__scope-note">{scopeNotice}</div> : null}

            <div className={`production-discovery__list${visiblePlaces.length ? '' : ' is-empty'}`}>
              {visiblePlaces.length ? visiblePlaces.map(place => (
                <ResultCard
                  key={place.id}
                  place={place}
                  selected={selectedPlace?.id === place.id}
                  onSelect={handlePlaceSelect}
                  iconPath={iconPath}
                  picksLabel={picksLabel}
                  isPickForPlace={isPickForPlace}
                />
              )) : (
                <div className="production-discovery__empty">
                  <ListFilter size={22} aria-hidden="true" />
                  <strong>{hasMapAggregates && !searchActive ? (onSearchArea ? 'Search this map area' : 'Choose an area to browse') : 'No places match this view'}</strong>
                  <span>{hasMapAggregates && !searchActive
                    ? (onSearchArea ? 'Places are grouped on the map. Search this area to browse them.' : 'Places are grouped on the map. Open the map and zoom into an area to browse them.')
                    : 'Try changing your search or filters.'}</span>
                  {hasMapAggregates && !searchActive && onSearchArea ? (
                    <button type="button" onClick={onSearchArea}>
                      <Search size={15} aria-hidden="true" />
                      Search this area
                    </button>
                  ) : hasMapAggregates && !searchActive ? (
                    <button type="button" onClick={() => setMobilePanel('map')}>
                      <MapIcon size={15} aria-hidden="true" />
                      Open map
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section className="production-discovery__map" aria-label={`Map of ${entity} places`}>
            {mapLoading ? <div className="production-discovery__status">Loading map…</div> : null}
            {mapError ? <div className="production-discovery__status is-error">{mapError.message}</div> : null}
            {!mapLoading && !mapError ? mapNode : null}
            {onSearchArea ? (
              <button type="button" className="production-discovery__search-area" onClick={onSearchArea}>
                <Search size={15} aria-hidden="true" />
                Search this area
              </button>
            ) : null}
            <div className="production-discovery__mobile-map-dock">
              <button type="button" onClick={() => setMobilePanel('list')}>
                <List size={15} aria-hidden="true" />
                View places
              </button>
              {onSearchArea ? (
                <button type="button" onClick={onSearchArea}>
                  <Search size={15} aria-hidden="true" />
                  Search area
                </button>
              ) : null}
            </div>
          </section>
        </main>
      )}
    </div>
  )
}
