import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminSuggestionsPanel from './AdminSuggestionsPanel'

const response = payload => ({
  ok: true,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
})

describe('AdminSuggestionsPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url, options = {}) => {
      if (url === '/api/admin/suggestions?entity=pizza&status=pending') {
        return response({ data: [{ id: 7, name: 'Neighborhood Pizza', formatted_address: 'Ann Arbor, MI', recommendation: 'Try the tavern cut' }] })
      }
      if (url === '/api/admin/suggestions/7/reject' && options.method === 'POST') {
        return response({ data: { id: 7, name: 'Neighborhood Pizza', status: 'rejected' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => jest.restoreAllMocks())

  test('uses an accessible rejection dialog with an optional reason', async () => {
    render(<AdminSuggestionsPanel entity="pizza" />)

    expect(await screen.findByRole('heading', { name: 'Neighborhood Pizza' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await screen.findByRole('dialog', { name: /reject neighborhood pizza/i })
    await userEvent.type(screen.getByRole('textbox'), 'Not a pizza place')
    await userEvent.click(screen.getByRole('button', { name: 'Reject suggestion' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/suggestions/7/reject',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Not a pizza place' }),
      }),
    ))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /reject neighborhood pizza/i })).not.toBeInTheDocument())
    expect(await screen.findByText('No suggestions in this view.')).toBeInTheDocument()
  })
})
