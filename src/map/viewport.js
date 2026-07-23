export const DEFAULT_MAP_ZOOM = 6
export const MIN_INDIVIDUAL_MARKERS_ZOOM = 7
export const CITY_CONTEXT_ZOOM = 10
// Keep a selected place in useful neighborhood context. Detail zoom belongs
// to the photo viewer, not the map-selection transition.
export const FOCUSED_PLACE_ZOOM = 13
export const CLUSTER_FIT_MAX_ZOOM = 14

export const clusterFitOptions = () => ({
  padding: [48, 48],
  maxZoom: CLUSTER_FIT_MAX_ZOOM,
  animate: true,
  duration: 0.6,
})

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
  return Math.hypot(center.lat - place.lat, center.lng - place.lng) <= maxDistanceDegrees
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
