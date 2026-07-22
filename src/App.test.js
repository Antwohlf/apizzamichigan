import { render, screen } from '@testing-library/react'
import App, {
  compareSearchResults,
  placeSearchRank,
  remoteSearchTerms,
  remoteSearchableColumns,
  publicSearchSelect,
  normalizeLifecycleStatus,
  searchResultPriority,
  stateCodesForSearch,
  stateScopedNameTerms,
  isAnthonysPick,
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
  test('defines Anthony\'s Picks as rated 8 or higher', () => {
    expect(isAnthonysPick({ rating: 8 })).toBe(true)
    expect(isAnthonysPick({ rating: '9.5' })).toBe(true)
    expect(isAnthonysPick({ rating: 7.9 })).toBe(false)
    expect(isAnthonysPick({ rating: null })).toBe(false)
  })

  test('keeps public search payload bounded to display and ranking fields', () => {
    expect(publicSearchSelect).toContain('name')
    expect(publicSearchSelect).toContain('brand')
    expect(publicSearchSelect).toContain('rating')
    expect(publicSearchSelect).toContain('lifecycle_status')
    expect(publicSearchSelect).toContain('lifecycle_replaced_by_id')
    expect(publicSearchSelect).not.toContain('osm_tags')
    expect(publicSearchSelect).not.toContain('scrape_notes')
    expect(publicSearchSelect).toContain('website_url')
    expect(publicSearchSelect).toContain('phone')
  })

  test('uses only columns present in the canonical tables', () => {
    expect(remoteSearchableColumns('pizza_places')).toEqual([
      'name', 'address', 'website_url', 'phone', 'state', 'style', 'status', 'price_range', 'brand', 'operator',
    ])
    expect(remoteSearchableColumns('taco_places')).not.toContain('city')
  })

  test('uses specific terms instead of generic pizza terms when possible', () => {
    expect(remoteSearchTerms('Pizza Hut Detroit')).toEqual(['pizza hut detroit', 'hut detroit', 'pizza hut', 'detroit', 'hut'])
  })

  test('keeps generic terms when they are the only search input', () => {
    expect(remoteSearchTerms('pizza')).toEqual(['pizza'])
  })

  test('supports explicit lifecycle searches', () => {
    expect(normalizeLifecycleStatus('Permanently closed')).toBe('closed')
    expect(normalizeLifecycleStatus('replaced by a new business')).toBe('replaced')
    expect(remoteSearchTerms('historical pizza')).toContain('closed')
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

  test('expands compact chain names for remote lookup', () => {
    expect(remoteSearchTerms('pizzahut detroit')).toEqual([
      'pizzahut detroit',
      'pizza hut detroit',
      'hut detroit',
      'pizza hut',
      'pizzahut',
      'detroit',
      'hut',
    ])

    expect(remoteSearchTerms('papamurphys lansing')).toEqual([
      'papamurphys lansing',
      'papa murphys lansing',
      'papa murphy lansing',
      'papamurphy lansing',
      'papa murphys',
      'papamurphys',
      'papa murphy',
      'papamurphy',
      'murphys',
    ])
  })

  test('expands price and reviewed intent for remote lookup', () => {
    expect(remoteSearchTerms('cheap')).toEqual(['cheap', '$'])
    expect(remoteSearchTerms('favorites')).toEqual(['favorites', 'favorite', 'golden'])
    expect(remoteSearchTerms('reviewed')).toEqual(['reviewed', 'visited', 'golden'])
  })
})

describe('state-aware search helpers', () => {
  test('detects state names and codes in user searches', () => {
    expect(stateCodesForSearch('Pizza Hut Michigan')).toEqual(['MI'])
    expect(stateCodesForSearch('Lindustrie NY')).toEqual(['NY'])
    expect(stateCodesForSearch('Pizza New Jersey')).toEqual(['NJ'])
  })

  test('keeps only searchable name terms for state-scoped remote lookup', () => {
    expect(stateScopedNameTerms('Pizza Hut Michigan')).toEqual(['pizza hut', 'hut'])
    expect(stateScopedNameTerms("Buddy's Pizza MI")).toEqual(['buddy pizza', 'buddy'])
  })

  test('keeps multi-word brand phrases while removing state aliases', () => {
    expect(stateScopedNameTerms('Papa Johns Michigan')).toEqual([
      'papa johns',
      'papa john',
      'johns',
      'papa',
      'john',
    ])
  })
})

describe('placeSearchRank', () => {
  test('keeps historical closed places searchable without treating them as normal matches', () => {
    const historical = {
      name: 'Old Neighborhood Pizza',
      status: 'visited',
      statusRaw: 'closed',
      lifecycleStatus: 'closed',
      rating: 8.5,
      city: 'Detroit',
      state: 'MI',
    }

    expect(placeSearchRank(historical, 'historical pizza', ['historical', 'pizza'])).toBeLessThan(99)
  })
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

  test('ranks exact website and phone searches as strong identifiers', () => {
    const place = {
      name: 'Little Caesars',
      website_url: 'https://littlecaesars.com/en-us/store/8742',
      phone: '+1 209-466-5555',
    }

    expect(placeSearchRank(place, 'littlecaesars.com/en-us/store/8742')).toBeLessThan(2)
    expect(placeSearchRank(place, '2094665555')).toBeLessThan(2)
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

  test('uses source brand/operator fields for chain search relevance', () => {
    const query = 'pizza hut detroit'
    const terms = ['pizza', 'hut', 'detroit']
    const sourceBrandedPlace = {
      name: 'Express',
      brand: 'Pizza Hut',
      operator: 'Pizza Hut',
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

    expect(placeSearchRank(sourceBrandedPlace, query, terms)).toBe(5)
    expect(placeSearchRank(sourceBrandedPlace, query, terms))
      .toBeLessThan(placeSearchRank(genericRegionalMatch, query, terms))
  })

  test('matches brand-only text for source-enriched rows', () => {
    const sourceBrandedPlace = {
      name: 'Express',
      brand: 'Pizza Hut',
      operator: 'Pizza Hut',
      address: '123 Main St',
      city: 'Lansing',
      state: 'MI',
    }

    expect(placeSearchRank(sourceBrandedPlace, 'pizza hut')).toBeLessThan(4)
  })

  test('ranks compact chain aliases above incidental text matches', () => {
    const query = 'papamurphys lansing'
    const terms = ['papamurphys', 'lansing']
    const sourceBrandedPlace = {
      name: "Papa Murphy's",
      brand: "Papa Murphy's",
      operator: "Papa Murphy's",
      address: '123 Main St',
      city: 'Lansing',
      state: 'MI',
    }
    const incidentalMatch = {
      name: 'Murphy Pizza',
      address: '123 Papa St',
      city: 'Lansing',
      state: 'MI',
    }

    expect(placeSearchRank(sourceBrandedPlace, query, terms)).toBe(4.5)
    expect(placeSearchRank(sourceBrandedPlace, query, terms))
      .toBeLessThan(placeSearchRank(incidentalMatch, query, terms))
  })

  test('matches natural-language price searches with location terms', () => {
    const query = 'cheap detroit'
    const terms = ['cheap', 'detroit']
    const cheapPlace = {
      name: 'Slice Counter',
      price_range: '$',
      city: 'Detroit',
      state: 'MI',
    }
    const expensivePlace = {
      name: 'Chef Pizza',
      price_range: '$$$',
      city: 'Detroit',
      state: 'MI',
    }

    expect(placeSearchRank(cheapPlace, query, terms)).toBeLessThan(9)
    expect(placeSearchRank(expensivePlace, query, terms)).toBe(99)
  })

  test('matches reviewed and favorite intent without requiring the word in the name', () => {
    const reviewedQuery = 'reviewed ann arbor'
    const favoriteQuery = 'favorites'
    const reviewedPlace = {
      name: 'Neighborhood Slice',
      status: 'visited',
      rating: 8.4,
      city: 'Ann Arbor',
      state: 'MI',
    }
    const favoritePlace = {
      name: 'Destination Pizza',
      status: 'golden',
      rating: 10,
      city: 'Detroit',
      state: 'MI',
    }
    const unvisitedPlace = {
      name: 'New Pizza',
      status: 'unvisited',
      city: 'Ann Arbor',
      state: 'MI',
    }

    expect(placeSearchRank(reviewedPlace, reviewedQuery, ['reviewed', 'ann', 'arbor'])).toBeLessThan(9)
    expect(placeSearchRank(unvisitedPlace, reviewedQuery, ['reviewed', 'ann', 'arbor'])).toBe(99)
    expect(placeSearchRank(favoritePlace, favoriteQuery, ['favorites'])).toBeLessThan(9)
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
