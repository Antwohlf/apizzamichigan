import { FOCUSED_PLACE_ZOOM, lightboxRestoreViewport, focusedPlaceZoom } from './viewport'

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
