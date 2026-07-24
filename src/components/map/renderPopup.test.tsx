import { act } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { displayPopupStyle, renderExpanded, teardownPopup } from './renderPopup'
import { REVIEW_LIGHTBOX_CLOSE_EVENT, REVIEW_LIGHTBOX_OPEN_EVENT } from '../ReviewGallery'

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

  test('links places without a legacy href to the public detail route', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Routeable Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
        },
        jest.fn()
      )
    })

    expect(screen.getByRole('link', { name: /view place details/i })).toHaveAttribute(
      'href',
      '/places/123'
    )
  })

  test('runs the return-state hook before navigating to place details', () => {
    const onDetailsNavigate = jest.fn()
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Returnable Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
        },
        jest.fn(),
        onDetailsNavigate
      )
    })

    fireEvent.click(screen.getByRole('link', { name: /view place details/i }))
    expect(onDetailsNavigate).toHaveBeenCalledTimes(1)
  })

  test('renders compact status and location details for expanded popups', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Reviewed Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          style: 'Detroit',
          price_range: '$$',
          status: 'visited',
          rating: 8.4,
          city: 'Detroit',
          state: 'MI',
          href: '/?poi=pizza:123',
        },
        jest.fn()
      )
    })

    expect(screen.getByText('Detroit')).toBeInTheDocument()
    expect(screen.getByText('$$')).toBeInTheDocument()
    expect(screen.getByText('Anthony reviewed')).toBeInTheDocument()
    expect(screen.getByText('Detroit, MI')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view place details/i })).toHaveAttribute(
      'href',
      '/?poi=pizza:123'
    )
    expect(screen.getByRole('link', { name: /open in google maps/i })).toHaveAttribute(
      'href',
      expect.stringContaining('google.com/maps/search')
    )
  })

  test('exposes verified contact actions when public data includes them', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Contact Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          phone: '+1 734 555 0100',
          website_url: 'contactpizza.example.com',
          menu_url: 'https://contactpizza.example.com/menu',
          hours: { Monday: '11:00-22:00' },
        },
        jest.fn()
      )
    })

    expect(screen.getByRole('link', { name: '+1 734 555 0100' })).toHaveAttribute(
      'href',
      'tel:+1 734 555 0100'
    )
    expect(screen.getByRole('link', { name: /official website/i })).toHaveAttribute(
      'href',
      'https://contactpizza.example.com/'
    )
    expect(screen.getByRole('link', { name: /menu/i })).toHaveAttribute(
      'href',
      'https://contactpizza.example.com/menu'
    )
    expect(screen.getByText('Hours: Monday: 11:00-22:00')).toBeInTheDocument()
  })

  test('does not render unsafe website values as popup links', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Unsafe Website Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          website_url: 'ftp://unsafe.example.com',
        },
        jest.fn()
      )
    })

    expect(screen.queryByRole('link', { name: /official website/i })).not.toBeInTheDocument()
  })

  test('preserves Anthony pick highlighting for pizza popups', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Anthony Pick Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          status: 'golden',
          rating: 9.2,
        },
        jest.fn()
      )
    })

    const dialog = screen.getByRole('dialog', { name: /anthony pick pizza details/i })
    expect(dialog).toHaveAttribute('data-favorited', 'true')
    expect(dialog).toHaveClass('popup-card--favorited', 'golden-glow')
    expect(screen.getByText("Anthony's Pick")).toBeInTheDocument()
  })

  test('explains historical locations and links to a replacement when available', () => {
    const onDetailsNavigate = jest.fn()
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Old Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          lifecycle_status: 'replaced',
          lifecycle_replaced_by_id: 456,
          lifecycle_replaced_by_name: 'Homeslice Pizzeria',
        },
        jest.fn(),
        onDetailsNavigate
      )
    })

    expect(screen.getByText('This business is no longer the current tenant at this address.')).toBeInTheDocument()
    expect(screen.getByText('Current place: Homeslice Pizzeria.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view current place/i })).toHaveAttribute(
      'href',
      '/places/456'
    )
    fireEvent.click(screen.getByRole('link', { name: /view current place/i }))
    expect(onDetailsNavigate).toHaveBeenCalledTimes(1)
  })

  test('keeps the replacement link for legacy camelCase lifecycle data', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Old Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          lifecycleStatus: 'replaced',
          lifecycleReplacedById: 789,
        },
        jest.fn()
      )
    })

    expect(screen.getByRole('link', { name: /view current place/i })).toHaveAttribute(
      'href',
      '/places/789'
    )
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

  test('shows photo loading and error states in the expanded viewer', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Slow Photo Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          photos: [
            {
              id: 'photo-1',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/slow.webp',
              sortOrder: 1,
            },
          ],
        },
        jest.fn()
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /open photo 1 for slow photo pizza/i }))

    expect(screen.getByRole('status')).toHaveTextContent('Loading photo')

    fireEvent.error(screen.getByAltText(/slow photo pizza detail 1 of 1/i))

    expect(screen.getByRole('alert')).toHaveTextContent('Photo failed to load')
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

  test('announces photo viewer open and close for map viewport preservation', () => {
    const openListener = jest.fn()
    const closeListener = jest.fn()
    window.addEventListener(REVIEW_LIGHTBOX_OPEN_EVENT, openListener)
    window.addEventListener(REVIEW_LIGHTBOX_CLOSE_EVENT, closeListener)

    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Viewport Pizza',
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

    fireEvent.click(screen.getByRole('button', { name: /open photo 1 for viewport pizza/i }))
    expect(openListener).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /close photo viewer/i }))
    expect(closeListener).toHaveBeenCalledTimes(1)

    window.removeEventListener(REVIEW_LIGHTBOX_OPEN_EVENT, openListener)
    window.removeEventListener(REVIEW_LIGHTBOX_CLOSE_EVENT, closeListener)
  })

  test('keeps popup galleries compact while preserving all lightbox photos', () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Many Photo Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          photos: [
            {
              id: 'photo-1',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/one.webp',
              sortOrder: 1,
            },
            {
              id: 'photo-2',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/two.webp',
              sortOrder: 2,
            },
            {
              id: 'photo-3',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/three.webp',
              sortOrder: 3,
            },
            {
              id: 'photo-4',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/four.webp',
              sortOrder: 4,
            },
            {
              id: 'photo-5',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/five.webp',
              sortOrder: 5,
            },
            {
              id: 'photo-6',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/six.webp',
              sortOrder: 6,
            },
          ],
        },
        jest.fn()
      )
    })

    expect(screen.getAllByTestId('review-gallery-thumbnail')).toHaveLength(4)
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open photo 4 for many photo pizza \(4 of 6\), 2 more photos/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open photo 1 for many photo pizza \(1 of 6\)/i }))
    expect(screen.getByRole('dialog', { name: /many photo pizza detail 1 of 6/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show photo 6/i }))

    expect(screen.getByRole('dialog', { name: /many photo pizza detail 6 of 6/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show photo 6/i })).toHaveAttribute('aria-current', 'true')
  })

  test('moves focus into the photo viewer and restores it to the opened thumbnail', async () => {
    // renderExpanded owns a detached React root outside Testing Library's render helper.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    act(() => {
      renderExpanded(
        node,
        {
          id: '123',
          name: 'Focused Pizza',
          lat: 42.1,
          lng: -83.1,
          type: 'pizza',
          photos: [
            {
              id: 'photo-1',
              publicUrl: 'https://example.com/storage/v1/object/public/review-photos/123/focused.webp',
              sortOrder: 1,
            },
          ],
        },
        jest.fn()
      )
    })

    const opener = screen.getByRole('button', { name: /open photo 1 for focused pizza/i })
    opener.focus()
    fireEvent.click(opener)

    const closeButton = screen.getByRole('button', { name: /close photo viewer/i })
    await waitFor(() => expect(closeButton).toHaveFocus())

    fireEvent.click(closeButton)

    await waitFor(() => expect(opener).toHaveFocus())
  })
})

describe('public popup labels', () => {
  test('uses the primary pizza style taxonomy', () => {
    expect(displayPopupStyle({ type: 'pizza', style: 'Chicago, Sicilian, New York' } as any)).toBe('Sicilian')
    expect(displayPopupStyle({ type: 'pizza', style: 'Unknown' } as any)).toBeNull()
  })

  test('preserves raw styles for non-pizza entities', () => {
    expect(displayPopupStyle({ type: 'taco', style: 'Regional' } as any)).toBe('Regional')
  })
})
