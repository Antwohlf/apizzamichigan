import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductionDiscoveryShell, { sortProductionPlaces } from './ProductionDiscoveryShell'
import { MapControls } from '../map/MapControls'
import * as placeDisplay from '../lib/placeDisplay'

const place = { id: 'test-pizza', name: 'Test Pizza', lat: 42, lng: -83 }
const shellProps = {
  theme: { brandName: 'A Pizza Michigan' },
  entity: 'pizza',
  view: 'map',
  places: [],
  isPizza: true,
  switchLabel: 'Check out TacoBoutMichigan',
  picksLabel: "Anthony's Picks",
  mapNode: <div data-testid="map">Interactive map</div>,
}

const originalMatchMedia = window.matchMedia
function mockMobileLayout(matches) {
  const listeners = new Set()
  const media = {
    matches,
    addEventListener: jest.fn((event, listener) => listeners.add(listener)),
    removeEventListener: jest.fn((event, listener) => listeners.delete(listener)),
  }
  window.matchMedia = jest.fn(() => media)
  return {
    media,
    change(nextMatches) {
      act(() => {
        media.matches = nextMatches
        listeners.forEach(listener => listener({ matches: nextMatches }))
      })
    },
  }
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
  jest.restoreAllMocks()
})

test('skips hidden mobile cards from the first render and keeps map and search state mounted', () => {
  mockMobileLayout(true)
  const isPickForPlace = jest.fn(() => false)
  const props = {
    ...shellProps,
    places: [place],
    isPickForPlace,
    renderMapControls: () => <input aria-label="Preserved search" defaultValue="Ann Arbor" />,
  }
  const { rerender } = render(<ProductionDiscoveryShell {...props} />)
  const map = screen.getByTestId('map')
  const input = screen.getByRole('textbox', { name: 'Preserved search' })
  expect(screen.queryAllByText(/^(Test Pizza|Second Pizza)$/)).toHaveLength(0)
  expect(isPickForPlace).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'Detroit' } })

  // A newly loaded region should not perform hidden result-card work either.
  rerender(<ProductionDiscoveryShell {...props} places={[place, { ...place, id: 'second', name: 'Second Pizza' }]} />)
  expect(isPickForPlace).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'View places' }))
  expect(screen.queryAllByText(/^(Test Pizza|Second Pizza)$/)).toHaveLength(2)
  expect(screen.getByTestId('map')).toBe(map)
  expect(screen.getByRole('textbox', { name: 'Preserved search' })).toBe(input)
  expect(input).toHaveValue('Detroit')

  fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }))
  expect(screen.queryAllByText(/^(Test Pizza|Second Pizza)$/)).toHaveLength(0)
  expect(screen.getByTestId('map')).toBe(map)
  fireEvent.click(screen.getByRole('button', { name: 'Search pizza, places or cities' }))
  expect(screen.queryAllByText(/^(Test Pizza|Second Pizza)$/)).toHaveLength(2)
  expect(input).toHaveFocus()
})

test('updates card visibility at the CSS breakpoint and cleans up the rotation listener', () => {
  const { media, change } = mockMobileLayout(false)
  const { unmount } = render(<ProductionDiscoveryShell {...shellProps} places={[place]} />)
  const map = screen.getByTestId('map')
  expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 820px), (max-width: 980px) and (max-height: 500px) and (pointer: coarse)')
  expect(screen.queryAllByText('Test Pizza')).toHaveLength(1)
  change(true)
  expect(screen.queryAllByText('Test Pizza')).toHaveLength(0)
  change(false)
  expect(screen.queryAllByText('Test Pizza')).toHaveLength(1)
  expect(screen.getByTestId('map')).toBe(map)
  fireEvent.click(screen.getByRole('button', { name: 'View places' }))
  change(true)
  expect(screen.queryAllByText('Test Pizza')).toHaveLength(1)
  unmount()
  expect(media.removeEventListener).toHaveBeenCalledWith('change', media.addEventListener.mock.calls[0][1])
})

test('retains show-more progress across mobile map/list switching', () => {
  mockMobileLayout(true)
  const places = Array.from({ length: 260 }, (_, index) => ({ ...place, id: `place-${index}`, name: `Pizza ${index}` }))
  render(<ProductionDiscoveryShell {...shellProps} places={places} />)
  expect(screen.queryByRole('button', { name: /Show more places/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View places' }))
  expect(screen.queryAllByText(/^Pizza \d+$/)).toHaveLength(250)
  fireEvent.click(screen.getByRole('button', { name: 'Show more places (10 remaining)' }))
  expect(screen.queryAllByText(/^Pizza \d+$/)).toHaveLength(260)
  fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }))
  expect(screen.queryAllByText(/^Pizza \d+$/)).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'View places' }))
  expect(screen.queryAllByText(/^Pizza \d+$/)).toHaveLength(260)
})

test('memoized cards ignore a new pick predicate when its computed result is unchanged', () => {
  mockMobileLayout(false)
  const location = jest.spyOn(placeDisplay, 'placeLocation')
  const onPlaceClick = jest.fn()
  const props = { ...shellProps, places: [place], onPlaceClick }
  const { rerender } = render(<ProductionDiscoveryShell {...props} isPickForPlace={() => true} />)
  expect(location).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Pick')).toBeInTheDocument()
  location.mockClear()
  rerender(<ProductionDiscoveryShell {...props} isPickForPlace={() => true} scopeNotice="Map moved" />)
  expect(location).not.toHaveBeenCalled()
  rerender(<ProductionDiscoveryShell {...props} isPickForPlace={() => false} />)
  expect(location).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Pick')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Test Pizza' }))
  expect(onPlaceClick).toHaveBeenCalledWith(place)
})

test('search selection shows the map and dismisses the phone keyboard', () => {
  const onPlaceClick = jest.fn()
  render(<ProductionDiscoveryShell
    {...shellProps}
    onPlaceClick={onPlaceClick}
    renderMapControls={onSelect => <MapControls
      searchQuery="Test"
      onSearchChange={jest.fn()}
      filteredPlaces={[place]}
      onPlaceClick={onSelect}
    />}
  />)

  fireEvent.click(screen.getByRole('button', { name: 'Search pizza, places or cities' }))
  const input = screen.getByRole('combobox', { name: 'Search places' })
  expect(input).toHaveFocus()
  expect(screen.getByRole('main')).toHaveAttribute('data-mobile-panel', 'list')
  fireEvent.click(screen.getByRole('option', { name: /Test Pizza/ }))
  expect(onPlaceClick).toHaveBeenCalledWith(place)
  expect(screen.getByRole('main')).toHaveAttribute('data-mobile-panel', 'map')
  expect(input).not.toHaveFocus()
})

// user-event v13 uses a separate DOM Testing Library instance here and requires explicit act.
/* eslint-disable testing-library/no-unnecessary-act */
test('a first card click keeps the search dropdown in place until selection', () => {
  mockMobileLayout(true)
  const onPlaceClick = jest.fn(() => {
    expect(screen.getByRole('option', { name: /Test Pizza/ })).toBeInTheDocument()
  })
  render(<ProductionDiscoveryShell
    {...shellProps}
    places={[place]}
    onPlaceClick={onPlaceClick}
    renderMapControls={onSelect => <MapControls
      searchQuery="Test"
      onSearchChange={jest.fn()}
      filteredPlaces={[place]}
      onPlaceClick={onSelect}
    />}
  />)
  act(() => userEvent.click(screen.getByRole('button', { name: 'Search pizza, places or cities' })))
  const input = screen.getByRole('combobox', { name: 'Search places' })
  expect(screen.getByRole('option', { name: /Test Pizza/ })).toBeInTheDocument()
  const card = screen.getByRole('button', { name: 'Test Pizza' })
  expect(input).toHaveFocus()
  fireEvent.touchStart(card)
  expect(screen.getByRole('option', { name: /Test Pizza/ })).toBeInTheDocument()
  fireEvent.touchEnd(card)
  const beforeClick = jest.fn(() => {
    expect(screen.getByRole('option', { name: /Test Pizza/ })).toBeInTheDocument()
    expect(onPlaceClick).not.toHaveBeenCalled()
  })
  card.addEventListener('mouseup', beforeClick)

  act(() => userEvent.click(card))

  expect(beforeClick).toHaveBeenCalledTimes(1)
  expect(onPlaceClick).toHaveBeenCalledTimes(1)
  expect(onPlaceClick).toHaveBeenCalledWith(place)
  expect(input).not.toHaveFocus()
  expect(screen.queryByRole('option', { name: /Test Pizza/ })).not.toBeInTheDocument()
  expect(screen.getByRole('main')).toHaveAttribute('data-mobile-panel', 'map')
})

test('outside clicks and Escape still dismiss the search dropdown', () => {
  const onPlaceClick = jest.fn()
  render(<ProductionDiscoveryShell
    {...shellProps}
    onPlaceClick={onPlaceClick}
    renderMapControls={onSelect => <MapControls
      searchQuery="Test"
      onSearchChange={jest.fn()}
      filteredPlaces={[place]}
      onPlaceClick={onSelect}
    />}
  />)
  const input = screen.getByRole('combobox', { name: 'Search places' })
  act(() => userEvent.click(input))
  act(() => userEvent.click(screen.getByTestId('map')))
  expect(screen.queryByRole('option', { name: /Test Pizza/ })).not.toBeInTheDocument()
  expect(onPlaceClick).not.toHaveBeenCalled()

  act(() => userEvent.click(input))
  expect(screen.getByRole('option', { name: /Test Pizza/ })).toBeInTheDocument()
  act(() => userEvent.keyboard('{esc}'))
  expect(screen.queryByRole('option', { name: /Test Pizza/ })).not.toBeInTheDocument()
})

test.each(['{enter}', ' '])('result cards remain keyboard selectable with %s', key => {
  const onPlaceClick = jest.fn()
  render(<ProductionDiscoveryShell {...shellProps} places={[place]} onPlaceClick={onPlaceClick} />)
  screen.getByRole('button', { name: 'Test Pizza' }).focus()
  act(() => userEvent.keyboard(key))
  expect(onPlaceClick).toHaveBeenCalledTimes(1)
  expect(onPlaceClick).toHaveBeenCalledWith(place)
})
/* eslint-enable testing-library/no-unnecessary-act */

test('keeps the map mounted while counts load or fail, with a retry action', () => {
  const retry = jest.fn()
  const { rerender } = render(<ProductionDiscoveryShell {...shellProps} mapLoading />)
  const map = screen.getByTestId('map')
  expect(screen.getByRole('status')).toHaveTextContent('Loading places')
  rerender(<ProductionDiscoveryShell {...shellProps} mapError={new Error('Network failure')} onMapRetry={retry} />)
  expect(screen.getByTestId('map')).toBe(map)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).toHaveBeenCalledTimes(1)
  rerender(<ProductionDiscoveryShell {...shellProps} />)
  expect(screen.getByTestId('map')).toBe(map)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('returning from the frozen directory mounts the mobile map visibly', () => {
  const setView = jest.fn()
  const { rerender } = render(<ProductionDiscoveryShell {...shellProps} setView={setView} />)
  fireEvent.click(screen.getByRole('button', { name: 'View places' }))
  expect(screen.getByRole('main')).toHaveAttribute('data-mobile-panel', 'list')
  rerender(<ProductionDiscoveryShell {...shellProps} setView={setView} view="frozen" />)
  fireEvent.click(screen.getByRole('button', { name: 'Pizza Map' }))
  expect(setView).toHaveBeenCalledWith('map')
  rerender(<ProductionDiscoveryShell {...shellProps} setView={setView} />)
  expect(screen.getByRole('main')).toHaveAttribute('data-mobile-panel', 'map')
})

describe('sortProductionPlaces', () => {
  const places = [
    { id: 'a', name: 'Zeta', rating: 8, price_range: '$$' },
    { id: 'b', name: 'Alpha', rating: 9.5, price_range: '$' },
    { id: 'c', name: 'Beta', rating: null, price_range: '$$$' },
  ]

  test('sorts highest rated first while keeping unrated places last', () => {
    expect(sortProductionPlaces(places, 'rating').map(place => place.id)).toEqual(['b', 'a', 'c'])
  })

  test('sorts by name and price without mutating the source array', () => {
    expect(sortProductionPlaces(places, 'name').map(place => place.name)).toEqual(['Alpha', 'Beta', 'Zeta'])
    expect(sortProductionPlaces(places, 'price').map(place => place.id)).toEqual(['b', 'a', 'c'])
    expect(places.map(place => place.id)).toEqual(['a', 'b', 'c'])
  })
})
