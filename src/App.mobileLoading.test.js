import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import App from './App'

const mockFrom = jest.fn()
jest.mock('./supabaseClient', () => ({ supabase: {
  from: (...args) => mockFrom(...args),
  rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }),
} }))
jest.mock('./components/ProductionDiscoveryShell', () => {
  const React = require('react')
  const actual = jest.requireActual('./components/ProductionDiscoveryShell')
  return {
    ...actual,
    __esModule: true,
    default: ({ renderMapControls, onPlaceClick, places, mapNode }) => React.createElement('main', null,
      renderMapControls(onPlaceClick),
      mapNode,
      React.createElement('output', { 'data-testid': 'visible-places' }, places.map(place => place.name).join(', ')),
    ),
  }
})
jest.mock('./map', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ stateAggregates, onStateClick }) => React.createElement('div', null,
      React.createElement('output', { 'data-testid': 'available-regions' }, stateAggregates.map(region => region.stateCode).join(',')),
      React.createElement('button', { onClick: () => onStateClick(stateAggregates[0]?.stateCode) }, 'Load available region'),
    ),
  }
})

describe('search during progressive mobile map loading', () => {
  let requests
  const advance = async milliseconds => {
    await act(async () => {
      jest.advanceTimersByTime(milliseconds)
    })
  }
  const respond = async (request, response) => {
    await act(async () => request.resolve(response))
  }
  const pendingQuery = metadata => {
    let resolve
    const promise = new Promise(done => { resolve = done })
    const request = { ...metadata, resolve }
    requests[metadata.kind].push(request)
    return promise
  }
  const place = (id, name, state = 'AL') => ({ id, name, state, lat: 42.28, lng: -83.74, status: 'unvisited' })

  beforeEach(() => {
    jest.useFakeTimers()
    window.localStorage.clear()
    requests = { counts: [], search: [], photos: [], regions: [] }
    mockFrom.mockImplementation(table => {
      const metadata = { table }
      let promise
      const query = {
        select: (columns, options = {}) => { metadata.columns = columns; metadata.head = options.head; return query },
        in: (column, values) => { if (column === 'state') metadata.states = values; return query },
        eq: (column, value) => { if (column === 'state') metadata.state = value; return query },
        or: filter => { metadata.filter = filter; return query },
        is: () => query,
        not: () => query,
        gte: () => query,
        order: () => query,
        limit: () => query,
        range: () => query,
        then: (resolve, reject) => {
          if (!promise) {
            if (metadata.head) promise = pendingQuery({ ...metadata, kind: 'counts' })
            else if (table === 'review-photos') promise = pendingQuery({ ...metadata, kind: 'photos' })
            else if (metadata.columns === 'state' || metadata.columns === 'state,address') promise = Promise.resolve({ data: [], error: null })
            else if (metadata.filter) promise = pendingQuery({ ...metadata, kind: 'search' })
            else if (metadata.state) promise = pendingQuery({ ...metadata, kind: 'regions' })
            else promise = Promise.resolve({ data: [], error: null })
          }
          return promise.then(resolve, reject)
        },
      }
      return query
    })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    mockFrom.mockReset()
  })

  test('keeps one search request across count batches and shows results before photos finish', async () => {
    window.history.replaceState({}, '', '/?q=marigoldmobile')
    render(<App />)
    await advance(251)
    expect(requests.search).toHaveLength(1)
    expect(requests.counts).toHaveLength(4)

    // Complete a count batch while the original search response is still pending.
    await act(async () => {
      requests.counts.slice(0, 4).forEach(request => request.resolve({ count: 2, error: null }))
    })
    expect(screen.getByTestId('available-regions')).not.toBeEmptyDOMElement()
    await advance(300)
    expect(requests.search).toHaveLength(1)

    await respond(requests.search[0], { data: [place('first', 'Marigoldmobile Pizza')], error: null })
    expect(requests.photos).toHaveLength(1)
    expect(screen.getByTestId('visible-places')).toHaveTextContent('Marigoldmobile Pizza')
    expect(screen.queryByText('Searching places')).not.toBeInTheDocument()

    await act(async () => {
      requests.counts.slice(4, 8).forEach(request => request.resolve({ count: 3, error: null }))
    })
    await advance(300)
    expect(requests.search).toHaveLength(1)
    expect(requests.photos).toHaveLength(1)
    expect(screen.getByTestId('visible-places')).toHaveTextContent('Marigoldmobile Pizza')

    // An older photo response must not replace a subsequently selected query.
    fireEvent.change(screen.getByRole('combobox', { name: 'Search places' }), { target: { value: 'cobaltmobile' } })
    await advance(301)
    await advance(251)
    expect(requests.search).toHaveLength(2)
    await respond(requests.search[1], { data: [place('second', 'Cobaltmobile Pizza')], error: null })
    expect(screen.getByTestId('visible-places')).toHaveTextContent('Cobaltmobile Pizza')
    await respond(requests.photos[0], { data: [], error: null })
    expect(screen.getByTestId('visible-places')).toHaveTextContent('Cobaltmobile Pizza')
    expect(screen.getByTestId('visible-places')).not.toHaveTextContent('Marigoldmobile Pizza')
  })

  test('uses a region loaded during the request as fallback without restarting the query', async () => {
    window.history.replaceState({}, '', '/?q=cedarmobile')
    render(<App />)
    await advance(251)
    expect(requests.search).toHaveLength(1)

    await act(async () => {
      requests.counts.slice(0, 4).forEach(request => request.resolve({ count: 2, error: null }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load available region' }))
    await advance(0)
    expect(requests.regions).toHaveLength(1)
    await respond(requests.regions[0], { data: [place('local', 'Cedarmobile Pizza', requests.regions[0].state)], error: null })
    await advance(300)
    expect(requests.search).toHaveLength(1)

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await respond(requests.search[0], { data: null, error: { message: 'Lookup rejected' } })
      expect(screen.getByTestId('visible-places')).toHaveTextContent('Cedarmobile Pizza')
      expect(screen.getByText('Search is temporarily unavailable. Showing places already loaded on the map.')).toBeInTheDocument()
      expect(requests.search).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})
