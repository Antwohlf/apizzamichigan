import L from 'leaflet'
import { createPlaceMarkerManager, MARKER_BATCH_SIZE } from './ManagedPlaceMarkers'

jest.mock('leaflet', () => jest.requireActual('leaflet/dist/leaflet-src'))

describe('bounded persistent place markers', () => {
  let map
  let container
  let manager
  let markerRefs
  let createMarker
  let iconCreateFunction
  const places = Array.from({ length: 205 }, (_, index) => ({
    id: String(index), lat: 42.28 + index / 10000, lng: -83.74, name: `Place ${index}`, status: 'unvisited',
  }))
  const update = (rows = places, overrides = {}) => manager.update({
    places: rows, visible: true, forceIndividualMarkers: false, iconCreateFunction, ...overrides,
  })

  beforeEach(() => {
    jest.useFakeTimers()
    container = document.createElement('div')
    Object.defineProperties(container, { clientWidth: { value: 390 }, clientHeight: { value: 650 } })
    document.body.appendChild(container)
    map = L.map(container, { zoomAnimation: false, maxZoom: 19 }).setView([42.28, -83.74], 13)
    markerRefs = { current: new Map() }
    createMarker = jest.fn((place, key, icon) => L.marker([place.lat, place.lng], {
      icon, place, status: place.status, title: place.name,
    }))
    iconCreateFunction = () => L.divIcon({ html: 'cluster' })
    manager = createPlaceMarkerManager({ map, site: 'pizza', markerRefs, createMarker, iconCreateFunction, onClusterClick: jest.fn() })
  })

  afterEach(() => {
    manager.destroy()
    map.remove()
    container.remove()
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('yields between bounded bulk insertions and prunes offscreen markers', () => {
    const add = jest.spyOn(manager.clusters, 'addLayers')
    update()
    expect(createMarker).not.toHaveBeenCalled()
    jest.advanceTimersByTime(0)
    expect(createMarker).toHaveBeenCalledTimes(MARKER_BATCH_SIZE)
    jest.advanceTimersByTime(100)
    expect(createMarker).toHaveBeenCalledTimes(205)
    expect(add.mock.calls.every(([batch]) => batch.length <= MARKER_BATCH_SIZE)).toBe(true)
    expect(manager.clusters.options.removeOutsideVisibleBounds).toBe(true)
    map.setView([0, 0], 16)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0)
  })

  test('unchanged data does not move, re-icon, or reinsert existing markers', () => {
    update()
    jest.advanceTimersByTime(100)
    const first = markerRefs.current.get('pizza:0')
    const move = jest.spyOn(first, 'setLatLng')
    const icon = jest.spyOn(first, 'setIcon')
    const add = jest.spyOn(manager.clusters, 'addLayers')
    update(places.map(place => ({ ...place })))
    jest.advanceTimersByTime(100)
    expect(createMarker).toHaveBeenCalledTimes(205)
    expect(move).not.toHaveBeenCalled()
    expect(icon).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  test('overview hides the layer while retaining the cluster index and marker instances', () => {
    update()
    jest.advanceTimersByTime(100)
    const first = markerRefs.current.get('pizza:0')
    const tree = manager.clusters._topClusterLevel
    update(places, { visible: false })
    expect(map.hasLayer(manager.clusters)).toBe(false)
    update()
    jest.advanceTimersByTime(100)
    expect(map.hasLayer(manager.clusters)).toBe(true)
    expect(markerRefs.current.get('pizza:0')).toBe(first)
    expect(manager.clusters._topClusterLevel).toBe(tree)
    expect(createMarker).toHaveBeenCalledTimes(205)
  })

  test('a newer result set cancels unfinished insertions and replaces stale markers', () => {
    update()
    jest.advanceTimersByTime(0)
    update([places[0]], { forceIndividualMarkers: true })
    jest.advanceTimersByTime(200)
    expect([...markerRefs.current.keys()]).toEqual(['pizza:0'])
    expect(createMarker).toHaveBeenCalledTimes(MARKER_BATCH_SIZE)
    expect(manager.clusters.getLayers()).toHaveLength(0)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1)
  })

  test('destroy cancels queued marker work', () => {
    update()
    manager.destroy()
    jest.advanceTimersByTime(200)
    expect(createMarker).not.toHaveBeenCalled()
    expect(markerRefs.current.size).toBe(0)
  })
})
