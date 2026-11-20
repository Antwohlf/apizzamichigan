import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import L from 'leaflet'
import { StateMarker } from './StateMarker'
import { signalMapNavigation } from './navigationIntent'

let mockMap
jest.mock('leaflet', () => jest.requireActual('leaflet/dist/leaflet-src'))
jest.mock('react-leaflet', () => ({ useMap: () => mockMap, Marker: ({ eventHandlers }) => <button onClick={eventHandlers.click}>Load state</button> }))
const places = [{ lat: 42.28, lng: -83.74 }, { lat: 42.4, lng: -83.6 }]

describe('state download camera ownership', () => {
  let container
  let resolvePlaces
  beforeEach(() => {
    container = document.createElement('div')
    mockMap = new L.Evented()
    Object.assign(mockMap, { getContainer: () => container, flyTo: jest.fn(), fitBounds: jest.fn() })
  })
  const start = async () => {
    const onStateClick = jest.fn(() => new Promise(resolve => { resolvePlaces = resolve }))
    const view = render(<StateMarker aggregate={{ stateCode: 'MI', count: 100, lat: 44, lng: -85 }} site="pizza" onStateClick={onStateClick} />)
    fireEvent.click(screen.getByText('Load state'))
    await Promise.resolve()
    return view
  }
  const finish = () => act(async () => resolvePlaces(places))

  test('refits after an uninterrupted state load even after the overview marker unmounts', async () => {
    const view = await start()
    mockMap.fire('movestart') // our own initial fly-to is not a user gesture
    view.unmount()
    await finish()
    expect(mockMap.fitBounds).toHaveBeenCalledTimes(1)
  })

  test.each(['touchstart', 'wheel', 'pointerdown'])('does not override a user %s while loading', async event => {
    await start()
    container.dispatchEvent(new Event(event))
    await finish()
    expect(mockMap.fitBounds).not.toHaveBeenCalled()
  })

  test('does not override a newer search or selection', async () => {
    await start()
    signalMapNavigation(mockMap)
    await finish()
    expect(mockMap.fitBounds).not.toHaveBeenCalled()
  })

  test('does not navigate after the map is destroyed', async () => {
    await start()
    mockMap.fire('unload')
    await finish()
    expect(mockMap.fitBounds).not.toHaveBeenCalled()
  })
})
