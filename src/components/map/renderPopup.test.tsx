import { act } from 'react'
import { screen } from '@testing-library/react'
import { renderExpanded, teardownPopup } from './renderPopup'

describe('renderExpanded', () => {
  let node: HTMLDivElement

  beforeEach(() => {
    node = document.createElement('div')
    document.body.appendChild(node)
  })

  afterEach(() => {
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      teardownPopup(node)
    })
    node.remove()
  })

  test('renders review photo thumbnails when photos are present', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Gallery Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          style: 'Detroit',
          price_range: '$$',
          photos: [
            {
              id: 'photo-1',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/pie.webp',
              sortOrder: 1,
            },
          ],
        },
        jest.fn()
      )
    })

    const thumbnailButton = screen.getByRole('button', { name: /open photo 1 for gallery pizza/i })
    expect(thumbnailButton).toBeInTheDocument()
    expect(screen.getByTestId('review-gallery-thumbnail')).toHaveAttribute(
      'src',
      expect.stringContaining('width=480&quality=70&format=webp')
    )
  })
})
