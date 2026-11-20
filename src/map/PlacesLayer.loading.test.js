import React from 'react'
import { act, render } from '@testing-library/react'
import { PlacesLayer } from './PlacesLayer'

const mockPopup = { hide: jest.fn() }
const mockPopupState = { openEntry: {}, open: jest.fn(), close: jest.fn(), registerFocusReturn: jest.fn() }
const mockSelectedPlace = { setSelectedPlace: jest.fn() }
let mockMap

jest.mock('react-leaflet', () => ({ useMap: () => mockMap, Marker: () => null }))
jest.mock('react-leaflet-cluster', () => ({ __esModule: true, default: ({ children }) => children }))
jest.mock('./useMapPopup', () => ({ useMapPopup: () => mockPopupState }))
jest.mock('../context/PopupProvider', () => ({ usePopup: () => mockPopup }))
jest.mock('../store/selectedPlace', () => ({ useSelectedPlace: () => mockSelectedPlace }))
jest.mock('./StateMarker', () => ({ StateAggregateLayer: () => null }))
jest.mock('../components/map/renderPopup', () => ({ renderExpanded: jest.fn(), renderPreview: jest.fn() }))

describe('region counts arriving after map interaction', () => {
  let onStateClick
  const michigan = { stateCode: 'MI', lat: 44, lng: -85, count: 100, regionStatus: 'unloaded' }
  const ohio = { stateCode: 'OH', lat: 40, lng: -83, count: 80, regionStatus: 'unloaded' }
  const showLayer = stateAggregates => <PlacesLayer site="pizza" places={[]} stateAggregates={stateAggregates} onStateClick={onStateClick} />
  const advance = ms => act(() => jest.advanceTimersByTime(ms))

  beforeEach(() => {
    jest.useFakeTimers()
    onStateClick = jest.fn()
    mockMap = {
      getZoom: () => 13,
      getCenter: () => ({ lat: 42.28, lng: -83.74 }),
      getBounds: () => ({ pad: () => ({ contains: () => false }) }),
      on: jest.fn(),
      off: jest.fn(),
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('loads a newly available region without another map gesture', () => {
    const { rerender } = render(showLayer([]))
    advance(1000)
    expect(onStateClick).not.toHaveBeenCalled()

    rerender(showLayer([michigan]))
    advance(151)
    expect(onStateClick).toHaveBeenCalledTimes(1)
    expect(onStateClick).toHaveBeenCalledWith('MI')
  })

  test('does not load successively farther states when more count batches arrive', () => {
    const { rerender } = render(showLayer([michigan]))
    advance(1000)
    expect(onStateClick).toHaveBeenCalledWith('MI')
    onStateClick.mockClear()

    rerender(showLayer([{ ...michigan, regionStatus: 'loaded' }, ohio]))
    advance(151)
    expect(onStateClick).not.toHaveBeenCalled()
  })

  test('keeps state overview zooms aggregated as counts arrive', () => {
    mockMap.getZoom = () => 6
    const { rerender } = render(showLayer([]))
    advance(1000)
    rerender(showLayer([michigan]))
    advance(151)
    expect(onStateClick).not.toHaveBeenCalled()
  })

  test('cancels a pending count-triggered check when the layer unmounts', () => {
    const { rerender, unmount } = render(showLayer([]))
    advance(1000)
    rerender(showLayer([michigan]))
    unmount()
    advance(1000)
    expect(onStateClick).not.toHaveBeenCalled()
  })
})
