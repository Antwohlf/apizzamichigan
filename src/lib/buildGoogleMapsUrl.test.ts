import { buildGoogleMapsUrl, isGooglePlaceId } from './buildGoogleMapsUrl'

describe('buildGoogleMapsUrl', () => {
  test('uses verified Google Place IDs directly', () => {
    expect(buildGoogleMapsUrl({
      google_place_id: 'ChIJ12345678',
      name: 'Pizza Place',
      address: '123 Main St',
      city: 'Detroit',
      state: 'MI',
    })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Pizza%20Place%20123%20Main%20St%20Detroit%20MI&query_place_id=ChIJ12345678'
    )
  })

  test('does not treat OSM IDs as Google Place IDs', () => {
    expect(isGooglePlaceId('osm:node/12064802655')).toBe(false)
    expect(buildGoogleMapsUrl({
      google_place_id: 'osm:node/12064802655',
      name: 'Piperno',
      address: 'Example Street',
    })).toBe('https://www.google.com/maps/search/?api=1&query=Piperno%20Example%20Street')
  })

  test('uses safe stored Google Maps URLs before constructing a search URL', () => {
    expect(buildGoogleMapsUrl({
      google_maps_url: 'https://www.google.com/maps/place/Test/@42,-83,12z',
      google_place_id: 'ChIJ12345678',
      name: 'Ignored Name',
    })).toBe('https://www.google.com/maps/place/Test/@42,-83,12z')
  })

  test('ignores unsafe stored URLs and non-Google external IDs', () => {
    expect(isGooglePlaceId('fsq:abc123')).toBe(false)
    expect(buildGoogleMapsUrl({
      google_maps_url: 'javascript:alert(1)',
      google_place_id: 'fsq:abc123',
      name: 'Source Pizza',
      city: 'Ann Arbor',
      state: 'MI',
    })).toBe('https://www.google.com/maps/search/?api=1&query=Source%20Pizza%20Ann%20Arbor%2C%20MI')
  })

  test('falls back to coordinates when no searchable identity text is available', () => {
    expect(buildGoogleMapsUrl({
      google_place_id: 'osm:node/12064802655',
      lat: 42.3314,
      lng: -83.0458,
    })).toBe('https://www.google.com/maps/search/?api=1&query=42.3314%2C-83.0458')
  })
})
