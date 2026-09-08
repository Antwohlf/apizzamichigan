import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminSystemPanel, { syncHumanSummary } from './AdminSystemPanel'

const jsonResponse = data => ({ ok: true, json: async () => ({ data }) })

describe('syncHumanSummary', () => {
  test('turns a missing bulk migration into a plain-language action', () => {
    expect(syncHumanSummary({ state: 'blocked', bulkRpc: { state: 'migration_missing' } })).toEqual(expect.objectContaining({
      title: 'Publishing is paused',
      tone: 'blocked',
      detail: expect.stringContaining('supabase-bulk-sync-rpc-migration.sql'),
    }))
  })

  test('describes a ready publication path without exposing infrastructure terms', () => {
    expect(syncHumanSummary({ state: 'ready', bulkRpc: { state: 'ready' } })).toEqual(expect.objectContaining({
      title: 'Public map is ready to update',
      tone: 'ready',
    }))
  })

  test('presents the external compatibility publisher state without claiming local readiness', () => {
    expect(syncHumanSummary({
      state: 'succeeded',
      label: 'Last publish succeeded',
      detail: 'The external Pizza compatibility publisher completed successfully.',
    })).toEqual({
      title: 'Last publish succeeded',
      detail: 'The external Pizza compatibility publisher completed successfully.',
      tone: 'ready',
    })

    expect(syncHumanSummary({
      state: 'not_configured',
      label: 'External status not configured',
      detail: 'Taco publication runs externally; configure the status root.',
    })).toEqual(expect.objectContaining({
      title: 'External status not configured',
      detail: expect.stringContaining('runs externally'),
      tone: 'unknown',
    }))
  })
})

describe('AdminSystemPanel lifecycle actions', () => {
  let fetchMock
  let preflightPayload

  beforeEach(() => {
    window.location.hash = '#lifecycle-quality'
    preflightPayload = { acceptedTotal: 0, candidateReady: 0, rowsInspected: 0, rowsNotInspected: 0, readinessCounts: [], candidates: [] }
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
          latest_input_observation_counts: { observed: 0, unobserved: 1, unavailable: 0 },
          rows: [{
            place_id: 42,
            name: 'Old Town Pizza',
            source: 'osm',
            source_url: 'https://www.openstreetmap.org/node/42',
            retrieved_at: '2025-01-01T00:00:00Z',
            freshness_days: 30,
            latest_input_observation: 'unobserved_in_latest_input',
          }],
        }))
      }
      if (url.includes('/import-preflight')) {
        return Promise.resolve(jsonResponse(preflightPayload))
      }
      if (url.includes('/source-review-conflicts')) {
        return Promise.resolve({ ok: true, json: async () => ({
          available: true,
          total: 1,
          data: [{
            id: 7,
            source: 'all_the_places',
            source_name: 'New chain listing',
            source_id: 'new-7',
            source_url: 'https://example.com/new-7',
            conflict_id: 8,
            conflict_source_name: 'Existing chain listing',
            conflict_distance_m: 0,
          }],
        }) })
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
    expect(screen.getByText(/1 stale row were not seen in the latest OSM refresh/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View place' })).toHaveAttribute('href', '/places/42')
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://www.openstreetmap.org/node/42')
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

  test('renders configured coverage regions instead of a fixed Michigan/New York list', async () => {
    window.location.hash = ''
    fetchMock.mockImplementation((url, options = {}) => {
      if (options.method === 'PATCH') return Promise.resolve(jsonResponse({ id: 42 }))
      if (url.includes('/source-provenance')) return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      if (url.includes('/source-review-summary')) {
        return Promise.resolve(jsonResponse({
          lifecycle: {},
          basicFieldCoverage: {
            scope: ['MI', 'CA'],
            overall: { total: 2, needsAttention: 1, missing: { address: 0, website_url: 1, phone: 0, style: 0, price_range: 0 } },
            byState: {
              MI: { total: 1, needsAttention: 0, missing: {} },
              CA: { total: 1, needsAttention: 1, missing: { website_url: 1 } },
            },
          },
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText('California')).toBeInTheDocument()
    expect(screen.getByText('Michigan')).toBeInTheDocument()
    expect(screen.queryByText('New York')).not.toBeInTheDocument()
  })

  test('explains same-source coordinate conflicts before import', async () => {
    preflightPayload = {
      acceptedTotal: 20,
      candidateReady: 0,
      rowsInspected: 20,
      rowsNotInspected: 0,
      readinessCounts: [{ readiness: 'duplicate_accepted_source_coordinate', rows: 2 }],
      candidates: [],
    }
    window.location.hash = '#approved-import'
    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText(/2 approved records overlap another record from the same source/i)).toBeInTheDocument()
  })

  test('shows accepted conflict pairs without offering an automatic data change', async () => {
    preflightPayload = {
      acceptedTotal: 2,
      candidateReady: 0,
      rowsInspected: 2,
      rowsNotInspected: 0,
      readinessCounts: [{ readiness: 'duplicate_accepted_source_coordinate', rows: 1 }],
      candidates: [],
    }
    window.location.hash = '#approved-import'
    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText('New chain listing')).toBeInTheDocument()
    expect(screen.getByText('Existing chain listing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.com/new-7')
    expect(screen.queryByRole('button', { name: /link|update|import new chain/i })).not.toBeInTheDocument()
  })

  test('shows pending publication updates separately from protected conflicts', async () => {
    window.location.hash = ''
    fetchMock.mockImplementation((url, options = {}) => {
      if (url.includes('/source-provenance')) {
        return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      }
      if (url.includes('/source-review-summary')) {
        return Promise.resolve(jsonResponse({ lifecycle: {} }))
      }
      if (url.includes('/supabase-sync-readiness')) {
        return Promise.resolve(jsonResponse({
          state: 'blocked',
          label: 'Blocked by Supabase setup',
          detail: 'Apply the bulk sync migration before publishing.',
          pendingAfterCheckpoint: 40,
          wouldUpdate: 40,
          protectedFieldConflicts: 6,
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText(/40 local updates waiting/i)).toBeInTheDocument()
    expect(screen.getByText(/6 protected-field conflicts need review/i)).toBeInTheDocument()
  })

  test('shows the last scheduled sync outcome in plain language', async () => {
    window.location.hash = ''
    fetchMock.mockImplementation((url, options = {}) => {
      if (url.includes('/source-provenance')) return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      if (url.includes('/source-review-summary')) return Promise.resolve(jsonResponse({ lifecycle: {} }))
      if (url.includes('/supabase-sync-readiness')) {
        return Promise.resolve(jsonResponse({
          state: 'nothing_waiting',
          label: 'Nothing waiting',
          detail: 'Local and public data are caught up.',
          lastRun: {
            state: 'failed',
            finished_at: '2026-07-25T12:00:00.000Z',
            reason: 'Supabase credentials are unavailable in .env.local',
          },
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText(/Last sync failed/i)).toBeInTheDocument()
    expect(screen.getByText(/Supabase credentials are unavailable/i)).toBeInTheDocument()
  })

  test('shows semantic classification backlog separately from queue health', async () => {
    window.location.hash = '#pipeline-status'
    fetchMock.mockImplementation((url, options = {}) => {
      if (url.includes('/source-provenance')) return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      if (url.includes('/source-review-summary')) return Promise.resolve(jsonResponse({ lifecycle: {} }))
      if (url.includes('/pipeline-status')) {
        return Promise.resolve(jsonResponse({
          available: true,
          state: 'ok',
          label: 'Pipeline healthy',
              classifier: {
                backlog: {
                  candidates: 2202,
                  retryablePartial: 2014,
                  exhaustedPartial: 188,
                  state: 'partial_retry_pending',
                  estimatedDays: 5.734375,
                  estimatedHours: 137.625,
                },
          },
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText('Records still need enrichment')).toBeInTheDocument()
    expect(screen.getByText('2,202')).toBeInTheDocument()
    expect(screen.getByText('5.7 days at current rate')).toBeInTheDocument()
    expect(screen.getByText('2,014 partial results are ready for a bounded retry pass.')).toBeInTheDocument()
    expect(screen.getByText(/even when the job queue is empty/i)).toBeInTheDocument()
  })

  test('shows pipeline status even when service-client-backed source status fails', async () => {
    window.location.hash = '#pipeline-status'
    fetchMock.mockImplementation(url => {
      if (url.includes('/pipeline-status')) {
        return Promise.resolve(jsonResponse({
          available: true,
          state: 'ok',
          label: 'Pipeline boundary is readable',
          authorityLabel: 'Legacy runtime observation',
        }))
      }
      if (url.includes('/source-provenance')) {
        return Promise.resolve({ ok: false, text: async () => 'Supabase service role not configured' })
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByText('Pipeline boundary is readable')).toBeInTheDocument()
    expect(screen.getByText(/Legacy runtime observation/i)).toBeInTheDocument()
    expect(screen.getByText(/Supabase service role not configured/i)).toBeInTheDocument()
  })

  test('shows source freshness from the pipeline snapshot', async () => {
    window.location.hash = '#pipeline-status'
    fetchMock.mockImplementation((url, options = {}) => {
      if (url.includes('/source-provenance')) return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      if (url.includes('/source-review-summary')) return Promise.resolve(jsonResponse({ lifecycle: {} }))
      if (url.includes('/pipeline-status')) {
        return Promise.resolve(jsonResponse({
          available: true,
          state: 'ok',
          label: 'Pipeline healthy',
          freshness: [{ source: 'osm', fresh_ratio_percent: 96.5, stale_rows: 12, eligible_rows: 840 }],
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    expect(await screen.findByRole('table', { name: /source freshness from the imac pipeline/i })).toBeInTheDocument()
    expect(screen.getByText('OpenStreetMap')).toBeInTheDocument()
    expect(screen.getByText('96.5%')).toBeInTheDocument()
    expect(screen.getByText('840')).toBeInTheDocument()
  })

  test('distinguishes a stopped source feeder from a healthy classifier', async () => {
    window.location.hash = '#pipeline-status'
    fetchMock.mockImplementation((url, options = {}) => {
      if (url.includes('/source-provenance')) return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      if (url.includes('/source-review-summary')) return Promise.resolve(jsonResponse({ lifecycle: {} }))
      if (url.includes('/pipeline-status')) {
        return Promise.resolve(jsonResponse({
          available: true,
          state: 'fail',
          label: 'Pipeline needs repair',
          sourcePipeline: {
            scheduler: {
              state: 'not_found',
              detail: 'The source pipeline launchd job is not loaded for the current user.',
            },
          },
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Source feeder:\s*Not loaded/i))
    expect(screen.getByRole('status')).toHaveTextContent(/launchd job is not loaded/i)
  })

  test('describes a loaded short-lived source feeder as idle between runs', async () => {
    window.location.hash = '#pipeline-status'
    fetchMock.mockImplementation((url, options = {}) => {
      if (url.includes('/source-provenance')) return Promise.resolve(jsonResponse({ database: { available: true, sourceCounts: [], matchMethods: [] } }))
      if (url.includes('/source-review-summary')) return Promise.resolve(jsonResponse({ lifecycle: {} }))
      if (url.includes('/pipeline-status')) {
        return Promise.resolve(jsonResponse({
          available: true,
          state: 'ok',
          label: 'Pipeline healthy',
          sourcePipeline: {
            scheduler: {
              state: 'idle',
              detail: 'The source pipeline launchd job is loaded and waiting for its next scheduled run.',
            },
          },
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<AdminSystemPanel entity="pizza" />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Source feeder:\s*Loaded and idle/i))
    expect(screen.getByRole('status')).toHaveTextContent(/loaded and waiting/i)
  })
})
