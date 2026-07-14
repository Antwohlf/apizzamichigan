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
import DataDashboard from './pages/DataDashboard'

import { ThemeProvider, useTheme } from './themes/ThemeProvider'
import { DEFAULT_THEME_KEY, ThemeKeys } from './themes/siteTheme'
import { supabase } from './supabaseClient'
import { trackSiteSwitch } from './analytics'
import { STATE_CENTROIDS } from './data/stateCentroids'
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

// Helper to fetch state counts for aggregate markers, with optional filtering/progressive updates
async function fetchStateCounts(table, {
  includeStates,
  includeStatuses,
  caseInsensitiveStatuses = false,
  splitEuropeByCountry = false,
  requireRating = false,
  onProgress,
  progressEveryPages = 1,
} = {}) {
  const pageSize = 1000
  const counts = {}
  let offset = 0
  let page = 0

  while (true) {
    let query = supabase
      .from(table)
      .select(splitEuropeByCountry ? 'state,address' : 'state')
      .range(offset, offset + pageSize - 1)

    if (Array.isArray(includeStates) && includeStates.length > 0) {
      query = query.in('state', includeStates)
    }
    if (Array.isArray(includeStatuses) && includeStatuses.length > 0) {
      if (caseInsensitiveStatuses) {
        const statusOr = includeStatuses
          .map(status => `status.ilike.${String(status).trim().toLowerCase()}*`)
          .join(',')
        query = query.or(statusOr)
      } else {
        query = query.in('status', includeStatuses)
      }
    }
    if (requireRating) {
      query = query.not('rating', 'is', null)
    }

    const { data, error } = await query

    if (error) throw error
    if (!data || data.length === 0) break

    data.forEach(row => {
      const regionKey = resolveRegionKey(row, splitEuropeByCountry)
      counts[regionKey] = (counts[regionKey] || 0) + 1
    })

    page += 1
    if (typeof onProgress === 'function' && page % progressEveryPages === 0) {
      onProgress({ ...counts })
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  if (typeof onProgress === 'function') {
    onProgress({ ...counts })
  }

  return counts
}

const MapView = lazy(() => import('./map'))

const PLACE_TABLE_BY_THEME = {
  [ThemeKeys.PIZZA]: 'pizza_places',
  [ThemeKeys.TACO]: 'taco_places',
}
const PRIORITY_INITIAL_STATES = ['MI', 'WI', 'IN', 'OH', 'IL']
const REGION_COUNTS_CACHE = new Map()
const ANTHONY_COUNTS_CACHE = new Map()

const REVIEW_PHOTO_BUCKET = 'review-photos'
const REVIEW_PHOTO_TABLE = 'review-photos'
let reviewPhotosTableAvailable = true

const DEFAULT_STATUSES = ['visited', 'unvisited', 'golden']
const FAVORITE_FLAG_FIELDS = ['favorited', 'is_favorited', 'isFavorite', 'is_favorite', 'favorite']
const VALID_PLACE_TYPES = new Set(['pizzeria', 'taqueria', 'tamaleria'])
const PLACE_TYPE_FIELDS = ['place_type', 'placeType', 'place_category', 'placeCategory']
const MARKER_ICON_FIELDS = ['marker_icon_url', 'markerIconUrl', 'icon_url', 'iconUrl']
const normalizeRegionCode = value => (typeof value === 'string' ? value.trim().toUpperCase() : '')
const EUROPE_COUNTRY_BY_ADDRESS_NAME = {
  SPAIN: 'EU_ES',
  ITALY: 'EU_IT',
  NETHERLANDS: 'EU_NL',
  CZECHIA: 'EU_CZ',
  'CZECH REPUBLIC': 'EU_CZ',
}

const resolveRegionKey = ({ state, address }, splitEuropeByCountry = false) => {
  const normalizedState = normalizeRegionCode(state)
  if (!normalizedState) return 'Unknown'
  if (!splitEuropeByCountry || normalizedState !== 'EU') return normalizedState

  const addressParts = typeof address === 'string'
    ? address.split(',').map(part => part.trim()).filter(Boolean)
    : []
  const countryName = addressParts.length
    ? addressParts[addressParts.length - 1].toUpperCase()
    : ''

  return EUROPE_COUNTRY_BY_ADDRESS_NAME[countryName] || 'EU'
}

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
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState(null)
  const [showClusterCounts, setShowClusterCounts] = useState(true)
  const [showAnthonysVisits, setShowAnthonysVisits] = useState(false)
  const [anthonysCountsByState, setAnthonysCountsByState] = useState({})

  // Search and Near Me state
  const [searchQuery, setSearchQuery] = useState('')
  const [userLocation, setUserLocation] = useState(null)
  const [nearMeActive, setNearMeActive] = useState(false)
  const [nearMeRadius, setNearMeRadius] = useState(25)
  const [locationError, setLocationError] = useState(null)
  const [flyToLocation, setFlyToLocation] = useState(null)

  // Three-state region model: UNLOADED -> LOADING -> LOADED
  // Shape: { [stateCode]: { status: 'unloaded'|'loading'|'loaded', places: [], originalCount } }
  const [regionStates, setRegionStates] = useState({})
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
      const normalizedPrice = place.price || place.Price || ''
      const normalizedPriceRange = place.price_range || place.priceRange || normalizedPrice

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
        price: normalizedPrice,
        price_range: normalizedPriceRange,
        priceRange: normalizedPriceRange,
        status: normalizedStatus,
        statusRaw: typeof place.status === 'string' ? place.status.trim().toLowerCase() : null,
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

  // Initial load: prioritize Michigan + nearby states, then progressively hydrate the rest
  useEffect(() => {
    let isMounted = true
    const buildRegionStatesFromCounts = (counts, existing = {}) => {
      const next = { ...existing }
      Object.entries(counts).forEach(([stateCode, count]) => {
        if (stateCode === 'Unknown' || !STATE_CENTROIDS[stateCode]) return
        const prevRegion = next[stateCode]
        next[stateCode] = prevRegion
          ? { ...prevRegion, originalCount: count }
          : { status: 'unloaded', originalCount: count, places: [] }
      })
      return next
    }

    async function initialLoad() {
      setMapLoading(true)
      openLoading(theme.copy.loading || 'Loading map…')
      const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]

      try {
        const cachedRegionCounts = REGION_COUNTS_CACHE.get(table)
        const cachedAnthonyCounts = ANTHONY_COUNTS_CACHE.get(table)

        if (cachedAnthonyCounts) {
          setAnthonysCountsByState(cachedAnthonyCounts)
        } else {
          setAnthonysCountsByState({})
        }

        if (cachedRegionCounts) {
          setRegionStates(buildRegionStatesFromCounts(cachedRegionCounts))
          setMapError(null)
          setMapLoading(false)
          closeLoading()
        } else {
          const [priorityCounts, priorityAnthonyCounts] = await Promise.all([
            fetchStateCounts(table, { includeStates: PRIORITY_INITIAL_STATES }),
            cachedAnthonyCounts
              ? Promise.resolve(cachedAnthonyCounts)
              : fetchStateCounts(table, {
                includeStates: PRIORITY_INITIAL_STATES,
                includeStatuses: ['visited', 'golden'],
                splitEuropeByCountry: true,
                requireRating: true,
              }),
          ])
          if (!isMounted) return

          setRegionStates(buildRegionStatesFromCounts(priorityCounts))
          if (!cachedAnthonyCounts) {
            setAnthonysCountsByState(priorityAnthonyCounts)
          }
          setMapError(null)
          setMapLoading(false)
          closeLoading()
        }

        // Non-blocking background hydration for the rest of the map
        fetchStateCounts(table, {
          onProgress: (allCounts) => {
            if (!isMounted) return
            REGION_COUNTS_CACHE.set(table, allCounts)
            setRegionStates(prev => buildRegionStatesFromCounts(allCounts, prev))
          },
          progressEveryPages: 3,
        }).catch(error => {
          if (!isMounted) return
          console.warn('[App] Background region hydration failed:', error)
        })

        fetchStateCounts(table, {
          includeStatuses: ['visited', 'golden'],
          splitEuropeByCountry: true,
          requireRating: true,
          onProgress: (counts) => {
            if (!isMounted) return
            ANTHONY_COUNTS_CACHE.set(table, counts)
            setAnthonysCountsByState(counts)
          },
          progressEveryPages: 1,
        }).catch(error => {
          if (!isMounted) return
          console.warn('[App] Background Anthony counts hydration failed:', error)
        })
      } catch (error) {
        if (!isMounted) return
        console.error('[App] Failed to load region counts:', error)
        setMapError(error)
        setMapLoading(false)
        closeLoading()
      }
    }

    initialLoad()
    return () => {
      isMounted = false
      closeLoading()
    }
  }, [themeKey, theme.copy.loading, openLoading, closeLoading])

  // Load places for a region when clicked or zoomed into
  const handleStateClick = useCallback(async (stateCode) => {
    if (!stateCode || loadingStatesRef.current.has(stateCode)) {
      return
    }

    const loadKey = stateCode.startsWith('EU_') ? 'EU' : stateCode
    const region = regionStates[loadKey]
    // Only load if unloaded (not loading or already loaded)
    if (!region || region.status !== 'unloaded') {
      return
    }

    // Mark as loading (aggregate stays visible with spinner)
    setRegionStates(prev => ({
      ...prev,
      [loadKey]: { ...prev[loadKey], status: 'loading' }
    }))
    loadingStatesRef.current.add(loadKey)

    const defaultPlaceType = isPizza ? 'pizzeria' : 'taqueria'
    const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]

    try {
      const stateData = await fetchPlacesForState(table, loadKey)

      // Fetch photos
      let photoMap = {}
      if (stateData.length) {
        const placeIds = stateData.map(p => p.id).filter(Boolean)
        if (placeIds.length) {
          photoMap = await fetchPhotoMap(placeIds)
        }
      }

      const normalized = normalizePlaceData(stateData, photoMap, defaultPlaceType)

      // Mark as loaded (aggregate hides, markers show)
      setRegionStates(prev => ({
        ...prev,
        [loadKey]: { ...prev[loadKey], status: 'loaded', places: normalized }
      }))
    } catch (err) {
      // Revert to unloaded on error (aggregate stays visible)
      setRegionStates(prev => ({
        ...prev,
        [loadKey]: { ...prev[loadKey], status: 'unloaded' }
      }))
      console.error(`[App] Failed to load region ${loadKey}:`, err)
    } finally {
      loadingStatesRef.current.delete(loadKey)
    }
  }, [regionStates, isPizza, themeKey, normalizePlaceData])

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

  // Derive all loaded places from regionStates
  const allLoadedPlaces = useMemo(() => {
    return Object.values(regionStates)
      .filter(r => r.status === 'loaded')
      .flatMap(r => r.places)
  }, [regionStates])

  const effectiveStatusSet = useMemo(
    () => (
      showAnthonysVisits
        ? new Set(['visited', 'golden'])
        : new Set(filters.statuses && filters.statuses.length ? filters.statuses : DEFAULT_STATUSES)
    ),
    [filters.statuses, showAnthonysVisits]
  )

  const filteredPlaces = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim()

    let results = allLoadedPlaces.filter(place => {
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
      const isExplicitAnthonyVisit =
        typeof place.statusRaw === 'string' &&
        (place.statusRaw.startsWith('visited') || place.statusRaw.startsWith('golden')) &&
        typeof place.rating === 'number' &&
        !Number.isNaN(place.rating)
      return (
        (filters.styles.length === 0 || filters.styles.includes(place.style)) &&
        (filters.prices.length === 0 || filters.prices.includes(place.price_range || place.price)) &&
        (showAnthonysVisits ? isExplicitAnthonyVisit : effectiveStatusSet.has(placeStatus))
      )
    })

    // Sort by distance when near me is active
    if (nearMeActive && userLocation) {
      results = results.slice().sort((a, b) => (a._distance || 0) - (b._distance || 0))
    }

    return results
  }, [allLoadedPlaces, filters, searchQuery, nearMeActive, userLocation, nearMeRadius, effectiveStatusSet, showAnthonysVisits])

  const shouldDimUnloadedAggregates = useMemo(() => {
    return (
      filters.styles?.length > 0 ||
      filters.prices?.length > 0 ||
      (filters.statuses?.length > 0 && filters.statuses.length < 3) ||
      searchQuery.trim().length > 0 ||
      nearMeActive
    )
  }, [filters, searchQuery, nearMeActive])

  const filteredCountByState = useMemo(() => {
    return filteredPlaces.reduce((acc, place) => {
      const stateCode = showAnthonysVisits
        ? resolveRegionKey({ state: place.state, address: place.address }, true)
        : normalizeRegionCode(place.state)
      if (stateCode) {
        acc[stateCode] = (acc[stateCode] || 0) + 1
      }
      return acc
    }, {})
  }, [filteredPlaces, showAnthonysVisits])

  const filteredDisplayAggregates = useMemo(() => {
    const baseAggregates = Object.entries(regionStates)
      .map(([stateCode, region]) => {
        const centroid = STATE_CENTROIDS[stateCode]
        if (!centroid) return null

        const isLoaded = region.status === 'loaded'
        const anthonyCount = isLoaded
          ? (filteredCountByState[stateCode] || 0)
          : (anthonysCountsByState[stateCode] || 0)
        const count = showAnthonysVisits
          ? anthonyCount
          : (isLoaded ? (filteredCountByState[stateCode] || 0) : region.originalCount)
        return {
          id: `state-${stateCode}`,
          stateCode,
          stateName: centroid.name,
          country: centroid.country || 'US',
          regionStatus: region.status,
          count,
          lat: centroid.lat,
          lng: centroid.lng,
          isLoading: region.status === 'loading',
          isDimmed: !showAnthonysVisits && !isLoaded && shouldDimUnloadedAggregates,
          isHighlighted: showAnthonysVisits && count > 0,
        }
      })
      .filter(Boolean)
    if (!showAnthonysVisits) {
      return baseAggregates
    }

    const euBase = baseAggregates.find(agg => agg.stateCode === 'EU')
    const euCountryAggregates = Object.entries(anthonysCountsByState)
      .filter(([code, count]) => code.startsWith('EU_') && count > 0 && STATE_CENTROIDS[code])
      .map(([code, count]) => {
        const centroid = STATE_CENTROIDS[code]
        return {
          id: `state-${code}`,
          stateCode: code,
          stateName: centroid.name,
          country: centroid.country || 'EU',
          regionStatus: euBase?.regionStatus || 'unloaded',
          count,
          lat: centroid.lat,
          lng: centroid.lng,
          isLoading: Boolean(euBase?.isLoading),
          isDimmed: false,
          isHighlighted: true,
        }
      })

    return [
      ...baseAggregates.filter(agg => agg.stateCode !== 'EU' && agg.count > 0),
      ...euCountryAggregates,
    ]
  }, [regionStates, filteredCountByState, anthonysCountsByState, showAnthonysVisits, shouldDimUnloadedAggregates])

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
            showAnthonysVisits={showAnthonysVisits}
            onAnthonysVisitsToggle={setShowAnthonysVisits}
          />
        </div>

        <div className="main-content">
          <SiteTitle title={theme.brandName} />

          <div className="view-toggle">
            {['map', 'frozen'].map(mode => {
              const isActive = view === mode
              const isTacoComingSoonTab = !isPizza && mode === 'frozen'
              const label = mode === 'map'
                ? theme.copy.frozenToggleMap
                : (isTacoComingSoonTab ? 'Coming Soon' : theme.copy.frozenToggleFrozen)
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
                      stateAggregates={filteredDisplayAggregates}
                      onStateClick={handleStateClick}
                      flyToLocation={flyToLocation}
                      resetKey={`${themeKey}-${filters.styles.join(',')}-${filters.prices.join(',')}-${filters.statuses.join(',')}-${showAnthonysVisits ? 'anthony-visits' : 'all-statuses'}`}
                    />
                  </Suspense>
                </div>
              )
            ) : (
              themeKey === ThemeKeys.TACO ? (
                <div className="map-status" data-status="loading">
                  Taco recipes are coming soon.
                </div>
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
