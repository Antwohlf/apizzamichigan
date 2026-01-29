// src/App.js
import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'

import Sidebar from './Sidebar'
import SuggestionForm from './SuggestionForm'
import AdminForm from './AdminForm'
import FrozenPizzaDirectory from './FrozenPizzaDirectory'
import AdminSubmit from './AdminSubmit'
import AdminReviewsPage from './admin/AdminReviewsPage'
import { SiteTitle } from './header/SiteTitle'
import { StatsPanel } from './sidebar/StatsPanel'
import { MapPopupProvider, useMapPopup } from './map/useMapPopup'
import TacoRecipesPanel from './tacos/TacoRecipesPanel'
import DataDashboard from './pages/DataDashboard'

import { ThemeProvider, useTheme } from './themes/ThemeProvider'
import { DEFAULT_THEME_KEY, ThemeKeys } from './themes/siteTheme'
import { supabase } from './supabaseClient'
import pizzaPlacesFallback from './data'
import { trackSiteSwitch } from './analytics'
import { tacoPlacesFallback } from './data/tacoPlaces'
import { STATE_CENTROIDS, HOME_STATE } from './data/stateCentroids'
import { getDistanceMiles } from './utils/geo'
import './App.css'
import { GlobalLoadingProvider, useGlobalLoading } from './hooks/useGlobalLoading'
import { SelectedPlaceProvider } from './store/selectedPlace'
import { BugReportFab } from './components/bug-report/BugReportFab'
import { MapControls } from './map/MapControls'

// Helper to fetch places for a specific state
async function fetchPlacesForState(table, stateCode) {
  const pageSize = 1000
  let allData = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('state', stateCode)
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allData = allData.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return allData
}

// Helper to fetch state counts for aggregate markers
async function fetchStateCounts(table) {
  const pageSize = 1000
  let allData = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('state')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allData = allData.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  const counts = {}
  allData.forEach(row => {
    const state = row.state || 'Unknown'
    counts[state] = (counts[state] || 0) + 1
  })

  return counts
}

const MapView = lazy(() => import('./map'))

const PLACE_TABLE_BY_THEME = {
  [ThemeKeys.PIZZA]: 'pizza_places',
  [ThemeKeys.TACO]: 'taco_places',
}

const REVIEW_PHOTO_BUCKET = 'review-photos'
const REVIEW_PHOTO_TABLE = 'review-photos'
let reviewPhotosTableAvailable = true

const DEFAULT_STATUSES = ['visited', 'unvisited', 'golden']
const FAVORITE_FLAG_FIELDS = ['favorited', 'is_favorited', 'isFavorite', 'is_favorite', 'favorite']
const VALID_PLACE_TYPES = new Set(['pizzeria', 'taqueria', 'tamaleria'])
const PLACE_TYPE_FIELDS = ['place_type', 'placeType', 'place_category', 'placeCategory']
const MARKER_ICON_FIELDS = ['marker_icon_url', 'markerIconUrl', 'icon_url', 'iconUrl']

const normalizeStatus = (status) => {
  if (typeof status === 'string') {
    const lower = status.toLowerCase()
    if (DEFAULT_STATUSES.includes(lower)) {
      return lower
    }
  }
  return 'visited'
}

const convertLegacyPhotos = photos =>
  Array.isArray(photos)
    ? photos
        .filter(Boolean)
        .map((url, index) => ({
          id: `${url}-${index}`,
          path: url,
          publicUrl: url,
          sortOrder: index + 1,
        }))
    : []

async function fetchPhotoMap(placeIds = []) {
  if (!reviewPhotosTableAvailable) {
    return {}
  }
  if (!Array.isArray(placeIds) || placeIds.length === 0) {
    return {}
  }

  try {
    const { data, error } = await supabase
      .from(REVIEW_PHOTO_TABLE)
      .select('id, place_id, storage_path, sort_order')
      .in('place_id', placeIds)
      .order('sort_order', { ascending: true })

    if (error) throw error

    const storage = supabase.storage?.from?.(REVIEW_PHOTO_BUCKET)
    return (data || []).reduce((acc, photo) => {
      let publicUrl = null
      if (storage) {
        const { data: publicData, error: publicError } = storage.getPublicUrl(photo.storage_path)
        if (publicError) {
          console.warn('[photos] failed to compute public URL', publicError)
        } else {
          publicUrl = publicData?.publicUrl ?? null
        }
      }

      const mapped = {
        id: photo.id,
        path: photo.storage_path,
        sortOrder: photo.sort_order,
        publicUrl,
      }

      if (!acc[photo.place_id]) {
        acc[photo.place_id] = [mapped]
      } else {
        acc[photo.place_id].push(mapped)
      }
      return acc
    }, {})
  } catch (err) {
    if (err?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      return {}
    }
    console.warn('[photos] review photo fetch error', err)
    return {}
  }
}

const parseBoolean = value => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    return ['true', '1', 'yes', 'y'].includes(normalized)
  }
  return null
}

const computeFavorited = (place = {}, normalizedStatus = 'visited') => {
  for (const field of FAVORITE_FLAG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(place, field)) {
      const parsed = parseBoolean(place[field])
      if (parsed !== null) return parsed
    }
  }
  return normalizedStatus === 'golden'
}

const computePlaceType = (place = {}, fallback) => {
  for (const field of PLACE_TYPE_FIELDS) {
    const value = place[field]
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().toLowerCase()
      if (VALID_PLACE_TYPES.has(normalized)) {
        return normalized
      }
    }
  }
  return fallback
}

const computeMarkerIconUrl = (place = {}) => {
  for (const field of MARKER_ICON_FIELDS) {
    const value = place[field]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function SiteContainer({ themeKey }) {
  const [filters, setFilters] = useState({ styles: [], prices: [], statuses: [] })
  const [view, setView] = useState('map')
  const [places, setPlaces] = useState([])
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState(null)
  const [showClusterCounts, setShowClusterCounts] = useState(true)

  // Search and Near Me state
  const [searchQuery, setSearchQuery] = useState('')
  const [userLocation, setUserLocation] = useState(null)
  const [nearMeActive, setNearMeActive] = useState(false)
  const [nearMeRadius, setNearMeRadius] = useState(25)
  const [locationError, setLocationError] = useState(null)
  const [flyToLocation, setFlyToLocation] = useState(null)

  // State-based loading state
  const [stateAggregates, setStateAggregates] = useState([])
  const [loadedStates, setLoadedStates] = useState({ [HOME_STATE]: [] })
  const loadingStatesRef = React.useRef(new Set())

  const { theme } = useTheme()
  const isPizza = themeKey === ThemeKeys.PIZZA
  const { open: openMapPopup } = useMapPopup()
  const { open: openLoading, close: closeLoading, setVariant: setLoadingVariant } = useGlobalLoading()

  const handleFilterChange = useCallback(next => setFilters(next), [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const statusParam = params.get('status')
    if (statusParam) {
      const next = statusParam
        .split(',')
        .map(v => v.trim())
        .filter(v => DEFAULT_STATUSES.includes(v))
      if (next.length) {
        setFilters(prev => ({ ...prev, statuses: next }))
      }
    }
  }, [])

  useEffect(() => {
    document.body.style.backgroundColor = theme.palette.bg
    document.body.style.color = theme.palette.text
  }, [theme])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const currentStatuses = filters.statuses || []
    if (currentStatuses.length && currentStatuses.length !== DEFAULT_STATUSES.length) {
      params.set('status', currentStatuses.join(','))
    } else {
      params.delete('status')
    }
    const next = params.toString()
    const newUrl = next ? `${window.location.pathname}?${next}` : window.location.pathname
    window.history.replaceState({}, '', newUrl)
  }, [filters.statuses])

  useEffect(() => {
    const pageTitle = isPizza
      ? 'APizzaMichigan - Best Michigan Pizza Map'
      : 'TacoBoutMichigan - Best Michigan Taco Map'
    const description = isPizza
      ? 'Discover Michigan\'s best pizza joints with live filters, maps, and crowd-sourced intel.'
      : 'Track down Michigan\'s top tacos with the same interactive map experience, now in festive colors.'

    document.title = pageTitle

    const setFavicon = (href) => {
      if (typeof document === 'undefined') return
      let link = document.querySelector("link[rel='icon']")
      if (!link) {
        link = document.createElement('link')
        link.setAttribute('rel', 'icon')
        document.head.appendChild(link)
      }
      link.setAttribute('href', href)
    }

    const upsertMeta = (attr, key, value) => {
      if (!value) return
      let meta = document.querySelector(`meta[${attr}="${key}"]`)
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute(attr, key)
        document.head.appendChild(meta)
      }
      meta.setAttribute('content', value)
    }

    upsertMeta('name', 'description', description)
    upsertMeta('property', 'og:title', pageTitle)
    upsertMeta('property', 'og:description', description)
    setFavicon(isPizza ? '/favicon-pizza.svg' : '/favicon-taco.svg')
  }, [isPizza, themeKey, theme.brandName])

  useEffect(() => {
    setLoadingVariant(isPizza ? 'pizza' : 'taco')
  }, [isPizza, setLoadingVariant])

  // Normalize place data (extracted for reuse)
  const normalizePlaceData = useCallback((data, photoMap, defaultPlaceType) => {
    return (data || []).map((place, index) => {
      const canonicalId =
        place.id ??
        place.ID ??
        place.place_id ??
        place.slug ??
        `${themeKey === ThemeKeys.TACO ? 'taco' : 'pizza'}-${index}`
      const normalizedPhotos = (() => {
        const fromMap = Array.isArray(photoMap[place.id]) ? photoMap[place.id] : []
        const fallback = convertLegacyPhotos(place.photos)
        const combined = fromMap.length > 0 ? fromMap : fallback
        return combined
          .slice()
          .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))
      })()
      const firstPhoto = normalizedPhotos.length
        ? normalizedPhotos[0]?.publicUrl || normalizedPhotos[0]?.path || normalizedPhotos[0]
        : place.photo_url || place.photoPath || null

      const normalizedLat = typeof place.lat === 'number' ? place.lat : Number(place.lat)
      const normalizedLng = typeof place.lng === 'number' ? place.lng : Number(place.lng)

      const normalizedStatus = normalizeStatus(place.status)
      const favorited = computeFavorited(place, normalizedStatus)
      const placeType = computePlaceType(place, defaultPlaceType)
      const markerIconUrl = computeMarkerIconUrl(place)

      return {
        ...place,
        id: canonicalId,
        type: themeKey === ThemeKeys.TACO ? 'taco' : 'pizza',
        style:
          themeKey === ThemeKeys.TACO
            ? place.type || place.style
            : place.style === 'Standard'
              ? 'Traditional'
              : place.style,
        price: place.price || place.Price || '',
        status: normalizedStatus,
        favorited,
        lat: normalizedLat,
        lng: normalizedLng,
        address: place.address || place.Address || '',
        photoUrl: typeof firstPhoto === 'string' ? firstPhoto : null,
        photos: normalizedPhotos,
        place_type: placeType,
        placeType,
        marker_icon_url: markerIconUrl,
        markerIconUrl,
      }
    })
  }, [themeKey])

  // Initial load: Michigan places + state counts for aggregates
  useEffect(() => {
    let isMounted = true
    const defaultPlaceType = isPizza ? 'pizzeria' : 'taqueria'

    async function initialLoad() {
      setMapLoading(true)
      openLoading(theme.copy.loading || 'Loading map…')
      const fallbackPlaces = themeKey === ThemeKeys.TACO ? tacoPlacesFallback : pizzaPlacesFallback
      const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]

      try {
        // Fetch Michigan places and state counts in parallel
        const [michiganData, stateCounts] = await Promise.all([
          fetchPlacesForState(table, HOME_STATE),
          fetchStateCounts(table),
        ])

        if (!isMounted) return

        // Fetch photos for Michigan places
        let photoMap = {}
        if (michiganData.length) {
          const placeIds = michiganData.map(p => p.id).filter(Boolean)
          if (placeIds.length) {
            photoMap = await fetchPhotoMap(placeIds)
          }
        }

        if (!isMounted) return

        // Normalize Michigan places
        const normalized = normalizePlaceData(michiganData, photoMap, defaultPlaceType)

        // Build state aggregates for non-Michigan states
        const aggregates = []
        Object.entries(stateCounts).forEach(([stateCode, count]) => {
          if (stateCode === HOME_STATE || stateCode === 'Unknown' || !STATE_CENTROIDS[stateCode]) return
          const centroid = STATE_CENTROIDS[stateCode]
          aggregates.push({
            id: `state-${stateCode}`,
            stateCode,
            stateName: centroid.name,
            count,
            lat: centroid.lat,
            lng: centroid.lng,
            isAggregate: true,
          })
        })

        setPlaces(normalized)
        setLoadedStates({ [HOME_STATE]: normalized })
        setStateAggregates(aggregates)
        setMapError(null)
      } catch (error) {
        if (!isMounted) return

        // Fallback to local data
        const normalizedFallback = (fallbackPlaces || []).map((place, index) => {
          const canonicalId =
            place.id ??
            place.ID ??
            place.place_id ??
            place.slug ??
            `${themeKey === ThemeKeys.TACO ? 'taco' : 'pizza'}-fallback-${index}`
          const photos = convertLegacyPhotos(place?.photos)
          const primaryPhoto = photos.length ? (typeof photos[0] === 'string' ? photos[0] : photos[0]?.publicUrl || photos[0]?.path) : null
          const normalizedStatus = normalizeStatus(place?.status)
          const favorited = computeFavorited(place, normalizedStatus)
          const placeType = computePlaceType(place, defaultPlaceType)
          const markerIconUrl = computeMarkerIconUrl(place)
          return {
            ...place,
            id: canonicalId,
            type: themeKey === ThemeKeys.TACO ? 'taco' : 'pizza',
            status: normalizedStatus,
            favorited,
            lat: typeof place.lat === 'number' ? place.lat : Number(place.lat),
            lng: typeof place.lng === 'number' ? place.lng : Number(place.lng),
            address: place.address || place.Address || '',
            photoUrl: primaryPhoto || null,
            photos,
            place_type: placeType,
            placeType,
            marker_icon_url: markerIconUrl,
            markerIconUrl,
          }
        })
        setPlaces(normalizedFallback)
        setMapError(error)
      }

      if (isMounted) {
        setMapLoading(false)
        closeLoading()
      }
    }

    initialLoad()
    return () => {
      isMounted = false
      closeLoading()
    }
  }, [themeKey, theme.copy.loading, openLoading, closeLoading, isPizza, normalizePlaceData])

  // Load additional state when clicked
  const handleStateClick = useCallback(async (stateCode) => {
    if (!stateCode || stateCode === HOME_STATE || loadingStatesRef.current.has(stateCode)) {
      return
    }

    // Already loaded - just add to active
    if (loadedStates[stateCode]) {
      setPlaces(prev => [...prev, ...loadedStates[stateCode]])
      // Remove from aggregates
      setStateAggregates(prev => prev.filter(a => a.stateCode !== stateCode))
      return
    }

    loadingStatesRef.current.add(stateCode)
    const defaultPlaceType = isPizza ? 'pizzeria' : 'taqueria'
    const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]

    try {
      const stateData = await fetchPlacesForState(table, stateCode)

      // Fetch photos
      let photoMap = {}
      if (stateData.length) {
        const placeIds = stateData.map(p => p.id).filter(Boolean)
        if (placeIds.length) {
          photoMap = await fetchPhotoMap(placeIds)
        }
      }

      const normalized = normalizePlaceData(stateData, photoMap, defaultPlaceType)

      // Update state
      setLoadedStates(prev => ({ ...prev, [stateCode]: normalized }))
      setPlaces(prev => [...prev, ...normalized])
      // Remove from aggregates
      setStateAggregates(prev => prev.filter(a => a.stateCode !== stateCode))
    } catch (err) {
      console.error(`[App] Failed to load state ${stateCode}:`, err)
    } finally {
      loadingStatesRef.current.delete(stateCode)
    }
  }, [loadedStates, isPizza, themeKey, normalizePlaceData])

  // Handle Near Me toggle
  const handleNearMeToggle = useCallback(() => {
    if (nearMeActive) {
      setNearMeActive(false)
      setFlyToLocation(null)
      return
    }

    if (userLocation) {
      setNearMeActive(true)
      setFlyToLocation(userLocation)
      return
    }

    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }
        setUserLocation(loc)
        setNearMeActive(true)
        setFlyToLocation(loc)
        setLocationError(null)
      },
      () => {
        setLocationError('Location access denied')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [nearMeActive, userLocation])

  const filteredPlaces = useMemo(() => {
    const statusSet = new Set(filters.statuses && filters.statuses.length ? filters.statuses : DEFAULT_STATUSES)
    const searchLower = searchQuery.toLowerCase().trim()

    let results = places.filter(place => {
      // Search filter
      if (searchLower && !place.name?.toLowerCase().includes(searchLower)) {
        return false
      }

      // Near me filter
      if (nearMeActive && userLocation) {
        const distance = getDistanceMiles(userLocation.lat, userLocation.lng, place.lat, place.lng)
        if (distance > nearMeRadius) return false
        place._distance = distance
      }

      // Style, price, status filters
      const placeStatus = place.status || 'visited'
      return (
        (filters.styles.length === 0 || filters.styles.includes(place.style)) &&
        (filters.prices.length === 0 || filters.prices.includes(place.price)) &&
        statusSet.has(placeStatus)
      )
    })

    // Sort by distance when near me is active
    if (nearMeActive && userLocation) {
      results = results.slice().sort((a, b) => (a._distance || 0) - (b._distance || 0))
    }

    return results
  }, [places, filters, searchQuery, nearMeActive, userLocation, nearMeRadius])

  // Check if any filter is active
  const hasActiveFilter = useMemo(() => {
    return (
      filters.styles?.length > 0 ||
      filters.prices?.length > 0 ||
      (filters.statuses?.length > 0 && filters.statuses.length < 3) ||
      searchQuery.trim().length > 0 ||
      nearMeActive
    )
  }, [filters, searchQuery, nearMeActive])

  // Recalculate state counts based on filtered places
  const filteredStateAggregates = useMemo(() => {
    if (!stateAggregates.length) return stateAggregates

    // If no filters active, show original counts
    if (!hasActiveFilter) return stateAggregates

    // Count filtered places by state (excluding home state)
    const filteredCounts = {}
    filteredPlaces.forEach(place => {
      const state = place.state || 'Unknown'
      if (state !== HOME_STATE && state !== 'Unknown') {
        filteredCounts[state] = (filteredCounts[state] || 0) + 1
      }
    })

    // Update counts for states that have loaded places
    // Hide states with 0 filtered results
    return stateAggregates
      .map(agg => ({
        ...agg,
        count: filteredCounts[agg.stateCode] ?? 0,
      }))
      .filter(agg => agg.count > 0)
  }, [stateAggregates, filteredPlaces, hasActiveFilter])

  const themeStyles = useMemo(
    () => ({
      '--app-bg': theme.palette.bg,
      '--app-card': theme.palette.card,
      '--app-text': theme.palette.text,
      '--app-text-muted': theme.palette.mutedText,
      '--app-border': theme.palette.border,
      '--app-accent': theme.palette.accent,
      '--app-accent-muted': theme.palette.accentMuted,
      '--title-color-1': theme.titleRotation[0] || theme.palette.accent,
      '--title-color-2': theme.titleRotation[1] || theme.palette.text,
      '--title-color-3': theme.titleRotation[2] || theme.palette.accentMuted,
    }),
    [theme]
  )

  const nextThemeKey = isPizza ? ThemeKeys.TACO : ThemeKeys.PIZZA
  const switchTarget = isPizza ? '/tacos' : '/'
  const switchLabel = isPizza
    ? 'Check out TacoBoutMichigan'
    : 'Check out APizzaMichigan'

  const handleLocatePlace = useCallback(
    details => {
      if (!details) return
      setView('map')
      const lat = typeof details.lat === 'number' ? details.lat : null
      const lng = typeof details.lng === 'number' ? details.lng : null
      if (lat !== null && lng !== null) {
        // nothing additional; map layer will pan when popup opens
      }
      const targetType = details.entity === 'taco' ? 'taco' : 'pizza'
      const id = details.id || details.place_id || null
      if (id) {
        openMapPopup(targetType, id)
      }
    },
    [openMapPopup]
  )

  // Handle clicking a place in the results list
  const handlePlaceClick = useCallback(
    (place) => {
      if (!place) return
      setView('map')
      const targetType = isPizza ? 'pizza' : 'taco'
      if (place.id) {
        openMapPopup(targetType, place.id)
      }
    },
    [isPizza, openMapPopup]
  )

  const handleSiteSwitch = () => {
    trackSiteSwitch(themeKey, nextThemeKey)
  }

  return (
    <div className="app-shell" style={themeStyles}>
      <div className="app-layout">
        <div className="sidebar-wrapper">
          <Sidebar
            onFilterChange={handleFilterChange}
            themeKey={themeKey}
            filters={filters}
            showClusterCounts={showClusterCounts}
            onClusterCountsToggle={setShowClusterCounts}
          />
        </div>

        <div className="main-content">
          <SiteTitle title={theme.brandName} />

          <div className="view-toggle">
            {['map', 'frozen'].map(mode => {
              const isActive = view === mode
              const label = mode === 'map' ? theme.copy.frozenToggleMap : theme.copy.frozenToggleFrozen
              return (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className={isActive ? 'toggle-button active' : 'toggle-button'}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div
            className="map-or-directory"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '600px' }}
          >
            {view === 'map' ? (
              mapLoading ? (
                <div className="map-status" data-status="loading">
                  {theme.copy.loading}
                </div>
              ) : mapError ? (
                <div className="map-status" data-status="error">
                  {theme.copy.errorPrefix}: {mapError.message}
                </div>
              ) : (
                <div className="map-container-wrapper">
                  <MapControls
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    nearMeActive={nearMeActive}
                    nearMeRadius={nearMeRadius}
                    locationError={locationError}
                    onNearMeToggle={handleNearMeToggle}
                    onRadiusChange={setNearMeRadius}
                    filteredPlaces={filteredPlaces}
                    onPlaceClick={handlePlaceClick}
                  />
                  <Suspense fallback={<div className="map-status" data-status="loading">{theme.copy.loading}</div>}>
                    <MapView
                      key={isPizza ? 'pizza-map' : 'taco-map'}
                      places={filteredPlaces}
                      theme={theme}
                      site={isPizza ? 'pizza' : 'taco'}
                      showClusterCounts={showClusterCounts}
                      stateAggregates={filteredStateAggregates}
                      onStateClick={handleStateClick}
                      flyToLocation={flyToLocation}
                    />
                  </Suspense>
                </div>
              )
            ) : (
              themeKey === ThemeKeys.TACO ? (
                <TacoRecipesPanel />
              ) : (
                <FrozenPizzaDirectory filters={filters} theme={theme} themeKey={themeKey} />
              )
            )}
          </div>

          <footer className="site-footer">
            <Link to={switchTarget} className="cta-switch" onClick={handleSiteSwitch}>
              {switchLabel}
            </Link>
          </footer>
        </div>

        <div className="sidebar-wrapper">
          <div className="sidebar-inner sidebar-inner--sticky">
            <StatsPanel table={isPizza ? 'pizza_places' : 'taco_places'} />
            <SuggestionForm
              key={themeKey}
              theme={theme}
              isPizza={isPizza}
              onLocatePlace={handleLocatePlace}
            />
            <BugReportFab />
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemedRoute({ themeKey }) {
  return (
    <ThemeProvider themeKey={themeKey}>
      <MapPopupProvider>
        <SiteContainer themeKey={themeKey} />
      </MapPopupProvider>
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <SelectedPlaceProvider>
      <GlobalLoadingProvider>
        <Router>
          <Routes>
            <Route path="/" element={<ThemedRoute themeKey={ThemeKeys.PIZZA} />} />
            <Route path="/tacos" element={<ThemedRoute themeKey={ThemeKeys.TACO} />} />
            <Route path="/data" element={<DataDashboard />} />
            <Route path="/admin/submit" element={<AdminSubmit />} />
            <Route path="/admin/reviews" element={<AdminReviewsPage />} />
            <Route
              path="/admin"
              element={
                <div className="admin-shell">
                  <AdminForm />
                </div>
              }
            />
          </Routes>
        </Router>
      </GlobalLoadingProvider>
    </SelectedPlaceProvider>
  )
}
