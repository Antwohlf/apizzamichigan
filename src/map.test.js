import React from 'react'
import { act, render } from '@testing-library/react'
// Exercise Leaflet's real size/center behavior instead of the shared lightweight mock.
import L from 'leaflet/dist/leaflet-src'
import { MapSizeController } from './map'

let mockMap

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => children,
  TileLayer: () => null,
  useMap: () => mockMap,
  useMapEvents: () => mockMap,
}))
jest.mock('./map/PlacesLayer', () => ({ PlacesLayer: () => null }))
jest.mock('./context/PopupProvider', () => ({ PopupProvider: ({ children }) => children }))

describe('mobile map dimensions', () => {
  let container
  let dimensions
  let observer
  let frames
  let frameId
  let invalidateSize
  const originalResizeObserver = global.ResizeObserver

  const flushFrame = () => {
    const callbacks = Array.from(frames.values())
    frames.clear()
    act(() => callbacks.forEach(callback => callback()))
  }

  const expectCenter = center => {
    // Leaflet rounds its projected center to pixels when recalculating the viewport.
    expect(mockMap.project(mockMap.getCenter()).distanceTo(mockMap.project(center))).toBeLessThanOrEqual(1)
  }

  beforeEach(() => {
    jest.useFakeTimers()
    frames = new Map()
    frameId = 0
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
    global.ResizeObserver = jest.fn(callback => {
      observer = { notify: callback, observe: jest.fn(), disconnect: jest.fn() }
      return observer
    })
    dimensions = { width: 390, height: 600 }
    container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { get: () => dimensions.width },
      clientHeight: { get: () => dimensions.height },
    })
    document.body.appendChild(container)
    mockMap = L.map(container, {
      trackResize: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([42.2808, -83.743], 13)
    invalidateSize = jest.spyOn(mockMap, 'invalidateSize')
  })

  afterEach(() => {
    mockMap.remove()
    container.remove()
    jest.runOnlyPendingTimers()
    jest.restoreAllMocks()
    jest.useRealTimers()
    global.ResizeObserver = originalResizeObserver
  })

  test('resizes with its parent while retaining the current center, zoom, and popup', () => {
    const popup = L.popup({ autoPan: false }).setLatLng(mockMap.getCenter()).setContent('Selected place').openOn(mockMap)
    const center = mockMap.getCenter()
    render(<MapSizeController />)
    flushFrame()
    expect(observer.observe).toHaveBeenCalledWith(container)

    dimensions = { width: 844, height: 250 }
    observer.notify()
    flushFrame()

    expect(mockMap.getSize()).toEqual(L.point(844, 250))
    expectCenter(center)
    expect(mockMap.getZoom()).toBe(13)
    expect(mockMap.hasLayer(popup)).toBe(true)
  })

  test('ignores a hidden map during rotation and repairs it when the map returns', () => {
    const center = mockMap.getCenter()
    render(<MapSizeController />)
    flushFrame()
    invalidateSize.mockClear()

    dimensions = { width: 0, height: 0 }
    observer.notify()
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('orientationchange'))
    flushFrame()
    expect(invalidateSize).not.toHaveBeenCalled()
    expect(mockMap.getSize()).toEqual(L.point(390, 600))
    expectCenter(center)

    dimensions = { width: 844, height: 250 }
    observer.notify()
    flushFrame()
    expect(invalidateSize).toHaveBeenCalledTimes(1)
    expect(mockMap.getSize()).toEqual(L.point(844, 250))
    expectCenter(center)
  })

  test('checks the map again after a hidden interval even when its dimensions are unchanged', () => {
    render(<MapSizeController />)
    flushFrame()
    invalidateSize.mockClear()

    dimensions = { width: 0, height: 0 }
    observer.notify()
    flushFrame()
    dimensions = { width: 390, height: 600 }
    observer.notify()
    flushFrame()
    expect(invalidateSize).toHaveBeenCalledTimes(1)
  })

  test('coalesces resize events and skips events that do not change the layout', () => {
    render(<MapSizeController />)
    flushFrame()
    invalidateSize.mockClear()

    observer.notify()
    window.dispatchEvent(new Event('resize'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(1)
    flushFrame()
    expect(invalidateSize).not.toHaveBeenCalled()

    dimensions = { width: 430, height: 600 }
    observer.notify()
    observer.notify()
    window.dispatchEvent(new Event('resize'))
    flushFrame()
    expect(invalidateSize).toHaveBeenCalledTimes(1)
  })

  test('uses window events when ResizeObserver is unavailable', () => {
    global.ResizeObserver = undefined
    render(<MapSizeController />)
    flushFrame()
    const center = mockMap.getCenter()

    dimensions = { width: 844, height: 250 }
    window.dispatchEvent(new Event('orientationchange'))
    flushFrame()
    expect(mockMap.getSize()).toEqual(L.point(844, 250))
    expectCenter(center)
  })

  test('disconnects and cancels pending work when the map unmounts', () => {
    const { unmount } = render(<MapSizeController />)
    expect(frames.size).toBe(1)
    unmount()

    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
    observer.notify()
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('orientationchange'))
    document.dispatchEvent(new Event('visibilitychange'))
    flushFrame()
    expect(frames.size).toBe(0)
    expect(invalidateSize).not.toHaveBeenCalled()
  })
})
