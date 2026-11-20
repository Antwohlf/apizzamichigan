import React from 'react'
import { act, render } from '@testing-library/react'
import L from 'leaflet/dist/leaflet-src'
import { MapSizeController } from '../map'
import { PlacesLayer } from './PlacesLayer'

const mockPopup = { hide: jest.fn() }
const mockPopupState = { openEntry: {}, open: jest.fn(), close: jest.fn(), registerFocusReturn: jest.fn() }
const mockSelectedPlace = { setSelectedPlace: jest.fn() }
let mockMap

jest.mock('leaflet', () => jest.requireActual('leaflet/dist/leaflet-src'))
jest.mock('react-leaflet', () => ({ useMap: () => mockMap, useMapEvents: () => mockMap, Marker: () => null }))
jest.mock('react-leaflet-cluster', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('./useMapPopup', () => ({ useMapPopup: () => mockPopupState }))
jest.mock('../context/PopupProvider', () => ({ usePopup: () => mockPopup }))
jest.mock('../store/selectedPlace', () => ({ useSelectedPlace: () => mockSelectedPlace }))
jest.mock('./StateMarker', () => ({ StateAggregateLayer: () => null }))
jest.mock('../components/map/renderPopup', () => ({ renderExpanded: jest.fn(), renderPreview: jest.fn() }))

describe('search navigation after a map mounts behind the Places panel', () => {
  let container
  let dimensions
  let observer
  const originalResizeObserver = global.ResizeObserver
  const firstPlace = { id: 'first', lat: 42.28, lng: -83.74, name: 'First place' }
  const nearbyPlace = { id: 'nearby', lat: 42.32, lng: -83.71, name: 'Nearby place' }
  const showMap = places => (
    <>
      <MapSizeController />
      <PlacesLayer site="pizza" places={places} searchFocusKey={places.length ? 'buddy:results' : ''} />
    </>
  )
  const advance = milliseconds => act(() => jest.advanceTimersByTime(milliseconds))

  beforeEach(() => {
    jest.useFakeTimers()
    global.ResizeObserver = jest.fn(callback => {
      observer = { notify: callback, observe: jest.fn(), disconnect: jest.fn() }
      return observer
    })
    dimensions = { width: 0, height: 0 }
    container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { get: () => dimensions.width },
      clientHeight: { get: () => dimensions.height },
    })
    document.body.appendChild(container)
    mockMap = L.map(container, { trackResize: false, zoomAnimation: false, fadeAnimation: false, minZoom: 0, maxZoom: 19 })
      .setView([44.31, -85.60], 6)
    jest.spyOn(mockMap, 'fitBounds')
    jest.spyOn(mockMap, 'flyTo')
  })

  afterEach(() => {
    mockMap.remove()
    container.remove()
    jest.clearAllTimers()
    jest.restoreAllMocks()
    jest.useRealTimers()
    global.ResizeObserver = originalResizeObserver
  })

  test.each([
    ['compact results', [firstPlace, nearbyPlace], 'fitBounds'],
    ['one place', [firstPlace], 'flyTo'],
    ['distant results', [firstPlace, { id: 'distant', lat: 40.73, lng: -74.0 }], 'flyTo'],
  ])('defers %s until the actual map has nonzero dimensions', (_label, places, method) => {
    const { rerender } = render(showMap([]))
    advance(20)
    rerender(showMap(places))
    advance(300)
    expect(mockMap.fitBounds).not.toHaveBeenCalled()
    expect(mockMap.flyTo).not.toHaveBeenCalled()
    expect(Number.isFinite(mockMap.getZoom())).toBe(true)

    dimensions = { width: 390, height: 560 }
    observer.notify()
    advance(20)
    expect(mockMap[method]).toHaveBeenCalledTimes(1)
    expect(Number.isFinite(mockMap.getCenter().lat)).toBe(true)
    expect(Number.isFinite(mockMap.getCenter().lng)).toBe(true)
    expect(Number.isFinite(mockMap.getZoom())).toBe(true)
    expect(mockMap.getBounds().isValid()).toBe(true)
  })

  test('keeps fitting padding smaller than a viewport reduced by the keyboard', () => {
    render(showMap([firstPlace, nearbyPlace]))
    advance(20)
    dimensions = { width: 100, height: 80 }
    observer.notify()
    advance(20)
    expect(mockMap.fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ padding: [25, 20] }))
    expect(Number.isFinite(mockMap.getZoom())).toBe(true)
    expect(mockMap.getBounds().isValid()).toBe(true)
  })
})
