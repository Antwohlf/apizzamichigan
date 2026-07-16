import { act } from 'react'
import { fireEvent, screen } from '@testing-library/react'
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
    expect(screen.getByRole('dialog', { name: /gallery pizza details/i })).toBeInTheDocument()
  })

  test('does not render an empty gallery wrapper without photos', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'No Photo Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          photos: [],
        },
        jest.fn()
      )
    })

    expect(screen.getByRole('dialog', { name: /no photo pizza details/i })).toBeInTheDocument()
    expect(screen.queryByTestId('review-gallery-thumbnail')).not.toBeInTheDocument()
  })

  test('opens and closes the photo viewer from a popup thumbnail', () => {
    const outsideClick = jest.fn()
    document.body.addEventListener('click', outsideClick)
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

    fireEvent.click(screen.getByRole('button', { name: /open photo 1 for gallery pizza/i }))
    expect(screen.getByRole('dialog', { name: /gallery pizza detail 1 of 1/i })).toBeInTheDocument()
    outsideClick.mockClear()

    fireEvent.click(screen.getByRole('dialog', { name: /gallery pizza detail 1 of 1/i }))
    expect(screen.queryByRole('dialog', { name: /gallery pizza detail 1 of 1/i })).not.toBeInTheDocument()
    expect(outsideClick).not.toHaveBeenCalled()
    document.body.removeEventListener('click', outsideClick)
  })

  test('does not bubble overlay dismissal to the underlying map page', () => {
    const outsideClick = jest.fn()
    document.body.addEventListener('click', outsideClick)
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Overlay Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
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

    fireEvent.click(screen.getByRole('button', { name: /open photo 1 for overlay pizza/i }))
    const dialog = screen.getByRole('dialog', { name: /overlay pizza detail 1 of 1/i })
    outsideClick.mockClear()

    fireEvent.click(dialog)

    expect(screen.queryByRole('dialog', { name: /overlay pizza detail 1 of 1/i })).not.toBeInTheDocument()
    expect(outsideClick).not.toHaveBeenCalled()
    document.body.removeEventListener('click', outsideClick)
  })
})
