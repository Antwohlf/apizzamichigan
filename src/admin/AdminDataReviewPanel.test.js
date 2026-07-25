import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminDataReviewPanel, { reviewSuggestionSource } from './AdminDataReviewPanel'
import { deterministicMatchEvidence } from './sourceReviewQueues'

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
  test('summarizes exact official-chain evidence without making the decision', () => {
    expect(deterministicMatchEvidence({
      source: 'all_the_places',
      source_name: 'Little Caesars',
      source_data: {
        website: 'https://littlecaesars.com/en-us/store/8742',
        phone: '(209) 466-5555',
        address: '2491 E. Fremont St., Stockton, CA',
      },
      nearest_place_name: 'Little Caesars',
      nearest_website_url: 'https://www.littlecaesars.com/en-us/store/8742/',
      nearest_phone: '+1 209-466-5555',
      nearest_address: '2491 E. Fremont St., Stockton, CA',
    })).toEqual(expect.objectContaining({
      kind: 'official_identifiers',
      title: 'Exact store details agree',
    }))
  })

  test('warns when exact OSM identity has a different business name', () => {
    expect(deterministicMatchEvidence({
      source: 'osm',
      source_id: 'osm:way/11',
      nearest_current_google_place_id: 'osm:way/11',
      source_name: 'Homeslice Pizzeria',
      nearest_place_name: 'Tunnel Pizza & Subs',
    })).toEqual(expect.objectContaining({
      kind: 'osm_identity',
      title: 'Same OpenStreetMap record',
    }))
  })

  test('labels deterministic and model suggestions distinctly', () => {
    expect(reviewSuggestionSource('deterministic')).toBe('Evidence-based suggestion')
    expect(reviewSuggestionSource('ollama')).toBe('AI review suggestion')
    expect(reviewSuggestionSource(null)).toBe('AI review suggestion')
  })

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

  test('debounces manual search while keeping the query URL-backed', async () => {
    render(<AdminDataReviewPanel entity="pizza" />)
    expect(await screen.findByRole('heading', { name: 'Source Pizza' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    const input = screen.getByRole('searchbox', { name: 'Search review queue' })
    const initialQueueCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/source-review-queue?')).length

    await userEvent.type(input, 'Cottage Inn')
    const immediateQueueCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/source-review-queue?')).length
    expect(immediateQueueCalls).toBe(initialQueueCalls)

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 300))
    })
    expect(window.location.search).toContain('q=Cottage+Inn')
    const finalQueueCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/source-review-queue?')).length
    expect(finalQueueCalls).toBe(initialQueueCalls + 1)
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

  test('lets keyboard users cancel the link confirmation with Escape', async () => {
    render(<AdminDataReviewPanel entity="pizza" />)
    expect(await screen.findByRole('heading', { name: 'Source Pizza' })).toBeInTheDocument()

    userEvent.click(screen.getByRole('button', { name: 'Same place' }))
    expect(await screen.findByRole('dialog', { name: /confirm this is the same place/i })).toBeInTheDocument()
    userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /confirm this is the same place/i })).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/source-review-queue/11', expect.objectContaining({ method: 'PATCH' }))
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

  test('offers a guarded replacement path for a reviewed exact OSM match', async () => {
    const replacementRow = {
      ...queueRows[0],
      source_id: 'osm:way/11',
      source_name: 'Homeslice Pizzeria',
      nearest_current_google_place_id: 'osm:way/11',
      nearest_status: 'visited',
      nearest_rating: 9,
      nearest_notes: 'Old visit history',
    }
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (String(url).startsWith('/api/admin/source-review-summary')) return response({ data: { queues: { matchExisting: 1 } } })
      if (String(url).startsWith('/api/admin/source-review-queue?')) return response({ data: [replacementRow], total: 1 })
      if (url === '/api/admin/source-review-queue/11/reclassify-replacement' && options.method === 'PATCH') return response({ data: { ...replacementRow, review_kind: 'likely_new' } })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<AdminDataReviewPanel entity="pizza" />)
    expect(await screen.findByRole('heading', { name: 'Homeslice Pizzeria' })).toBeInTheDocument()
    userEvent.click(screen.getByRole('button', { name: 'Business replaced' }))
    expect(await screen.findByRole('dialog', { name: /record a business replacement/i })).toBeInTheDocument()
    userEvent.click(screen.getByRole('button', { name: 'Record replacement' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/source-review-queue/11/reclassify-replacement',
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })
})
