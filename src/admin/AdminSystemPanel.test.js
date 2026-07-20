import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminSystemPanel from './AdminSystemPanel'

const jsonResponse = data => ({ ok: true, json: async () => ({ data }) })

describe('AdminSystemPanel lifecycle actions', () => {
  let fetchMock

  beforeEach(() => {
    window.location.hash = '#lifecycle-quality'
    fetchMock = jest.fn((url, options = {}) => {
      if (options.method === 'PATCH') return Promise.resolve(jsonResponse({ id: 42, lifecycle_status: 'closed' }))
      if (url.includes('/source-provenance')) {
        return Promise.resolve(jsonResponse({
          database: { available: true, sourceCounts: [], matchMethods: [] },
          fsqSample: {},
        }))
      }
      if (url.includes('/source-review-summary')) {
        return Promise.resolve(jsonResponse({ lifecycle: { replacements: 0, staleEvidence: 1, stalePlaces: 1, closedSignals: 0 } }))
      }
      if (url.includes('/lifecycle-candidates')) {
        return Promise.resolve(jsonResponse({
          available: true,
          total: 1,
          rows: [{
            place_id: 42,
            name: 'Old Town Pizza',
            source: 'osm',
            retrieved_at: '2025-01-01T00:00:00Z',
            freshness_days: 30,
          }],
        }))
      }
      if (url.includes('/import-preflight')) {
        return Promise.resolve(jsonResponse({ acceptedTotal: 0, candidateReady: 0, rowsInspected: 0, rowsNotInspected: 0, candidates: [] }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    global.fetch = fetchMock
  })

  afterEach(() => {
    window.location.hash = ''
    jest.restoreAllMocks()
  })

  test('does not turn stale evidence into a closure decision', async () => {
    render(<AdminSystemPanel entity="pizza" />)

    const lifecycleSelect = await screen.findByRole('combobox')
    await userEvent.selectOptions(lifecycleSelect, 'stale')
    expect(await screen.findByText('Old Town Pizza')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark closed' })).not.toBeInTheDocument()
    expect(screen.getByText(/refresh evidence before making a lifecycle decision/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, options]) => options?.method === 'PATCH' && String(url).includes('/api/admin/places/'))).toBe(false)
  })

  test('shows closed source signals as a review-only lifecycle category', async () => {
    render(<AdminSystemPanel entity="pizza" />)

    const lifecycleSelect = await screen.findByRole('combobox')
    await userEvent.selectOptions(lifecycleSelect, 'closed')

    expect(await screen.findByRole('button', { name: 'Mark closed' })).toBeInTheDocument()
    expect(await screen.findByText('Old Town Pizza')).toBeInTheDocument()
  })

  test('explains that lifecycle decisions publish through the guarded sync', async () => {
    render(<AdminSystemPanel entity="pizza" />)

    const lifecycleSelect = await screen.findByRole('combobox')
    await userEvent.selectOptions(lifecycleSelect, 'closed')
    await userEvent.click(await screen.findByRole('button', { name: 'Mark closed' }))
    expect(await screen.findByText(/included in the next guarded supabase sync/i)).toBeInTheDocument()
  })

  test('opens the approved import section from its deep link', async () => {
    window.location.hash = '#approved-import'
    render(<AdminSystemPanel entity="pizza" />)

    await screen.findByText('Approved-place import')
    expect(await screen.findByRole('button', { name: 'Import 0 ready' })).toBeDisabled()
  })
})
