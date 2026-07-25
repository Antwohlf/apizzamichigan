import { FOCUSED_PLACE_ZOOM, SEARCH_RESULT_FOCUS_ZOOM, STABLE_CLUSTER_RADIUS, captureLightboxViewport, lightboxRestoreViewport, focusedPlaceZoom, isPlaceViewportFocused, clusterFitOptions, clusterNavigation, clusterRadiusForZoom, searchFitOptions, searchNavigation, shouldForceIndividualMarkers } from './viewport'

describe('cluster navigation', () => {
  test('keeps cluster radius stable across zoom levels', () => {
    expect(clusterRadiusForZoom(7)).toBe(STABLE_CLUSTER_RADIUS)
    expect(clusterRadiusForZoom(10)).toBe(STABLE_CLUSTER_RADIUS)
    expect(clusterRadiusForZoom(13)).toBe(STABLE_CLUSTER_RADIUS)
    expect(clusterRadiusForZoom(14)).toBe(STABLE_CLUSTER_RADIUS)
    expect(clusterRadiusForZoom('not-a-zoom')).toBe(STABLE_CLUSTER_RADIUS)
  })

  test('keeps cluster expansion bounded to neighborhood context', () => {
    expect(clusterFitOptions()).toEqual({
      padding: [48, 48],
      maxZoom: 14,
      animate: true,
      duration: 0.6,
    })
  })

  test('steps inward instead of fitting a wide geographic cluster', () => {
    expect(clusterNavigation({
      latitudeSpan: 4.2,
      longitudeSpan: 6.1,
      currentZoom: 7,
      maxZoom: 14,
    })).toEqual({ mode: 'step', zoom: 9 })
  })

  test('fits ordinary neighborhood clusters', () => {
    expect(clusterNavigation({
      latitudeSpan: 0.08,
      longitudeSpan: 0.12,
      currentZoom: 11,
      maxZoom: 14,
    })).toEqual({ mode: 'fit' })
  })
})

describe('search navigation', () => {
  test('keeps multi-result searches in useful neighborhood context', () => {
    expect(searchFitOptions()).toEqual({
      padding: [72, 72],
      maxZoom: 12,
      animate: true,
      duration: 0.7,
    })
  })

  test('keeps broad multi-market searches on the best result', () => {
    const places = [
      { id: 'first', lat: 42.28, lng: -83.74 },
      { id: 'second', lat: 40.73, lng: -74.0 },
    ]
    expect(searchNavigation(places)).toEqual({
      mode: 'place',
      place: places[0],
      zoom: SEARCH_RESULT_FOCUS_ZOOM,
    })
  })

  test('fits results that belong to one compact area', () => {
    const places = [
      { id: 'first', lat: 42.28, lng: -83.74 },
      { id: 'second', lat: 42.31, lng: -83.72 },
    ]
    expect(searchNavigation(places)).toEqual({ mode: 'fit', places })
  })

  test('fits dense results that still belong to one compact area', () => {
    const places = Array.from({ length: 51 }, (_, index) => ({
      id: String(index),
      lat: 42.28 + (index * 0.001),
      lng: -83.74 + (index * 0.001),
    }))
    expect(searchNavigation(places)).toEqual({ mode: 'fit', places })
  })

  test('fits a metro-area search so all nearby results stay visible', () => {
    const places = [
      { id: 'first', lat: 40.70, lng: -74.02 },
      { id: 'second', lat: 40.98, lng: -73.62 },
    ]
    expect(searchNavigation(places)).toEqual({ mode: 'fit', places })
  })

  test('focuses the best result for a statewide or multi-market search', () => {
    const places = [
      { id: 'first', lat: 42.28, lng: -83.74 },
      { id: 'second', lat: 40.73, lng: -74.0 },
    ]
    expect(searchNavigation(places)).toEqual({
      mode: 'place',
      place: places[0],
      zoom: SEARCH_RESULT_FOCUS_ZOOM,
    })
  })
})

describe('focused marker density', () => {
  test('keeps small focused result sets unclustered', () => {
    expect(shouldForceIndividualMarkers({ searchActive: true, placeCount: 12 })).toBe(true)
    expect(shouldForceIndividualMarkers({ nearMeActive: true, placeCount: 40 })).toBe(true)
  })

  test('keeps broad focused result sets clustered', () => {
    expect(shouldForceIndividualMarkers({ searchActive: true, placeCount: 41 })).toBe(false)
    expect(shouldForceIndividualMarkers({ nearMeActive: true, placeCount: 200 })).toBe(false)
    expect(shouldForceIndividualMarkers({ searchActive: false, nearMeActive: false, placeCount: 1 })).toBe(false)
  })
})

describe('isPlaceViewportFocused', () => {
  const place = { lat: 40.734, lng: -74.003 }

  test('accepts a sufficiently zoomed viewport near the place', () => {
    expect(isPlaceViewportFocused({
      center: { lat: 40.8, lng: -74.05 },
      zoom: 11,
      place,
    })).toBe(true)
  })

  test('rejects a stale viewport in another region', () => {
    expect(isPlaceViewportFocused({
      center: { lat: 44.3, lng: -85.6 },
      zoom: 6,
      place,
    })).toBe(false)
  })

  test('rejects a nearby but state-level viewport', () => {
    expect(isPlaceViewportFocused({
      center: { lat: 40.8, lng: -74.05 },
      zoom: 6,
      place,
    })).toBe(false)
  })

  test('rejects a metro-distance place at neighborhood zoom', () => {
    expect(isPlaceViewportFocused({
      center: { lat: 40.95, lng: -74.05 },
      zoom: 11,
      place,
    })).toBe(false)
  })
})

describe('focusedPlaceZoom', () => {
  test('preserves zoom when an expanded popup opens for a visible marker', () => {
    expect(focusedPlaceZoom({
      currentZoom: 11,
      maxZoom: 18,
      isOutsideView: false,
      preserveZoomIfVisible: true,
    })).toBe(11)
  })

  test('focuses off-screen selections at neighborhood context from city view', () => {
    expect(focusedPlaceZoom({
      currentZoom: 11,
      maxZoom: 18,
      isOutsideView: true,
      preserveZoomIfVisible: true,
    })).toBe(13)
  })

  test('zooms in from state-level context for off-screen selections', () => {
    expect(focusedPlaceZoom({
      currentZoom: 6,
      maxZoom: 18,
      isOutsideView: true,
      preserveZoomIfVisible: true,
    })).toBe(13)
  })

  test('focuses zoomed-out selections enough to show the place', () => {
    expect(focusedPlaceZoom({
      currentZoom: 5,
      maxZoom: 18,
      isOutsideView: false,
      preserveZoomIfVisible: true,
    })).toBe(13)
  })
})

describe('lightboxRestoreViewport', () => {
  test('keeps a useful captured place viewport when closing the photo viewer', () => {
    expect(lightboxRestoreViewport({
      capturedViewport: { lat: 40.734, lng: -74.003, zoom: 12 },
      activePlace: { lat: 42.1, lng: -83.1 },
      maxDistanceFromActiveDegrees: 10,
    })).toEqual({ lat: 40.734, lng: -74.003, zoom: 12 })
  })

  test('returns to the active popup place when the captured viewport is too broad', () => {
    expect(lightboxRestoreViewport({
      capturedViewport: { lat: 44.3, lng: -85.6, zoom: 5 },
      activePlace: { lat: 40.734, lng: -74.003 },
    })).toEqual({ lat: 40.734, lng: -74.003, zoom: FOCUSED_PLACE_ZOOM })
  })

  test('returns to the active popup place when captured viewport is in another region', () => {
    expect(lightboxRestoreViewport({
      capturedViewport: { lat: 44.3, lng: -85.6, zoom: 10 },
      activePlace: { lat: 40.734, lng: -74.003 },
    })).toEqual({ lat: 40.734, lng: -74.003, zoom: FOCUSED_PLACE_ZOOM })
  })
})

describe('captureLightboxViewport', () => {
  test('uses the active place when lightbox opens before map focus finishes', () => {
    expect(captureLightboxViewport({
      capturedViewport: { lat: 44.3, lng: -85.6, zoom: 6 },
      activePlace: { lat: 40.734, lng: -74.003 },
    })).toEqual({ lat: 40.734, lng: -74.003, zoom: FOCUSED_PLACE_ZOOM })
  })

  test('preserves a settled viewport near the active place', () => {
    expect(captureLightboxViewport({
      capturedViewport: { lat: 40.8, lng: -74.05, zoom: 11 },
      activePlace: { lat: 40.734, lng: -74.003 },
    })).toEqual({ lat: 40.8, lng: -74.05, zoom: 11 })
  })
})
