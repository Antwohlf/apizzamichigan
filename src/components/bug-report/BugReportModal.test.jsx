import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BugReportModal } from './BugReportModal'

const selectedPlace = {
  id: 123,
  name: 'Context Pizza',
  google_place_id: 'ChIJ12345678',
  address: '123 Main St',
  city: 'Detroit',
  state: 'MI',
  type: 'pizza',
  style: 'Detroit',
  price_range: '$$',
  status: 'visited',
  rating: 8.7,
  lat: 42.3314,
  lng: -83.0458,
}

describe('BugReportModal', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('shows rich selected-place context and a Google Maps link', () => {
    render(
      <BugReportModal
        onClose={jest.fn()}
        selectedPlace={selectedPlace}
      />
    )

    const selectedPlaceDetails = screen.getByText(/Name: Context Pizza/)
    expect(selectedPlaceDetails).toHaveTextContent('Type: pizza')
    expect(selectedPlaceDetails).toHaveTextContent('Style: Detroit')
    expect(selectedPlaceDetails).toHaveTextContent('Price: $$')
    expect(selectedPlaceDetails).toHaveTextContent('Rating: 8.7')
    expect(selectedPlaceDetails).toHaveTextContent('Status: visited')
    expect(selectedPlaceDetails).toHaveTextContent('Coordinates: 42.331400, -83.045800')
    expect(screen.getByRole('link', { name: /open selected place in google maps/i })).toHaveAttribute(
      'href',
      expect.stringContaining('query_place_id=ChIJ12345678')
    )
  })

  test('submits rich selected-place context in the bug report payload', async () => {
    const onSuccess = jest.fn()
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    render(
      <BugReportModal
        onClose={jest.fn()}
        onSuccess={onSuccess}
        selectedPlace={selectedPlace}
      />
    )

    fireEvent.change(screen.getByLabelText(/what went wrong/i), {
      target: { value: 'The selected popup photo layout looks wrong.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send report/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.selectedPlace).toMatchObject({
      id: 123,
      name: 'Context Pizza',
      type: 'pizza',
      style: 'Detroit',
      price_range: '$$',
      status: 'visited',
      rating: 8.7,
      lat: 42.3314,
      lng: -83.0458,
    })
    expect(body.mapsUrl).toContain('query_place_id=ChIJ12345678')
  })

  test('preserves replacement context in a report about a historical place', async () => {
    const onSuccess = jest.fn()
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    render(
      <BugReportModal
        onClose={jest.fn()}
        onSuccess={onSuccess}
        selectedPlace={{
          ...selectedPlace,
          lifecycle_status: 'replaced',
          lifecycle_replaced_by_id: 456,
        }}
      />
    )

    fireEvent.change(screen.getByLabelText(/what went wrong/i), {
      target: { value: 'This historical place points to the wrong successor.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send report/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.selectedPlace).toMatchObject({
      lifecycle_status: 'replaced',
      lifecycle_replaced_by_id: 456,
    })
  })
})
