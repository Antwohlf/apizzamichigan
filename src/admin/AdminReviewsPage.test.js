import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminReviewsPage from './AdminReviewsPage'

const reviewRows = [
  {
    id: 101,
    name: "L'industrie Pizza",
    state: 'NY',
    address: '104 Christopher St',
    rating: 11,
    style: 'New York',
    price_range: '$$',
    photos: [{ id: 'photo-1', url: 'https://example.com/photo-1.jpg' }],
  },
  {
    id: 102,
    name: 'Buddy’s Pizza',
    state: 'MI',
    address: '17125 Conant St',
    rating: 9,
    style: 'Detroit',
    price_range: '$$',
    photos: [],
  },
  {
    id: 103,
    name: 'Pizza House',
    state: 'MI',
    address: '618 Church St',
    rating: 7,
    style: 'Traditional',
    price_range: '$',
    photos: [],
  },
]

const response = payload => ({
  ok: true,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
})

describe('AdminReviewsPage', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/admin/reviews?entity=pizza')
    global.fetch = jest.fn(async url => {
      if (url === '/api/admin/check') return response({ authorized: true })
      if (url === '/api/admin/source-review-summary?entity=pizza') {
        return response({
          data: {
            available: true,
            queues: {
              matchExisting: 12,
              checkDuplicates: 7,
              approveNew: 24,
              incomplete: 3,
              approvedForImport: 5,
            },
            linkedPlaces: 1200,
          },
        })
      }
      if (url === '/api/admin/reviews?entity=pizza') return response({ data: reviewRows })
      if (url === '/api/admin/suggestions?entity=pizza&status=pending') {
        return response({ data: [{ id: 1, name: 'Suggested Pizza' }] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('shows a concise task home with human-readable work queues', async () => {
    render(<AdminReviewsPage />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Work to do' })).toBeInTheDocument()

    const tasks = screen.getByRole('list')
    expect(within(tasks).getByText('Match source records to existing places')).toBeInTheDocument()
    expect(within(tasks).getByText('Check possible duplicates')).toBeInTheDocument()
    expect(within(tasks).getByText('Approve genuinely new places')).toBeInTheDocument()
    expect(within(tasks).getByText('Import approved places')).toBeInTheDocument()
    expect(within(tasks).getByText('Review community suggestions')).toBeInTheDocument()
    expect(within(tasks).getByText('Add missing review photos')).toBeInTheDocument()
    expect(await within(tasks).findByLabelText('24 remaining')).toBeInTheDocument()
  })

  test('shows a bounded photo result list and only one selected editor', async () => {
    window.history.replaceState({}, '', '/admin/reviews/photos?entity=pizza')
    render(<AdminReviewsPage />)

    expect(await screen.findByRole('heading', { name: /review photos/i })).toBeInTheDocument()
    const matchingReviews = await screen.findByLabelText(/matching reviewed places/i)
    expect(within(matchingReviews).getByRole('button', { name: /l'industrie pizza/i })).toBeInTheDocument()
    expect(within(matchingReviews).getByRole('button', { name: /buddy’s pizza/i })).toBeInTheDocument()

    const selectedReview = screen.getByLabelText(/selected review/i)
    expect(within(selectedReview).getByRole('heading', { name: /l'industrie pizza/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /buddy’s pizza/i })).not.toBeInTheDocument()

    userEvent.click(within(matchingReviews).getByRole('button', { name: /buddy’s pizza/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/selected review/i)).toHaveTextContent('Buddy’s Pizza')
    })
  })

  test('lets admins narrow the suggestion inbox before choosing a record', async () => {
    window.history.replaceState({}, '', '/admin/reviews/suggestions?entity=pizza')
    global.fetch = jest.fn(async url => {
      if (url === '/api/admin/check') return response({ authorized: true })
      if (url === '/api/admin/suggestions?entity=pizza&status=pending') {
        return response({ data: [
          { id: 1, name: 'Suggested Pizza', formatted_address: 'Ann Arbor, MI', user_name: 'Anthony' },
          { id: 2, name: 'Other Pizza', formatted_address: 'Detroit, MI', user_name: 'Guest' },
        ] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<AdminReviewsPage />)

    const search = await screen.findByRole('searchbox', { name: 'Find suggestion' })
    expect(await screen.findByRole('heading', { name: 'Suggested Pizza' })).toBeInTheDocument()
    userEvent.type(search, 'Detroit')

    expect(await screen.findByRole('heading', { name: 'Other Pizza' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Suggested Pizza' })).not.toBeInTheDocument()
  })
})
