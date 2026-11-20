import { fireEvent, render, screen } from '@testing-library/react'
import { StatsPanel } from './StatsPanel'
import { readSupabase } from '../lib/supabaseRead'

jest.mock('../supabaseClient')
jest.mock('../lib/supabaseRead')

afterEach(() => jest.restoreAllMocks())

test('shows a recoverable error instead of zero places after a failed count', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  readSupabase.mockResolvedValue({ error: { message: 'Network unavailable' } })
  render(<StatsPanel variant="compact" />)
  expect(await screen.findByRole('status')).toHaveTextContent('Statistics are temporarily unavailable')
  expect(screen.queryByText('0')).not.toBeInTheDocument()

  readSupabase.mockResolvedValueOnce({ count: 1234, error: null })
    .mockResolvedValueOnce({ data: [{ rating: 8 }, { rating: 9 }], error: null })
  fireEvent.click(screen.getByRole('button', { name: 'Retry statistics' }))
  expect(await screen.findByText('1,234')).toBeInTheDocument()
  expect(screen.getByText('8.5')).toBeInTheDocument()
})

test('does not refetch when the same scope is passed in a new array', async () => {
  readSupabase.mockReset().mockResolvedValue({ count: 2, data: [{ rating: 8 }], error: null })
  const { rerender } = render(<StatsPanel states={['MI']} variant="compact" />)
  expect(await screen.findByText('8.0')).toBeInTheDocument()
  expect(readSupabase).toHaveBeenCalledTimes(2)
  rerender(<StatsPanel states={['MI']} variant="compact" />)
  expect(readSupabase).toHaveBeenCalledTimes(2)
})
