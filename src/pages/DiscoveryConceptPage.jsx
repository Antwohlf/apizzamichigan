import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  ChevronDown,
  Crosshair,
  ExternalLink,
  ListFilter,
  LocateFixed,
  MapPin,
  Palette,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import pizzaPlaces from '../data'
import { tacoPlacesFallback } from '../data/tacoPlaces'
import FrozenPizzaDirectory from '../FrozenPizzaDirectory'
import { StatsPanel } from '../sidebar/StatsPanel'
import pizzaMarker from '../icons/pizza/marker-pizza-colored.svg'
import pizzaMarkerGold from '../icons/pizza/marker-pizza-gold.svg'
import tacoMarker from '../icons/taco/marker-taco-colored.svg'
import tacoMarkerGold from '../icons/taco/marker-taco-gold.svg'
import { pizzaTheme } from '../themes/pizzaTheme'
import { ThemeKeys } from '../themes/siteTheme'
import '../styles/discovery-concept.css'

const ANN_ARBOR_CENTER = [42.2796, -83.743]
const DETROIT_CENTER = [42.303, -83.215]
const DEFAULT_ZOOM = 13
const PICK_THRESHOLD = 8
// The concept directory is a presentation layer, not a geographic scope.
// Stats must represent the full public table rather than the two home markets.
const CONCEPT_STATES = []
const EMPTY_FROZEN_FILTERS = { styles: [], prices: [] }

const normalizeText = value => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const conceptPlace = (place, index) => ({
  ...place,
  id: `${normalizeText(place.name).replace(/\s+/g, '-')}-${index}`,
  address: place.Address || place.address || '',
  price: place.price || place.price_range || '',
  isPick: Number(place.rating) >= PICK_THRESHOLD,
})

export const conceptPlaces = pizzaPlaces
  .filter(place => (
    Number(place.lat) >= 42.245 &&
    Number(place.lat) <= 42.31 &&
    Number(place.lng) >= -83.8 &&
    Number(place.lng) <= -83.69
  ))
  .map(conceptPlace)
  .sort((left, right) => Number(right.rating || 0) - Number(left.rating || 0))

export const conceptTacoPlaces = tacoPlacesFallback
  .map((place, index) => conceptPlace({
    ...place,
    address: place.address || 'Metro Detroit, Michigan',
  }, index))
  .sort((left, right) => Number(right.rating || 0) - Number(left.rating || 0))

export const matchesConceptSearch = (place, query) => {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = normalizeText([
    place.name,
    place.style,
    place.price,
    place.address,
    place.review,
  ].filter(Boolean).join(' '))
  return terms.every(term => haystack.includes(term))
}

const priceRank = value => {
  const rank = String(value || '').replace(/[^$]/g, '').length
  return rank || 99
}

const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'price', label: 'Lowest price' },
]

export const sortConceptPlaces = (places, sortMode) => [...places].sort((left, right) => {
  if (sortMode === 'rating') {
    return Number(right.rating || 0) - Number(left.rating || 0)
  }
  if (sortMode === 'name') {
    return String(left.name || '').localeCompare(String(right.name || ''))
  }
  if (sortMode === 'price') {
    return priceRank(left.price) - priceRank(right.price)
  }
  return Number(right.rating || 0) - Number(left.rating || 0)
})

const priceLabel = value => value || 'Price unknown'

const markerIcon = (place, selected, assets) => L.divIcon({
  className: `concept-marker-shell${selected ? ' is-selected' : ''}`,
  html: `
    <span class="concept-marker${place.isPick ? ' concept-marker--pick' : ''}">
      <img src="${place.isPick ? assets.pick : assets.standard}" alt="" />
    </span>
  `,
  iconSize: selected ? [48, 54] : [40, 46],
  iconAnchor: selected ? [24, 50] : [20, 43],
})

const clusterIcon = markerAsset => cluster => {
  const count = cluster.getChildCount()

  return L.divIcon({
    className: 'concept-cluster-shell',
    html: `
      <span class="concept-cluster">
        <img src="${markerAsset}" alt="" />
        <b>${count}</b>
      </span>
    `,
    iconSize: [48, 52],
    iconAnchor: [24, 48],
  })
}

function SelectionController({ place }) {
  const map = useMap()

  useEffect(() => {
    if (!place) return
    const zoom = Math.max(map.getZoom(), DEFAULT_ZOOM)
    map.flyTo([place.lat, place.lng], zoom, { animate: true, duration: 0.55 })
  }, [map, place])

  return null
}

function ViewportController({ onMove }) {
  const map = useMapEvents({
    dragend: () => onMove(map.getBounds()),
    zoomend: event => {
      if (event.originalEvent) onMove(map.getBounds())
    },
  })

  useEffect(() => {
    onMove(map.getBounds(), true)
  }, [map, onMove])

  return null
}

function MapActionControls({ onLocate, locateState, center, zoom }) {
  const map = useMap()

  return (
    <div className="concept-map-actions" aria-label="Map controls">
      <button
        type="button"
        title="Reset map"
        onClick={() => map.flyTo(center, zoom, { duration: 0.55 })}
      >
        <Crosshair size={18} aria-hidden="true" />
        <span className="sr-only">Reset map</span>
      </button>
      <button
        type="button"
        title="Use my location"
        onClick={onLocate}
        disabled={locateState === 'loading'}
      >
        <LocateFixed size={18} aria-hidden="true" />
        <span className="sr-only">Use my location</span>
      </button>
    </div>
  )
}

function ClusteredPlaces({ places, selectedPlace, onSelect, markerAssets }) {
  const map = useMap()

  const handleClusterClick = event => {
    const cluster = event?.layer
    if (!cluster?.getBounds) return
    const center = cluster.getBounds().getCenter()
    map.flyTo(center, Math.min(map.getZoom() + 1, 15), {
      animate: true,
      duration: 0.45,
    })
  }

  return (
    <MarkerClusterGroup
      chunkedLoading
      animate={false}
      maxClusterRadius={44}
      disableClusteringAtZoom={15}
      spiderfyOnMaxZoom={false}
      zoomToBoundsOnClick={false}
      showCoverageOnHover={false}
      iconCreateFunction={clusterIcon(markerAssets.standard)}
      onClick={handleClusterClick}
    >
      {places.map(place => (
        <Marker
          key={place.id}
          position={[place.lat, place.lng]}
          icon={markerIcon(place, selectedPlace?.id === place.id, markerAssets)}
          isPick={place.isPick}
          eventHandlers={{ click: () => onSelect(place) }}
          zIndexOffset={selectedPlace?.id === place.id ? 1000 : place.isPick ? 500 : 0}
        />
      ))}
    </MarkerClusterGroup>
  )
}

function ResultCard({ place, selected, onSelect, iconPath }) {
  return (
    <button
      id={`concept-result-${place.id}`}
      type="button"
      className={`concept-result${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(place)}
      aria-pressed={selected}
    >
      <span className="concept-result__media" aria-hidden="true">
        <img src={iconPath} alt="" />
      </span>
      <span className="concept-result__body">
        <span className="concept-result__heading">
          <strong>{place.name}</strong>
          {place.isPick ? (
            <span className="concept-pick-mark" title="Anthony's Pick">
              <Star size={13} fill="currentColor" aria-hidden="true" />
              Pick
            </span>
          ) : null}
        </span>
        <span className="concept-result__meta">
          <b>{Number(place.rating).toFixed(1)}</b>
          <span>{place.style}</span>
          <span>{priceLabel(place.price)}</span>
        </span>
        <span className="concept-result__address">{place.address}</span>
      </span>
      <ArrowUpRight className="concept-result__arrow" size={17} aria-hidden="true" />
    </button>
  )
}

function PlaceSheet({ place, onClose, entityLabel }) {
  if (!place) return null
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lng}`)}`

  return (
    <aside className="concept-place-sheet" aria-label={`Selected place: ${place.name}`}>
      <button className="concept-place-sheet__close" type="button" onClick={onClose} aria-label="Close place details">
        <X size={17} aria-hidden="true" />
      </button>
      <div className="concept-place-sheet__identity">
        <span className="concept-place-sheet__eyebrow">
          {place.isPick ? "Anthony's Pick" : `Anthony reviewed ${entityLabel}`}
        </span>
        <h2>{place.name}</h2>
        <p>{place.address}</p>
      </div>
      <div className="concept-place-sheet__score">
        <strong>{Number(place.rating).toFixed(1)}</strong>
        <span>out of 10</span>
      </div>
      <div className="concept-place-sheet__tags" aria-label="Place attributes">
        <span>{place.style}</span>
        <span>{priceLabel(place.price)}</span>
      </div>
      {place.review ? <blockquote>{place.review}</blockquote> : null}
      <div className="concept-place-sheet__actions">
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="concept-button concept-button--primary">
          <MapPin size={17} aria-hidden="true" />
          Directions
        </a>
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="concept-button">
          Google Maps
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
    </aside>
  )
}

export default function DiscoveryConceptPage({ entity = 'pizza' }) {
  const isPizza = entity !== 'taco'
  const places = isPizza ? conceptPlaces : conceptTacoPlaces
  const entityLabel = isPizza ? 'pizza' : 'taco'
  const pluralLabel = isPizza ? 'pizza places' : 'taco places'
  const placeIcon = isPizza ? '/pizza-icon.svg' : '/taco-icon.svg'
  const markerAssets = isPizza
    ? { standard: pizzaMarker, pick: pizzaMarkerGold }
    : { standard: tacoMarker, pick: tacoMarkerGold }
  const mapCenter = isPizza ? ANN_ARBOR_CENTER : DETROIT_CENTER
  const mapZoom = isPizza ? DEFAULT_ZOOM : 9
  const homeRoute = isPizza ? '/concept' : '/concept/tacos'
  const siblingRoute = isPizza ? '/concept/tacos' : '/concept'
  const suggestRoute = isPizza ? '/suggest' : '/tacos/suggest'
  const locationLabel = isPizza ? 'Ann Arbor, Michigan' : 'Metro Detroit, Michigan'
  const directoryHeading = isPizza ? 'Pizza worth knowing' : 'Tacos worth knowing'
  const [contentMode, setContentMode] = useState('map')
  const [query, setQuery] = useState('')
  const [selectedStyle, setSelectedStyle] = useState('All styles')
  const [selectedPrice, setSelectedPrice] = useState('Any price')
  const [picksOnly, setPicksOnly] = useState(false)
  const [sortMode, setSortMode] = useState('recommended')
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [mapMoved, setMapMoved] = useState(false)
  const [visibleBounds, setVisibleBounds] = useState(null)
  const [appliedBounds, setAppliedBounds] = useState(null)
  const [locateState, setLocateState] = useState('idle')
  const [themeMode, setThemeMode] = useState('standard')

  useEffect(() => {
    document.title = isPizza ? 'A Pizza Michigan' : 'TacoBoutMichigan'
  }, [isPizza])

  const mapScopedPlaces = useMemo(
    () => places.filter(place => !appliedBounds || appliedBounds.contains([place.lat, place.lng])),
    [appliedBounds, places]
  )

  const styles = useMemo(
    () => ['All styles', ...new Set(mapScopedPlaces.map(place => place.style).filter(Boolean))],
    [mapScopedPlaces]
  )

  const filteredPlaces = useMemo(() => sortConceptPlaces(mapScopedPlaces.filter(place => {
    if (!matchesConceptSearch(place, query)) return false
    if (selectedStyle !== 'All styles' && place.style !== selectedStyle) return false
    if (selectedPrice !== 'Any price' && place.price !== selectedPrice) return false
    if (picksOnly && !place.isPick) return false
    return true
  }), sortMode), [mapScopedPlaces, picksOnly, query, selectedPrice, selectedStyle, sortMode])

  useEffect(() => {
    if (!selectedPlace || selectedPlace.id === 'current-location') return
    if (filteredPlaces.some(place => place.id === selectedPlace.id)) return
    setSelectedPlace(filteredPlaces[0] || null)
  }, [filteredPlaces, selectedPlace])

  const selectFromMap = place => {
    setSelectedPlace(place)
    window.requestAnimationFrame(() => {
      document.getElementById(`concept-result-${place.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  }

  const clearFilters = () => {
    setSelectedStyle('All styles')
    setSelectedPrice('Any price')
    setPicksOnly(false)
    setAppliedBounds(null)
    setMapMoved(false)
  }

  const handleViewportMove = useCallback((bounds, initial = false) => {
    setVisibleBounds(bounds)
    if (initial) {
      setAppliedBounds(current => current || bounds)
    } else {
      setMapMoved(true)
    }
  }, [])

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocateState('error')
      return
    }
    setLocateState('loading')
    navigator.geolocation.getCurrentPosition(
      position => {
        setSelectedPlace({
          id: 'current-location',
          name: 'Your location',
          address: 'Searching nearby',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          rating: 0,
          style: 'Nearby',
          price: '',
          isPick: false,
        })
        setLocateState('ready')
      },
      () => setLocateState('error'),
      { enableHighAccuracy: false, timeout: 8000 }
    )
  }

  const activeFilterCount = (
    (selectedStyle !== 'All styles' ? 1 : 0) +
    (selectedPrice !== 'Any price' ? 1 : 0) +
    (picksOnly ? 1 : 0)
  )

  const isSignatureTheme = themeMode === 'signature'
  const mapTileUrl = isPizza
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  return (
    <div className={`discovery-concept discovery-concept--${entityLabel}${isSignatureTheme ? ' is-signature-theme' : ''}`}>
      <header className="concept-topbar">
        <div className="concept-mode-switch" aria-label="Content">
          <button
            type="button"
            className={contentMode === 'map' ? 'is-active' : ''}
            onClick={() => setContentMode('map')}
          >
            {isPizza ? 'Pizza Map' : 'Taco Map'}
          </button>
          {isPizza ? (
            <button
              type="button"
              className={contentMode === 'frozen' ? 'is-active' : ''}
              onClick={() => setContentMode('frozen')}
            >
              Frozen Pizzas
            </button>
          ) : null}
        </div>
        <a className="concept-brand" href={homeRoute} aria-label={`${isPizza ? 'A Pizza Michigan' : 'TacoBoutMichigan'} home`}>
          <strong className="concept-brand__gradient">
            <span>{isPizza ? 'A Pizza' : 'TacoBout'}</span> Michigan
          </strong>
          <small>by Anthony Wohlfeil</small>
        </a>
        <div className="concept-topbar-actions">
          <button
            type="button"
            className="concept-theme-toggle"
            aria-pressed={isSignatureTheme}
            onClick={() => setThemeMode(value => value === 'standard' ? 'signature' : 'standard')}
            title={isSignatureTheme ? 'Use standard theme' : `Use ${isPizza ? 'retro diner' : 'taquería'} theme`}
          >
            <Palette size={16} aria-hidden="true" />
            <span>{isSignatureTheme ? 'Standard' : isPizza ? 'Diner mode' : 'Taquería mode'}</span>
          </button>
          <a className="concept-taco-link" href={siblingRoute}>
            <img src={isPizza ? '/taco-icon.svg' : '/pizza-icon.svg'} alt="" />
            <span>{isPizza ? <>TacoBout<wbr />Michigan</> : <>A Pizza <wbr />Michigan</>}</span>
          </a>
          <a className="concept-suggest-link" href={suggestRoute}>
            Suggest a place
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </header>

      {isPizza && contentMode === 'frozen' ? (
        <main className="concept-frozen-workspace">
          <FrozenPizzaDirectory
            filters={EMPTY_FROZEN_FILTERS}
            theme={pizzaTheme}
            themeKey={ThemeKeys.PIZZA}
          />
        </main>
      ) : (
      <main className="concept-workspace">
        <section className="concept-results-panel" aria-label={`${isPizza ? 'Pizza' : 'Taco'} search results`}>
          <div className="concept-results-panel__header">
            <label className="concept-search">
              <Search size={19} aria-hidden="true" />
              <span className="sr-only">Search {pluralLabel}</span>
              <input
                type="search"
                placeholder="Search by place, style, or neighborhood"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </label>

            <div className="concept-filter-row">
              <button
                type="button"
                className={`concept-filter-trigger${filtersOpen ? ' is-active' : ''}`}
                onClick={() => setFiltersOpen(open => !open)}
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                Filters
                {activeFilterCount ? <span>{activeFilterCount}</span> : null}
              </button>
              <button
                type="button"
                className={`concept-quick-filter${picksOnly ? ' is-active' : ''}`}
                onClick={() => setPicksOnly(value => !value)}
                aria-pressed={picksOnly}
              >
                <Star size={15} fill={picksOnly ? 'currentColor' : 'none'} aria-hidden="true" />
                Anthony&apos;s Picks
              </button>
              <div className="concept-sort-control">
                <button
                  type="button"
                  className={`concept-sort-trigger${sortOpen ? ' is-active' : ''}`}
                  onClick={() => setSortOpen(open => !open)}
                  aria-expanded={sortOpen}
                  aria-haspopup="menu"
                >
                  <ArrowDownUp size={15} aria-hidden="true" />
                  Sort
                </button>
                {sortOpen ? (
                  <div className="concept-sort-menu" role="menu" aria-label="Sort places">
                    {SORT_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sortMode === option.value}
                        className={sortMode === option.value ? 'is-selected' : ''}
                        onClick={() => {
                          setSortMode(option.value)
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

            {filtersOpen ? (
              <div className="concept-filter-drawer">
                <div className="concept-filter-drawer__heading">
                  <strong>Refine results</strong>
                  {activeFilterCount ? <button type="button" onClick={clearFilters}>Clear all</button> : null}
                </div>
                <label>
                  <span>Style</span>
                  <select value={selectedStyle} onChange={event => setSelectedStyle(event.target.value)}>
                    {styles.map(style => <option key={style}>{style}</option>)}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </label>
                <label>
                  <span>Price</span>
                  <select value={selectedPrice} onChange={event => setSelectedPrice(event.target.value)}>
                    {['Any price', '$', '$$', '$$$', '$$$$'].map(price => <option key={price}>{price}</option>)}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </label>
              </div>
            ) : null}
          </div>

          <div className="concept-results-summary">
            <div>
              <span className="concept-results-summary__eyebrow">{locationLabel}</span>
              <h1>{directoryHeading}</h1>
            </div>
            <span>{filteredPlaces.length} places</span>
            <StatsPanel table={isPizza ? 'pizza_places' : 'taco_places'} states={CONCEPT_STATES} variant="compact" />
          </div>

          <div className="concept-results-list" aria-live="polite">
            {filteredPlaces.length ? filteredPlaces.map(place => (
              <ResultCard
                key={place.id}
                place={place}
                selected={selectedPlace?.id === place.id}
                onSelect={setSelectedPlace}
                iconPath={placeIcon}
              />
            )) : (
              <div className="concept-empty-state">
                <ListFilter size={24} aria-hidden="true" />
                <strong>No places match those filters</strong>
                <button type="button" onClick={clearFilters}>Reset filters</button>
              </div>
            )}
          </div>
        </section>

        <section className="concept-map-region" aria-label={`Map of ${pluralLabel}`}>
          <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            minZoom={4}
            maxZoom={18}
            zoomControl={false}
            className="concept-map"
          >
            <TileLayer
              url={mapTileUrl}
              attribution="&copy; OpenStreetMap &copy; CARTO"
            />
            <ViewportController onMove={handleViewportMove} />
            <SelectionController place={selectedPlace} />
            <MapActionControls
              onLocate={useCurrentLocation}
              locateState={locateState}
              center={mapCenter}
              zoom={mapZoom}
            />
            <ClusteredPlaces
              places={filteredPlaces}
              selectedPlace={selectedPlace}
              onSelect={selectFromMap}
              markerAssets={markerAssets}
            />
          </MapContainer>

          {mapMoved && visibleBounds ? (
            <button
              type="button"
              className="concept-search-area"
              onClick={() => {
                setAppliedBounds(visibleBounds)
                setMapMoved(false)
              }}
            >
              <Search size={15} aria-hidden="true" />
              Search this area
            </button>
          ) : null}

          <div className="concept-map-legend" aria-label="Map legend">
            <span><img src={markerAssets.standard} alt="" /> Reviewed</span>
            <span><img src={markerAssets.pick} alt="" /> Anthony&apos;s Pick</span>
          </div>

          <PlaceSheet
            place={selectedPlace?.id === 'current-location' ? null : selectedPlace}
            onClose={() => setSelectedPlace(null)}
            entityLabel={entityLabel}
          />
        </section>
      </main>
      )}
    </div>
  )
}
