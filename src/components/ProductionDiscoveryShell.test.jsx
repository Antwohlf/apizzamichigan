import { fireEvent, render, screen } from '@testing-library/react'
import ProductionDiscoveryShell, { sortProductionPlaces } from './ProductionDiscoveryShell'
import { MapControls } from '../map/MapControls'

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
