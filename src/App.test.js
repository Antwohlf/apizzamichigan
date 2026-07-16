import { render, screen } from '@testing-library/react'
import App, {
  compareSearchResults,
  placeSearchRank,
  remoteSearchTerms,
  searchResultPriority,
  stateCodesForSearch,
  stateScopedNameTerms,
} from './App'
import { __mockFrom, __setMockTable } from './supabaseClient'

jest.mock('./supabaseClient')
const mockFetchTacoPlaces = jest.fn(() => Promise.resolve({ data: [], error: null }))
jest.mock('./lib/supabase-tacos', () => ({
  fetchTacoPlaces: (...args) => mockFetchTacoPlaces(...args),
}))

const mockDataByTable = {
  pizza_places: [
    {
      name: 'Mock Pizza Place',
      style: 'Traditional',
      price: '$$',
      lat: 42,
      lng: -83,
      rating: 9,
      review: 'Test pizza spot',
      notes: 'Thin crust classic.',
    },
  ],
  taco_places: [
    {
      name: 'Mock Taco Truck',
      style: 'Street',
      price: '$',
      lat: 42.3,
      lng: -83.1,
      rating: 8,
      review: 'Test taco truck',
      notes: 'Serve with lime.',
    },
  ],
  frozen_pizzas: [
    {
      Brand: 'Mock Frozen Pizza',
      Type: 'Traditional',
      Price: '$',
      Rating: 7,
      Notes: 'Still crunchy crust.',
    },
  ],
  frozen_tacos: [
    {
      Brand: 'Mock Frozen Taco',
      Type: 'Street',
      Price: '$',
      Rating: 6,
      Notes: 'Serve with salsa.',
    },
  ],
}

describe('App routing themes', () => {
  beforeEach(() => {
    Object.entries(mockDataByTable).forEach(([table, rows]) => {
      __setMockTable(table, rows)
    })
    __mockFrom.mockClear()
    mockFetchTacoPlaces.mockResolvedValue({ data: mockDataByTable.taco_places, error: null })
    window.history.pushState({}, '', '/')
  })

  test('renders APizzaMichigan on the root route', async () => {
    render(<App />)

    const heading = await screen.findByRole('heading', { name: /a pizza michigan/i })
    expect(heading).toBeInTheDocument()

    const cta = screen.getByRole('link', { name: /check out tacoboutmichigan/i })
    expect(cta).toHaveAttribute('href', '/tacos')
  })

  test('renders TacoBoutMichigan on /tacos', async () => {
    window.history.pushState({}, '', '/tacos')
    render(<App />)

    const heading = await screen.findByRole('heading', { name: /taco bout michigan/i })
    expect(heading).toBeInTheDocument()

    const cta = screen.getByRole('link', { name: /check out apizzamichigan/i })
    expect(cta).toHaveAttribute('href', '/')
  })
})

describe('remoteSearchTerms', () => {
  test('uses specific terms instead of generic pizza terms when possible', () => {
    expect(remoteSearchTerms('Pizza Hut Detroit')).toEqual(['pizza hut detroit', 'hut detroit', 'pizza hut', 'detroit', 'hut'])
  })

  test('keeps generic terms when they are the only search input', () => {
    expect(remoteSearchTerms('pizza')).toEqual(['pizza'])
  })

  test('adds conservative punctuation variants for elided names', () => {
    expect(remoteSearchTerms('lindustrie')).toEqual(['lindustrie', 'industrie'])
  })

  test('adds common location aliases for remote lookup', () => {
    expect(remoteSearchTerms('lindustrie nyc')).toEqual([
      'lindustrie nyc',
      'lindustrie new york',
      'industrie new york',
      'industrie nyc',
      'lindustrie',
      'industrie',
      'new york',
      'nyc',
    ])
  })

  test('adds adjacent brand and location phrases for multi-word searches', () => {
    expect(remoteSearchTerms('Papa Johns Ann Arbor')).toEqual([
      'papa johns ann arbor',
      'papa johns',
      'papa john',
      'johns ann',
      'ann arbor',
      'johns',
      'arbor',
      'papa',
      'john',
      'ann',
    ])
  })

  test('keeps chain phrases when pizza is part of the searchable brand', () => {
    expect(remoteSearchTerms("Domino's Pizza Ann Arbor")).toEqual([
      'domino s pizza ann arbor',
      'domino pizza',
      'domino ann',
      'pizza ann',
      'ann arbor',
      'domino',
      'arbor',
      'ann',
    ])
  })
})

describe('state-aware search helpers', () => {
  test('detects state names and codes in user searches', () => {
    expect(stateCodesForSearch('Pizza Hut Michigan')).toEqual(['MI'])
    expect(stateCodesForSearch('Lindustrie NY')).toEqual(['NY'])
    expect(stateCodesForSearch('Pizza New Jersey')).toEqual(['NJ'])
  })

  test('keeps only searchable name terms for state-scoped remote lookup', () => {
    expect(stateScopedNameTerms('Pizza Hut Michigan')).toEqual(['hut'])
    expect(stateScopedNameTerms("Buddy's Pizza MI")).toEqual(['buddy'])
  })
})

describe('placeSearchRank', () => {
  test('prioritizes mixed name and location matches', () => {
    const query = 'pizza hut detroit'
    const terms = ['pizza', 'hut', 'detroit']
    const brandInLocation = {
      name: 'Pizza Hut',
      address: '123 Woodward Ave',
      city: 'Detroit',
      state: 'MI',
    }
    const genericRegionalMatch = {
      name: 'Detroit Pizza Company',
      address: '123 Hut Street',
      city: 'Detroit',
      state: 'MI',
    }

    expect(placeSearchRank(brandInLocation, query, terms))
      .toBeLessThan(placeSearchRank(genericRegionalMatch, query, terms))
  })

  test('matches names when users omit apostrophes or spaces', () => {
    const place = {
      name: "L'industrie Pizza",
      address: '104 Christopher St',
      city: 'New York',
      state: 'NY',
    }
    const generic = {
      name: 'Industrial Slice Shop',
      address: '1 Pizza Ave',
      city: 'New York',
      state: 'NY',
    }

    expect(placeSearchRank(place, 'lindustrie')).toBeLessThan(3)
    expect(placeSearchRank(place, 'lindustrie'))
      .toBeLessThan(placeSearchRank(generic, 'lindustrie'))
  })

  test('treats common city shorthand as a location match', () => {
    const query = 'lindustrie nyc'
    const terms = ['lindustrie', 'nyc']
    const place = {
      name: "L'industrie Pizza",
      address: '104 Christopher St',
      city: 'New York',
      state: 'NY',
    }
    const generic = {
      name: 'Industrial Slice Shop',
      address: '1 Pizza Ave',
      city: 'New York',
      state: 'NY',
    }

    expect(placeSearchRank(place, query, terms)).toBeLessThan(6)
    expect(placeSearchRank(place, query, terms))
      .toBeLessThan(placeSearchRank(generic, query, terms))
  })

  test('finds brand and location matches when users put the city first', () => {
    const query = 'detroit pizza hut'
    const terms = ['detroit', 'pizza', 'hut']
    const brandInLocation = {
      name: 'Pizza Hut',
      address: '123 Woodward Ave',
      city: 'Detroit',
      state: 'MI',
    }
    const genericRegionalMatch = {
      name: 'Detroit Pizza Company',
      address: '123 Hut Street',
      city: 'Detroit',
      state: 'MI',
    }

    expect(placeSearchRank(brandInLocation, query, terms)).toBe(5)
    expect(placeSearchRank(brandInLocation, query, terms))
      .toBeLessThan(placeSearchRank(genericRegionalMatch, query, terms))
  })

  test('matches possessive chain names when users omit apostrophes', () => {
    const query = 'papa johns ann arbor'
    const terms = ['papa', 'johns', 'ann', 'arbor']
    const place = {
      name: "Papa John's",
      address: '111 Main St',
      city: 'Ann Arbor',
      state: 'MI',
    }
    const generic = {
      name: 'Papa Pizza',
      address: 'Johns Arbor Plaza',
      city: 'Ann Arbor',
      state: 'MI',
    }

    expect(placeSearchRank(place, query, terms)).toBe(5)
    expect(placeSearchRank(place, query, terms))
      .toBeLessThan(placeSearchRank(generic, query, terms))
  })

  test('treats full state names as location terms for brand searches', () => {
    const query = 'pizza hut michigan'
    const terms = ['pizza', 'hut', 'michigan']
    const place = {
      name: 'Pizza Hut',
      address: '123 Main St',
      city: 'Detroit',
      state: 'MI',
    }
    const generic = {
      name: 'Michigan Pizza Company',
      address: '123 Hut Street',
      city: 'Detroit',
      state: 'MI',
    }

    expect(placeSearchRank(place, query, terms)).toBe(5)
    expect(placeSearchRank(place, query, terms))
      .toBeLessThan(placeSearchRank(generic, query, terms))
  })
})

describe('searchResultPriority', () => {
  test('prioritizes Anthony-reviewed places over unreviewed source candidates', () => {
    const reviewed = {
      name: 'Lindustrie Pizza',
      status: 'visited',
      rating: 11,
    }
    const unreviewed = {
      name: 'Lindustrie Pizza',
      status: 'unvisited',
    }

    expect(searchResultPriority(reviewed)).toBeLessThan(searchResultPriority(unreviewed))
  })
})

describe('compareSearchResults', () => {
  test('uses reviewed status as a tie-break after text relevance', () => {
    const reviewed = {
      name: 'Lindustrie Pizza',
      status: 'visited',
      rating: 11,
      _searchRank: 2,
    }
    const sourceCandidate = {
      name: 'Lindustrie Pizza',
      status: 'unvisited',
      _searchRank: 2,
    }

    expect([sourceCandidate, reviewed].sort(compareSearchResults)).toEqual([reviewed, sourceCandidate])
  })

  test('does not let reviewed status beat a stronger text match', () => {
    const exactName = {
      name: 'Pizza Hut',
      status: 'unvisited',
      _searchRank: 0,
    }
    const reviewedWeakerMatch = {
      name: 'Detroit Pizza Company',
      status: 'visited',
      rating: 9,
      _searchRank: 6,
    }

    expect([reviewedWeakerMatch, exactName].sort(compareSearchResults)).toEqual([exactName, reviewedWeakerMatch])
  })
})
