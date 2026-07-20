import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPhotosPanel from './AdminPhotosPanel'

jest.mock('../utils/uploadPhoto', () => ({
  isSupportedReviewPhotoFile: jest.fn(() => true),
  getUnsupportedReviewPhotoMessage: jest.fn(() => 'Unsupported photo'),
}))

const response = payload => ({
  ok: true,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
})

const reviews = [
  { id: 1, name: 'Ann Arbor Pizza', state: 'MI', address: '1 Main St', photos: [] },
  { id: 2, name: 'Detroit Pizza', state: 'MI', address: '2 Woodward Ave', photos: [{ id: 'existing', publicUrl: 'https://example.com/existing.webp' }] },
]

describe('AdminPhotosPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url, options = {}) => {
      if (url === '/api/admin/reviews?entity=pizza') return response({ data: reviews })
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => jest.restoreAllMocks())

  test('searches reviewed places and exposes the accessible file picker', async () => {
    render(<AdminPhotosPanel entity="pizza" />)

    expect(await screen.findByRole('heading', { name: 'Ann Arbor Pizza' })).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Find reviewed place' })
    await userEvent.type(search, 'Detroit')
    expect(await screen.findByRole('heading', { name: 'Detroit Pizza' })).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.click(screen.getByRole('button', { name: /Ann Arbor Pizza/i }))
    const picker = screen.getByRole('button', { name: 'Upload review photos' })
    expect(picker).toBeInTheDocument()
    expect(screen.getByLabelText('Choose review photos')).toHaveAttribute('accept', 'image/*,.heic,.heif')
  })
})
