export const DEFAULT_MAP_ZOOM = 6
export const MIN_INDIVIDUAL_MARKERS_ZOOM = 7
export const CITY_CONTEXT_ZOOM = 10
export const FOCUSED_PLACE_ZOOM = 15

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
    if (currentZoom >= CITY_CONTEXT_ZOOM) {
      return currentZoom
    }
  }
  return Math.min(FOCUSED_PLACE_ZOOM, maxZoom || FOCUSED_PLACE_ZOOM)
}
