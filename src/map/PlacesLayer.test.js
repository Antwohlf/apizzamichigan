import { focusedPlaceZoom } from './viewport'

describe('focusedPlaceZoom', () => {
  test('preserves zoom when an expanded popup opens for a visible marker', () => {
    expect(focusedPlaceZoom({
      currentZoom: 11,
      maxZoom: 18,
      isOutsideView: false,
      preserveZoomIfVisible: true,
    })).toBe(11)
  })

  test('focuses off-screen selections at detail zoom', () => {
    expect(focusedPlaceZoom({
      currentZoom: 11,
      maxZoom: 18,
      isOutsideView: true,
      preserveZoomIfVisible: true,
    })).toBe(11)
  })

  test('zooms in from state-level context for off-screen selections', () => {
    expect(focusedPlaceZoom({
      currentZoom: 6,
      maxZoom: 18,
      isOutsideView: true,
      preserveZoomIfVisible: true,
    })).toBe(15)
  })

  test('focuses zoomed-out selections enough to show the place', () => {
    expect(focusedPlaceZoom({
      currentZoom: 5,
      maxZoom: 18,
      isOutsideView: false,
      preserveZoomIfVisible: true,
    })).toBe(15)
  })
})
