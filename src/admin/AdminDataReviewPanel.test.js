import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminDataReviewPanel from './AdminDataReviewPanel'

const queueRows = [
  {
    id: 11,
    review_kind: 'ambiguous',
    review_readiness: 'link_review',
    source: 'osm',
    source_id: 'osm:node/11',
    source_name: 'Source Pizza',
    source_data: {
      address: '123 Main St, Ann Arbor, MI',
      lat: 42.2,
      lng: -83.7,
    },
    nearest_place_id: 101,
    nearest_place_name: 'Canonical Pizza',
    nearest_address: '123 Main St, Ann Arbor, MI',
    nearest_lat: 42.2,
    nearest_lng: -83.7,
    nearest_distance_m: 0,
  },
  {
    id: 12,
    review_kind: 'ambiguous',
    review_readiness: 'link_review',
    source: 'osm',
    source_id: 'osm:node/12',
    source_name: 'Second Pizza',
    source_data: {
      address: '456 State St, Ann Arbor, MI',
      lat: 42.3,
      lng: -83.8,
    },
    nearest_place_id: 102,
    nearest_place_name: 'Second Canonical',
    nearest_address: '456 State St, Ann Arbor, MI',
    nearest_lat: 42.3,
    nearest_lng: -83.8,
    nearest_distance_m: 0,
  },
]

const response = payload => ({
  ok: true,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
})

describe('AdminDataReviewPanel', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/admin/reviews/data?entity=pizza&queue=matches')
    global.fetch = jest.fn(async (url, options = {}) => {
      if (String(url).startsWith('/api/admin/source-review-summary')) {
        return response({ data: { queues: { matchExisting: 2 } } })
      }
      if (String(url).startsWith('/api/admin/source-review-queue?')) {
        return response({ data: queueRows, total: 2 })
      }
      if (url === '/api/admin/source-review-queue/11' && options.method === 'PATCH') {
        return response({ data: { ...queueRows[0], status: 'linked' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('shows one comparison and skip advances without a write', async () => {
    render(<AdminDataReviewPanel entity="pizza" />)

    expect(await screen.findByRole('heading', { name: 'Source Pizza' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Second Pizza' })).not.toBeInTheDocument()

    userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByRole('heading', { name: 'Second Pizza' })).toBeInTheDocument()

    const writeCalls = global.fetch.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')
    expect(writeCalls).toHaveLength(0)
  })

  test('confirms a same-place decision before linking', async () => {
    render(<AdminDataReviewPanel entity="pizza" />)
    expect(await screen.findByRole('heading', { name: 'Source Pizza' })).toBeInTheDocument()

    userEvent.click(screen.getByRole('button', { name: 'Same place' }))
    expect(await screen.findByRole('dialog', { name: /confirm this is the same place/i })).toBeInTheDocument()
    expect(screen.getByText(/the map name will remain/i)).toHaveTextContent('Canonical Pizza')
    expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/source-review-queue/11', expect.objectContaining({ method: 'PATCH' }))

    userEvent.click(screen.getByRole('button', { name: /confirm same place/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/source-review-queue/11',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"status":"linked"'),
        })
      )
    })
  })

  test('offers an in-place business update for an unreviewed exact OSM match', async () => {
    const exactOsmRow = {
      ...queueRows[0],
      source_id: 'osm:way/11',
      source_name: 'Replacement Pizza',
      nearest_current_google_place_id: 'osm:way/11',
      nearest_status: 'unvisited',
      nearest_rating: null,
      nearest_notes: '',
    }
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (String(url).startsWith('/api/admin/source-review-summary')) return response({ data: { queues: { matchExisting: 1 } } })
      if (String(url).startsWith('/api/admin/source-review-queue?')) return response({ data: [exactOsmRow], total: 1 })
      if (url === '/api/admin/source-review-queue/11/update-existing' && options.method === 'PATCH') return response({ data: { ...exactOsmRow, status: 'linked' } })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<AdminDataReviewPanel entity="pizza" />)
    expect(await screen.findByRole('heading', { name: 'Replacement Pizza' })).toBeInTheDocument()
    userEvent.click(screen.getByRole('button', { name: 'Update existing place' }))
    expect(await screen.findByRole('dialog', { name: /confirm this business replaced the old one/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Same place' })).toBeInTheDocument()
    userEvent.click(screen.getByRole('button', { name: /update to replacement pizza/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/source-review-queue/11/update-existing',
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })
})
