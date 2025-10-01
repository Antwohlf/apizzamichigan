import { render, screen, waitFor } from '@testing-library/react'

jest.mock('./supabaseClient', () => require('../__mocks__/supabaseClient.js'))
const mockFetchTacoPlaces = jest.fn(() => Promise.resolve({ data: [], error: null }))
jest.mock('./lib/supabase-tacos', () => ({
  fetchTacoPlaces: (...args) => mockFetchTacoPlaces(...args),
}))

import App from './App'
const { __mockFrom, __setMockTable, __resetMockData } = require('./supabaseClient')

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
    __resetMockData()
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

    await waitFor(() => expect(mockFetchTacoPlaces).toHaveBeenCalled())

    const cta = screen.getByRole('link', { name: /check out apizzamichigan/i })
    expect(cta).toHaveAttribute('href', '/')
  })
})
