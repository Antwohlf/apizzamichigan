import { render, screen, within } from '@testing-library/react'
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

describe('AdminReviewsPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async url => {
      if (url === '/api/admin/check') {
        return {
          ok: true,
          json: async () => ({ authorized: true }),
        }
      }
      if (url === '/api/admin/reviews?entity=pizza') {
        return {
          ok: true,
          json: async () => ({ data: reviewRows }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('shows a compact matching-review selector and renders only the selected editor', async () => {
    render(<AdminReviewsPage />)

    expect(await screen.findByRole('heading', { name: /review photos/i })).toBeInTheDocument()
    expect(await screen.findByText('3/3')).toBeInTheDocument()

    const matchingReviews = screen.getByLabelText(/matching reviews/i)
    expect(within(matchingReviews).getByRole('button', { name: /l'industrie pizza/i })).toBeInTheDocument()
    expect(within(matchingReviews).getByRole('button', { name: /buddy’s pizza/i })).toBeInTheDocument()
    expect(within(matchingReviews).getByRole('button', { name: /pizza house/i })).toBeInTheDocument()

    expect(screen.getByRole('heading', { level: 3, name: /l'industrie pizza/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: /buddy’s pizza/i })).not.toBeInTheDocument()

    userEvent.click(within(matchingReviews).getByRole('button', { name: /buddy’s pizza/i }))

    expect(await screen.findByRole('heading', { level: 3, name: /buddy’s pizza/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: /l'industrie pizza/i })).not.toBeInTheDocument()
  })

  test('shows the current editing target and supports stepping through filtered reviews', async () => {
    render(<AdminReviewsPage />)

    expect(await screen.findByRole('heading', { name: /review photos/i })).toBeInTheDocument()
    expect(await screen.findByText('3/3')).toBeInTheDocument()

    const selectedReview = screen.getByLabelText(/selected review/i)
    expect(within(selectedReview).getByText(/editing 1 of 3 matching reviews/i)).toBeInTheDocument()
    expect(within(selectedReview).getByRole('heading', { name: /l'industrie pizza/i })).toBeInTheDocument()
    expect(within(selectedReview).getByText(/104 christopher st, ny/i)).toBeInTheDocument()
    expect(within(selectedReview).getByText(/new york · \$\$ · 1\/10 photos/i)).toBeInTheDocument()

    userEvent.click(within(selectedReview).getByRole('button', { name: /next/i }))

    const nextSelectedReview = await screen.findByLabelText(/selected review/i)
    expect(within(nextSelectedReview).getByText(/editing 2 of 3 matching reviews/i)).toBeInTheDocument()
    expect(within(nextSelectedReview).getByRole('heading', { name: /buddy’s pizza/i })).toBeInTheDocument()
    expect(within(nextSelectedReview).getByText(/17125 conant st, mi/i)).toBeInTheDocument()
    expect(within(nextSelectedReview).getByText(/detroit · \$\$ · 0\/10 photos/i)).toBeInTheDocument()
  })
})
