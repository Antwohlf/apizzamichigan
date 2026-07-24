import { render, screen } from '@testing-library/react'
import App, {
  compareSearchResults,
  fetchPlacesForState,
  placeSearchRank,
  dedupeSearchRows,
  remoteSearchTerms,
  remoteSearchableColumns,
  legacyRemoteSearchableColumns,
  fetchPlacesForSearch,
  fetchStateCounts,
  publicSearchSelect,
  publicPlaceSelect,
  publicPlaceSelectForTable,
  publicSearchSelectForTable,
  readPublicMapQuery,
  normalizeLifecycleStatus,
  searchResultPriority,
  stateCodesForSearch,
  stateScopedNameTerms,
  isAnthonysPick,
} from './App'
import { __mockFrom, __setMockTable, supabase } from './supabaseClient'
import { publicPlaceLegacySelectForTable } from './lib/publicPlaceFields'
import { normalizePizzaStyle } from './data/pizzaStyles'

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

  test('preserves shareable search state on the first render', async () => {
    window.history.pushState({}, '', '/?q=Anthony%27s%20Pizza&style=Detroit,Sicilian&price=%24%24&status=visited,golden&picks=1&history=1')

    render(<App />)

    await screen.findByRole('heading', { name: /a pizza michigan/i })

    expect(window.location.search).toBe('?q=Anthony%27s+Pizza&style=Detroit%2CSicilian&price=%24%24&status=visited%2Cgolden&picks=1&history=1')
  })

  test('reads shareable style and price filters', () => {
    expect(readPublicMapQuery('?style=Detroit,Sicilian&price=%24%24')).toEqual(expect.objectContaining({
      styles: ['Detroit', 'Sicilian'],
      prices: ['$$'],
    }))
  })
})

describe('state map loading migration compatibility', () => {
  test('counts Anthony\'s Picks using the same rating threshold as the filter', async () => {
    __setMockTable('pizza_places', [
      { id: 1, state: 'MI', rating: 8 },
      { id: 2, state: 'MI', rating: 7.9 },
      { id: 3, state: 'NY', rating: 9 },
    ])

    await expect(fetchStateCounts('pizza_places', {
      includeStates: ['MI'],
      includeStatuses: ['visited', 'golden'],
      requireRating: true,
      minimumRating: 8,
    })).resolves.toEqual({ MI: 1, NY: 1 })
  })

  test('retries with legacy fields when lifecycle columns are unavailable', async () => {
    const selects = []
    const makeQuery = result => {
      const query = {
        select: jest.fn(columns => {
          selects.push(columns)
          return query
        }),
        eq: jest.fn(() => query),
        range: jest.fn(() => Promise.resolve(result)),
      }
      return query
    }
    const originalFrom = supabase.from
    supabase.from = jest.fn()
      .mockReturnValueOnce(makeQuery({
        data: null,
        error: { message: 'column pizza_places.lifecycle_status does not exist' },
      }))
      .mockReturnValueOnce(makeQuery({
        data: [{ id: 1, name: 'Legacy Pizza' }],
        error: null,
      }))

    try {
      await expect(fetchPlacesForState('pizza_places', 'MI')).resolves.toEqual([
        { id: 1, name: 'Legacy Pizza' },
      ])
      expect(selects[0]).toContain('lifecycle_status')
      expect(selects[1]).not.toContain('lifecycle_status')
    } finally {
      supabase.from = originalFrom
    }
  })
})

describe('remoteSearchTerms', () => {
  test('restores shareable map search and Picks state from the URL', () => {
    expect(readPublicMapQuery('?q=Anthony%27s%20Pizza&status=visited,golden&picks=1')).toEqual({
      query: "Anthony's Pizza",
      styles: [],
      prices: [],
      statuses: ['visited', 'golden'],
      anthonysPicks: true,
      showHistorical: false,
      showAllMarkets: false,
    })
  })

  test('restores the shareable historical-places filter from the URL', () => {
    expect(readPublicMapQuery('?history=1')).toEqual(expect.objectContaining({
      showHistorical: true,
    }))
  })

  test('restores the explicit all-markets scope from the URL', () => {
    expect(readPublicMapQuery('?scope=all')).toEqual(expect.objectContaining({
      showAllMarkets: true,
    }))
  })

  test('defines Anthony\'s Picks as rated 8 or higher', () => {
    expect(isAnthonysPick({ rating: 8 })).toBe(true)
    expect(isAnthonysPick({ rating: '9.5' })).toBe(true)
    expect(isAnthonysPick({ rating: 7.9 })).toBe(false)
    expect(isAnthonysPick({ rating: null })).toBe(false)
  })

  test('supports an entity-specific Anthony\'s Picks threshold', () => {
    expect(isAnthonysPick({ rating: 7.5 }, { minimumRating: 7.5 })).toBe(true)
    expect(isAnthonysPick({ rating: 7.4 }, { minimumRating: 7.5 })).toBe(false)
  })

  test('normalizes legacy and multi-label pizza styles to one primary style', () => {
    expect(normalizePizzaStyle('Traditional')).toBe('Standard Round')
    expect(normalizePizzaStyle('Traditional, Detroit')).toBe('Detroit')
    expect(normalizePizzaStyle('Chicago, Sicilian, New York')).toBe('Sicilian')
    expect(normalizePizzaStyle('Breakfast')).toBe('Unknown')
    expect(normalizePizzaStyle('')).toBeNull()
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
    expect(publicPlaceSelect).toBe(publicSearchSelect)
    expect(publicPlaceSelect).not.toContain('osm_tags')
    expect(publicPlaceSelect).not.toContain('menu_data')
    expect(publicPlaceSelectForTable('taco_places')).not.toContain('price_range')
    expect(publicPlaceSelectForTable('taco_places')).not.toContain('brand')
    expect(publicSearchSelectForTable('taco_places')).toBe(publicPlaceSelectForTable('taco_places'))
  })

  test('keeps public search fallback bounded instead of using select star', () => {
    expect(publicSearchSelect).not.toBe('*')
    expect(publicSearchSelectForTable('taco_places')).not.toBe('*')
    expect(publicPlaceLegacySelectForTable('pizza_places')).toContain('website_url')
    expect(publicPlaceLegacySelectForTable('pizza_places')).toContain('brand')
    expect(publicPlaceLegacySelectForTable('pizza_places')).not.toContain('city')
    expect(publicPlaceLegacySelectForTable('pizza_places')).not.toContain('lifecycle_status')
  })

  test('uses only columns present in the canonical tables', () => {
    expect(remoteSearchableColumns('pizza_places')).toEqual([
      'name', 'address', 'website_url', 'phone', 'state', 'style', 'status', 'price_range', 'brand', 'operator',
    ])
    expect(remoteSearchableColumns('taco_places')).toEqual([
      'name', 'address', 'state', 'style', 'status', 'price',
    ])
    expect(remoteSearchableColumns('taco_places')).not.toContain('website_url')
    expect(remoteSearchableColumns('taco_places')).not.toContain('phone')
  })

  test('downgrades search filter columns when an older public schema rejects newer columns', async () => {
    const queries = []
    const makeQuery = result => {
      const query = {
        select: jest.fn(columns => {
          queries.push({ select: columns })
          return query
        }),
        or: jest.fn(filter => {
          queries[queries.length - 1].filter = filter
          return query
        }),
        order: jest.fn(() => query),
        limit: jest.fn(() => Promise.resolve(result)),
      }
      return query
    }
    const originalFrom = supabase.from
    supabase.from = jest.fn()
      .mockReturnValueOnce(makeQuery({ data: null, error: { message: 'column pizza_places.city does not exist' } }))
      .mockReturnValueOnce(makeQuery({ data: [{ id: 42, name: 'Legacy Pizza' }], error: null }))

    try {
      await expect(fetchPlacesForSearch('pizza_places', ['ann arbor'], 'Ann Arbor')).resolves.toEqual([
        { id: 42, name: 'Legacy Pizza' },
      ])
      expect(queries).toHaveLength(2)
      expect(queries[0].filter).not.toContain('city.ilike.')
      expect(queries[1].filter).not.toContain('city.ilike.')
      expect(queries[1].select).toBe(publicPlaceLegacySelectForTable('pizza_places'))
      expect(legacyRemoteSearchableColumns('pizza_places')).not.toContain('city')
    } finally {
      supabase.from = originalFrom
    }
  })

  test('reuses the legacy search shape after the public schema rejects a column', async () => {
    const selects = []
    const makeQuery = result => {
      const query = {
        select: jest.fn(columns => {
          selects.push(columns)
          return query
        }),
        or: jest.fn(() => query),
        order: jest.fn(() => query),
        limit: jest.fn(() => Promise.resolve(result)),
      }
      return query
    }
    const originalFrom = supabase.from
    supabase.from = jest.fn()
      .mockReturnValueOnce(makeQuery({ data: null, error: { message: 'column pizza_places.city does not exist' } }))
      .mockReturnValueOnce(makeQuery({ data: [{ id: 42, name: 'Legacy Pizza' }], error: null }))
      .mockReturnValueOnce(makeQuery({ data: [{ id: 42, name: 'Legacy Pizza' }], error: null }))

    try {
      await fetchPlacesForSearch('pizza_places', ['ann arbor'], 'Ann Arbor')
      await fetchPlacesForSearch('pizza_places', ['ann arbor'], 'Ann Arbor')
      expect(selects).toHaveLength(3)
      expect(selects[2]).toBe(publicPlaceLegacySelectForTable('pizza_places'))
    } finally {
      supabase.from = originalFrom
    }
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

  test('matches lifecycle searches when personal visit status is blank', () => {
    const historicalPlace = {
      name: 'Former Pizza Place',
      status: null,
      lifecycle_status: 'closed',
      state: 'MI',
    }
    expect(placeSearchRank(historicalPlace, 'closed')).toBeLessThan(99)
    expect(placeSearchRank({ ...historicalPlace, lifecycle_status: 'replaced' }, 'historical')).toBeLessThan(99)
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

  test('expands the common NYPD shorthand to the stored place name', () => {
    expect(remoteSearchTerms('NYPD')).toEqual(['new york pizza depot', 'nypd'])
    expect(placeSearchRank({ name: 'New York Pizza Depot', city: 'Ann Arbor', state: 'MI' }, 'nypd', ['nypd']))
      .toBeLessThan(99)
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

  test('treats replaced and demolished records as historical search results too', () => {
    for (const lifecycleStatus of ['replaced', 'demolished']) {
      expect(placeSearchRank({
        name: 'Former Pizza Place',
        lifecycleStatus,
        status: 'unvisited',
        city: 'Detroit',
        state: 'MI',
      }, 'historical pizza', ['historical', 'pizza'])).toBeLessThan(99)
    }
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

  test('does not treat a conflicting street name as a city match', () => {
    const place = {
      name: "Domino's",
      address: '1043 West Ann Arbor Road',
      city: 'Plymouth',
      state: 'MI',
    }

    expect(placeSearchRank(place, 'ann arbor', ['ann', 'arbor'])).toBe(99)
    expect(placeSearchRank({ ...place, city: null }, 'ann arbor', ['ann', 'arbor'])).toBe(99)
    expect(placeSearchRank(place, '1043 ann arbor road')).toBeLessThan(99)
    expect(placeSearchRank({
      ...place,
      website_url: 'https://example.com/ann-arbor-road',
    }, 'ann arbor', ['ann', 'arbor'])).toBe(99)
    expect(placeSearchRank({
      ...place,
      website_url: 'https://littlecaesars.com/en-us/store/8742',
    }, 'littlecaesars.com/en-us/store/8742')).toBeLessThan(99)
  })

  test('matches a city in a comma-separated address when city is not a separate field', () => {
    expect(placeSearchRank({
      name: 'Backroom Pizza',
      address: '605 Church Street, Ann Arbor, MI 48104',
      city: null,
      state: 'MI',
    }, 'ann arbor', ['ann', 'arbor'])).toBeLessThan(99)
  })

  test('does not treat a personal name in a place query as a review-status filter', () => {
    const query = "Anthony's Pizza Ann Arbor"
    const terms = ['anthony', 's', 'pizza', 'ann', 'arbor']
    const unrelatedReviewedPlace = {
      name: "Domino's",
      status: 'visited',
      rating: 8,
      city: 'Ann Arbor',
      state: 'MI',
    }

    expect(placeSearchRank(unrelatedReviewedPlace, query, terms)).toBe(99)
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

describe('dedupeSearchRows', () => {
  test('prefers a located row over an unusable same-name regional placeholder', () => {
    const rows = dedupeSearchRows([
      { id: 30, name: "Anthony's Gourmet Pizza", state: 'MI', address: '1508 N Maple Rd, Ann Arbor, MI 48103' },
      { id: 31, name: "Anthony's Gourmet Pizza", state: 'MI', address: '1924 Packard St, Ann Arbor, MI 48104' },
      { id: 242, name: "Anthony's Gourmet Pizza", state: 'MI', address: 'MI' },
    ])

    expect(rows.map(row => row.id)).toEqual([30, 31])
  })

  test('keeps same-name branches when both have usable addresses', () => {
    const rows = dedupeSearchRows([
      { id: 1, name: 'Little Caesars', state: 'MI', address: '1 Main St, Detroit, MI' },
      { id: 2, name: 'Little Caesars', state: 'MI', address: '2 Main St, Detroit, MI' },
    ])

    expect(rows.map(row => row.id)).toEqual([1, 2])
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

  test('prefers configured primary-market states for broad searches', () => {
    const overseasExact = {
      name: "Anthony's Pizza",
      state: 'DE',
      status: 'unvisited',
      _searchRank: 0,
    }
    const michiganMatch = {
      name: "Anthony's Gourmet Pizza",
      state: 'MI',
      status: 'visited',
      rating: 7,
      _searchRank: 3,
    }

    expect([overseasExact, michiganMatch].sort((left, right) => compareSearchResults(left, right, {
      preferredStates: ['MI', 'NY'],
    }))).toEqual([michiganMatch, overseasExact])
  })
})
