import { fireEvent, render, screen, within } from '@testing-library/react'
import { MapControls, searchResultBadge, searchResultReason, searchResultSummary } from './MapControls'

describe('searchResultReason', () => {
  test('shows source brand matches when the display name is generic', () => {
    expect(searchResultReason({
      name: 'Express',
      brand: 'Pizza Hut',
      operator: 'Pizza Hut',
      city: 'Detroit',
      state: 'MI',
    }, 'pizza hut detroit')).toBe('Brand match: Pizza Hut')
  })

  test('falls back to operator matches when brand is unavailable', () => {
    expect(searchResultReason({
      name: 'Carryout',
      operator: "Papa John's",
      city: 'Ann Arbor',
      state: 'MI',
    }, 'papa johns ann arbor')).toBe("Operator match: Papa John's")
  })

  test('does not repeat the location already shown below the name', () => {
    expect(searchResultReason({
      name: 'Slice Shop',
      city: 'New York',
      state: 'NY',
    }, 'new york')).toBe('')
  })

  test('shows address matches when a street term explains the result', () => {
    expect(searchResultReason({
      name: "L'industrie Pizza",
      address: '104 Christopher St',
      city: 'New York',
      state: 'NY',
    }, 'lindustrie christopher')).toBe('Address match: 104 Christopher St')
  })

  test('shows style matches when the name does not explain the result', () => {
    expect(searchResultReason({
      name: 'Slice Shop',
      style: 'Neapolitan',
      city: 'Detroit',
      state: 'MI',
    }, 'neapolitan detroit')).toBe('Style match: Neapolitan')
  })

  test('shows price matches for symbolic and plain-language price searches', () => {
    expect(searchResultReason({
      name: 'Slice Shop',
      price_range: '$$',
      city: 'Detroit',
      state: 'MI',
    }, '$$ detroit')).toBe('Price match: $$')

    expect(searchResultReason({
      name: 'Slice Shop',
      price_range: '$',
      city: 'Detroit',
      state: 'MI',
    }, 'cheap detroit')).toBe('Price match: $')

    expect(searchResultReason({
      name: 'Slice Shop',
      price_range: '$',
      city: 'Detroit',
      state: 'MI',
    }, '$$ detroit')).toBe('')
  })

  test('shows reviewed status matches when users search for visited places', () => {
    expect(searchResultReason({
      name: 'Slice Shop',
      status: 'visited',
      rating: 8.4,
      city: 'Detroit',
      state: 'MI',
    }, 'reviewed detroit')).toBe('Status match: Anthony reviewed')
  })

  test('does not repeat obvious name matches', () => {
    expect(searchResultReason({
      name: 'Pizza Hut',
      brand: 'Pizza Hut',
      city: 'Detroit',
      state: 'MI',
    }, 'pizza hut')).toBe('')
  })

  test('does not repeat a non-exact name match', () => {
    expect(searchResultReason({
      name: "Anthony's Gourmet Pizza",
      city: 'Ann Arbor',
      state: 'MI',
    }, "anthony's pizza")).toBe('')
  })
})

describe('MapControls search results', () => {
  const places = Array.from({ length: 14 }, (_, index) => ({
    id: `place-${index + 1}`,
    name: `Search Pizza ${index + 1}`,
    city: 'Detroit',
    state: 'MI',
  }))

  test('does not show an Unknown style label in a search result', () => {
    render(
      <MapControls
        searchQuery="Anthony's Gourmet Pizza"
        filteredPlaces={[{
          id: 'unknown-style',
          name: "Anthony's Gourmet Pizza",
          state: 'MI',
          style: 'Unknown',
        }]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.getByRole('option')).not.toHaveTextContent('Unknown')
  })

  test('offers a direct all-markets scope toggle', () => {
    const onToggle = jest.fn()
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
        onAllMarketsToggle={onToggle}
      />
    )

    const scopeButton = screen.getByRole('button', { name: /search all markets/i })
    expect(scopeButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(scopeButton)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  test('lets users expand beyond the initial search result page', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={places}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.getByText('14 places found · showing 12')).toBeInTheDocument()
    expect(screen.getByText('Search Pizza 12')).toBeInTheDocument()
    expect(screen.queryByText('Search Pizza 13')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show 2 more/i }))

    expect(screen.getByText('Search Pizza 13')).toBeInTheDocument()
    expect(screen.getByText('Search Pizza 14')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  test('summarizes reviewed places, suggestions, and near-me distance', () => {
    expect(searchResultSummary([
      { id: 'reviewed-1', status: 'visited', rating: 9.2, _distance: 1.2 },
      { id: 'suggestion-1', status: 'unvisited', _distance: 2.8 },
      { id: 'reviewed-2', statusRaw: 'golden', rating: 8.8, _distance: 5.0 },
    ])).toEqual({
      total: 3,
      reviewed: 2,
      suggestions: 1,
      averageDistance: 3,
    })
  })

  test('shows a compact result composition summary', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[
          { id: 'reviewed-1', name: 'Reviewed Pizza', city: 'Detroit', state: 'MI', status: 'visited', rating: 9.2, _distance: 1.2 },
          { id: 'suggestion-1', name: 'Suggested Pizza', city: 'Detroit', state: 'MI', status: 'unvisited', _distance: 2.8 },
        ]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    const summary = screen.getByLabelText(/search result summary/i)
    expect(summary).toHaveTextContent('1 Anthony reviewed')
    expect(summary).toHaveTextContent('1 suggestions')
    expect(summary).toHaveTextContent('2.0 mi avg')
  })

  test('labels reviewed and suggestion search results', () => {
    expect(searchResultBadge({
      id: 'reviewed-1',
      status: 'visited',
      rating: 8.8,
    })).toBe('Reviewed')

    expect(searchResultBadge({
      id: 'suggestion-1',
      status: 'unvisited',
    })).toBe('Suggestion')
  })

  test('treats serialized numeric ratings as reviewed data', () => {
    expect(searchResultBadge({
      id: 'reviewed-serialized',
      status: 'visited',
      rating: '8.8',
    })).toBe('Reviewed')

    expect(searchResultSummary([
      { id: 'reviewed-serialized', status: 'visited', rating: '8.8' },
      { id: 'suggestion-1', status: 'unvisited' },
    ])).toEqual({
      total: 2,
      reviewed: 1,
      suggestions: 1,
      averageDistance: null,
    })
  })

  test('labels historical lifecycle records distinctly', () => {
    expect(searchResultBadge({ lifecycleStatus: 'closed', status: 'visited', rating: 8 })).toBe('Historical')
  })

  test('renders result badges beside each search result', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[
          { id: 'reviewed-1', name: 'Reviewed Pizza', city: 'Detroit', state: 'MI', status: 'visited', rating: 9.2 },
          { id: 'suggestion-1', name: 'Suggested Pizza', city: 'Detroit', state: 'MI', status: 'unvisited' },
        ]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.getByRole('option', { name: /reviewed pizza/i })).toHaveTextContent('Reviewed')
    expect(screen.getByRole('option', { name: /suggested pizza/i })).toHaveTextContent('Suggestion')
  })

  test('does not show an unreviewed zero as a real rating', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[{
          id: 'suggestion-zero-rating',
          name: 'Suggested Pizza',
          city: 'Detroit',
          state: 'MI',
          rating: 0,
          status: 'unvisited',
        }]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    const result = screen.getByRole('option', { name: /suggested pizza/i })
    expect(result).not.toHaveTextContent('★ 0')
    expect(result).toHaveTextContent('Suggestion')
  })

  test('uses accessible map control icons instead of text glyphs', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[]}
        onSearchChange={jest.fn()}
        onNearMeToggle={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: /search places/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /near me/i })).toBeInTheDocument()
    expect(screen.queryByText('🔍')).not.toBeInTheDocument()
    expect(screen.queryByText('📍')).not.toBeInTheDocument()
  })

  test('can prioritize Anthony-reviewed results without losing suggestions', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[
          { id: 'suggestion-1', name: 'Suggested Pizza', city: 'Detroit', state: 'MI', status: 'unvisited' },
          { id: 'reviewed-low', name: 'Reviewed Low', city: 'Detroit', state: 'MI', status: 'visited', rating: 7.8 },
          { id: 'reviewed-high', name: 'Reviewed High', city: 'Detroit', state: 'MI', status: 'visited', rating: 9.1 },
        ]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Suggested PizzaDetroit · MISuggestion',
      'Reviewed LowDetroit · MI★ 7.8 · Anthony reviewedReviewed',
      'Reviewed HighDetroit · MI★ 9.1 · Anthony reviewedReviewed',
    ])

    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed first/i }))

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Reviewed HighDetroit · MI★ 9.1 · Anthony reviewedReviewed',
      'Reviewed LowDetroit · MI★ 7.8 · Anthony reviewedReviewed',
      'Suggested PizzaDetroit · MISuggestion',
    ])
  })

  test('resets reviewed-first sorting when the search query changes', () => {
    const filteredPlaces = [
      { id: 'suggestion-1', name: 'Suggested Pizza', city: 'Detroit', state: 'MI', status: 'unvisited' },
      { id: 'reviewed-high', name: 'Reviewed High', city: 'Detroit', state: 'MI', status: 'visited', rating: 9.1 },
    ]

    const { rerender } = render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={filteredPlaces}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed first/i }))

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Reviewed HighDetroit · MI★ 9.1 · Anthony reviewedReviewed',
      'Suggested PizzaDetroit · MISuggestion',
    ])

    rerender(
      <MapControls
        searchQuery="detroit"
        filteredPlaces={filteredPlaces}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.getByRole('checkbox', { name: /reviewed first/i })).not.toBeChecked()
    expect(screen.getAllByRole('option').map(option => within(option).getByText(/^(Suggested Pizza|Reviewed High)$/).textContent)).toEqual([
      'Suggested Pizza',
      'Reviewed High',
    ])
  })

  test('hides reviewed-first control when all visible results are suggestions', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={[
          { id: 'suggestion-1', name: 'Suggested Pizza', city: 'Detroit', state: 'MI', status: 'unvisited' },
        ]}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    expect(screen.queryByRole('checkbox', { name: /reviewed first/i })).not.toBeInTheDocument()
  })

  test('exposes keyboard search results as a combobox listbox', () => {
    render(
      <MapControls
        searchQuery="pizza"
        filteredPlaces={places.slice(0, 3)}
        onSearchChange={jest.fn()}
        onPlaceClick={jest.fn()}
      />
    )

    const searchInput = screen.getByRole('combobox', { name: /search places/i })
    const resultList = screen.getByRole('listbox', { name: /search results/i })
    const firstResult = screen.getByRole('option', { name: /search pizza 1/i })
    const secondResult = screen.getByRole('option', { name: /search pizza 2/i })

    expect(searchInput).toHaveAttribute('aria-controls', resultList.id)
    expect(searchInput).toHaveAttribute('aria-expanded', 'true')
    expect(searchInput).toHaveAttribute('aria-activedescendant', firstResult.id)
    expect(firstResult).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(searchInput, { key: 'ArrowDown' })

    expect(searchInput).toHaveAttribute('aria-activedescendant', secondResult.id)
    expect(secondResult).toHaveAttribute('aria-selected', 'true')
  })
})
