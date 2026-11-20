import { fireEvent, render, screen } from '@testing-library/react'
import { StatsPanel } from './StatsPanel'
import { readSupabase } from '../lib/supabaseRead'
import { loadMapSummary } from '../lib/mapSummary'

jest.mock('../supabaseClient')
jest.mock('../lib/supabaseRead')
jest.mock('../lib/mapSummary', () => ({
  ...jest.requireActual('../lib/mapSummary'),
  loadMapSummary: jest.fn(),
}))

const row = (overrides = {}) => ({ state: 'MI', status: 'unvisited', lifecycle_status: null, rating: null, place_count: 12, ...overrides })

beforeEach(() => {
  loadMapSummary.mockReset()
  readSupabase.mockReset()
})

afterEach(() => jest.restoreAllMocks())

test('shows a recoverable error without launching old scans after summary failure', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  loadMapSummary.mockRejectedValue({ code: '57014', message: 'statement timeout' })
  render(<StatsPanel variant="compact" />)
  expect(await screen.findByRole('status')).toHaveTextContent('Statistics are temporarily unavailable')
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  expect(readSupabase).not.toHaveBeenCalled()

  loadMapSummary.mockResolvedValueOnce([
    row({ place_count: 1234 }), row({ status: 'visited', rating: 8, place_count: 1 }),
    row({ status: 'golden', rating: 9, place_count: 1 }),
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Retry statistics' }))
  expect(await screen.findByText('1,234')).toBeInTheDocument()
  expect(screen.getByText('8.5')).toBeInTheDocument()
  expect(loadMapSummary).toHaveBeenLastCalledWith('pizza_places', { force: true })
})

test('does not refetch when the same scope is passed in a new array', async () => {
  loadMapSummary.mockResolvedValue([row({ status: 'visited', rating: 8, place_count: 2 })])
  const { rerender } = render(<StatsPanel states={['MI']} variant="compact" />)
  expect(await screen.findByText('8.0')).toBeInTheDocument()
  expect(loadMapSummary).toHaveBeenCalledTimes(1)
  rerender(<StatsPanel states={['MI']} variant="compact" />)
  expect(loadMapSummary).toHaveBeenCalledTimes(1)
})

test.each(['PGRST202', '42883'])('uses direct legacy queries only for a missing RPC (%s)', async code => {
  loadMapSummary.mockRejectedValue({ code, message: 'Function unavailable' })
  readSupabase.mockResolvedValueOnce({ count: 4321, error: null })
    .mockResolvedValueOnce({ data: [{ rating: 6 }, { rating: 8 }], error: null })
  render(<StatsPanel variant="compact" />)
  expect(await screen.findByText('4,321')).toBeInTheDocument()
  expect(screen.getByText('7.0')).toBeInTheDocument()
  expect(readSupabase).toHaveBeenCalledTimes(2)
})

test('applies the requested state scope to weighted summary statistics', async () => {
  loadMapSummary.mockResolvedValue([
    row({ status: 'VISITED', rating: 8, place_count: 3 }),
    row({ status: 'golden pick', rating: 10, place_count: 1 }),
    row({ state: 'NY', status: 'visited', rating: 0, place_count: 100 }),
  ])
  render(<StatsPanel states={['MI']} variant="compact" />)
  expect(await screen.findByText('8.5')).toBeInTheDocument()
  expect(screen.getByText('4')).toBeInTheDocument()
  expect(readSupabase).not.toHaveBeenCalled()
})
