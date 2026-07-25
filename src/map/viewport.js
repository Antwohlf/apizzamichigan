export const DEFAULT_MAP_ZOOM = 6
export const MIN_INDIVIDUAL_MARKERS_ZOOM = 7
export const CITY_CONTEXT_ZOOM = 10
// Keep a selected place in useful neighborhood context. Detail zoom belongs
// to the photo viewer, not the map-selection transition.
export const FOCUSED_PLACE_ZOOM = 13
export const SEARCH_RESULT_FOCUS_ZOOM = 11
export const CLUSTER_FIT_MAX_ZOOM = 14
export const WIDE_CLUSTER_SPAN_DEGREES = 2
// A metro-area search should show the whole result set. The old 0.35-degree
// cutoff treated ordinary Detroit/Ann Arbor or NYC-area searches as broad and
// focused only the first-ranked place, making the rest hard to discover.
export const COMPACT_SEARCH_SPAN_DEGREES = 0.75
export const MAX_UNCLUSTERED_FOCUS_PLACES = 40

export function shouldForceIndividualMarkers({
  searchActive = false,
  nearMeActive = false,
  placeCount = 0,
  maxUnclustered = MAX_UNCLUSTERED_FOCUS_PLACES,
} = {}) {
  if (!searchActive && !nearMeActive) return false
  const count = Number(placeCount)
  const limit = Number(maxUnclustered)
  return Number.isFinite(count) && count > 0 && Number.isFinite(limit) && count <= limit
}

export const searchFitOptions = () => ({
  padding: [72, 72],
  maxZoom: 12,
  animate: true,
  duration: 0.7,
})

export function searchNavigation(places = []) {
  const validPlaces = (Array.isArray(places) ? places : []).filter(place => (
    place &&
    typeof place.lat === 'number' && Number.isFinite(place.lat) &&
    typeof place.lng === 'number' && Number.isFinite(place.lng)
  ))

  if (validPlaces.length <= 1) return { mode: 'place', place: validPlaces[0] || null }

  const latitudes = validPlaces.map(place => place.lat)
  const longitudes = validPlaces.map(place => place.lng)
  const latitudeSpan = Math.max(...latitudes) - Math.min(...latitudes)
  const longitudeSpan = Math.max(...longitudes) - Math.min(...longitudes)

  // Fit every result that belongs to one compact metro area. The marker layer
  // clusters dense results, so result count alone should not make the map
  // jump to an arbitrary first-ranked place. Only broad, multi-market
  // searches focus the best-ranked result.
  if (Math.max(latitudeSpan, longitudeSpan) > COMPACT_SEARCH_SPAN_DEGREES) {
    return { mode: 'place', place: validPlaces[0], zoom: SEARCH_RESULT_FOCUS_ZOOM }
  }

  return { mode: 'fit', places: validPlaces }
}

// Keep cluster membership predictable while the map moves. A fixed radius is
// less visually surprising than rebuilding clusters around several radius
// thresholds during a zoom gesture.
export const STABLE_CLUSTER_RADIUS = 56

export function clusterRadiusForZoom(zoom) {
  // Keep the helper as the single policy surface for callers and tests. The
  // argument is intentionally ignored so zooming cannot change membership.
  void zoom
  return STABLE_CLUSTER_RADIUS
}

export const clusterFitOptions = () => ({
  padding: [48, 48],
  maxZoom: CLUSTER_FIT_MAX_ZOOM,
  animate: true,
  duration: 0.6,
})

export function clusterNavigation({
  latitudeSpan = 0,
  longitudeSpan = 0,
  currentZoom = DEFAULT_MAP_ZOOM,
  maxZoom = CLUSTER_FIT_MAX_ZOOM,
} = {}) {
  const span = Math.max(Math.abs(latitudeSpan), Math.abs(longitudeSpan))
  if (span <= WIDE_CLUSTER_SPAN_DEGREES) return { mode: 'fit' }

  return {
    mode: 'step',
    zoom: Math.min(maxZoom, Math.max(DEFAULT_MAP_ZOOM, currentZoom) + 2),
  }
}

export function isPlaceViewportFocused({
  center = null,
  zoom = DEFAULT_MAP_ZOOM,
  place = null,
  minimumZoom = MIN_INDIVIDUAL_MARKERS_ZOOM,
  maxDistanceDegrees = 1.5,
} = {}) {
  const hasCenter = center && typeof center.lat === 'number' && typeof center.lng === 'number'
  const hasPlace = place && typeof place.lat === 'number' && typeof place.lng === 'number'
  if (!hasCenter || !hasPlace || typeof zoom !== 'number' || zoom < minimumZoom) return false
  // A degree-scale tolerance is useful at regional zoom, but far too broad
  // once the map is showing a city. Shrink the tolerance as the user zooms so
  // a selected place is only treated as focused when it is plausibly visible.
  const zoomSteps = Math.max(0, zoom - minimumZoom)
  const effectiveMaxDistance = maxDistanceDegrees / (2 ** zoomSteps)
  return Math.hypot(center.lat - place.lat, center.lng - place.lng) <= effectiveMaxDistance
}

export function focusedPlaceZoom({
  currentZoom = DEFAULT_MAP_ZOOM,
  maxZoom = FOCUSED_PLACE_ZOOM,
  isOutsideView = false,
  preserveZoomIfVisible = false,
} = {}) {
  if (preserveZoomIfVisible) {
    if (!isOutsideView && currentZoom >= MIN_INDIVIDUAL_MARKERS_ZOOM) {
      return currentZoom
    }
    if (!isOutsideView && currentZoom >= CITY_CONTEXT_ZOOM) {
      return currentZoom
    }
  }
  return Math.min(FOCUSED_PLACE_ZOOM, maxZoom || FOCUSED_PLACE_ZOOM)
}

export function lightboxRestoreViewport({
  capturedViewport = null,
  activePlace = null,
  minimumUsefulZoom = MIN_INDIVIDUAL_MARKERS_ZOOM,
  fallbackZoom = FOCUSED_PLACE_ZOOM,
  maxDistanceFromActiveDegrees = 2.5,
} = {}) {
  const hasActivePlace = activePlace && typeof activePlace.lat === 'number' && typeof activePlace.lng === 'number'
  const isNearActivePlace = capturedViewport && hasActivePlace
    ? Math.hypot(capturedViewport.lat - activePlace.lat, capturedViewport.lng - activePlace.lng) <= maxDistanceFromActiveDegrees
    : true

  if (
    capturedViewport &&
    typeof capturedViewport.lat === 'number' &&
    typeof capturedViewport.lng === 'number' &&
    typeof capturedViewport.zoom === 'number' &&
    capturedViewport.zoom >= minimumUsefulZoom &&
    isNearActivePlace
  ) {
    return capturedViewport
  }

  if (hasActivePlace) {
    return {
      lat: activePlace.lat,
      lng: activePlace.lng,
      zoom: fallbackZoom,
    }
  }

  return capturedViewport
}

export function captureLightboxViewport({
  capturedViewport = null,
  activePlace = null,
  minimumZoom = MIN_INDIVIDUAL_MARKERS_ZOOM,
  fallbackZoom = FOCUSED_PLACE_ZOOM,
  maxDistanceFromActiveDegrees = 2.5,
} = {}) {
  const hasActivePlace = activePlace && typeof activePlace.lat === 'number' && typeof activePlace.lng === 'number'
  if (!hasActivePlace) return capturedViewport

  const isNearActivePlace = capturedViewport && typeof capturedViewport.lat === 'number' && typeof capturedViewport.lng === 'number'
    ? Math.hypot(capturedViewport.lat - activePlace.lat, capturedViewport.lng - activePlace.lng) <= maxDistanceFromActiveDegrees
    : false

  if (isNearActivePlace && typeof capturedViewport.zoom === 'number' && capturedViewport.zoom >= minimumZoom) {
    return capturedViewport
  }

  return {
    lat: activePlace.lat,
    lng: activePlace.lng,
    zoom: fallbackZoom,
  }
}
