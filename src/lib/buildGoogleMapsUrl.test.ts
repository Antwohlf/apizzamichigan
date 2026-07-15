import { buildGoogleMapsUrl, isGooglePlaceId } from './buildGoogleMapsUrl'

describe('buildGoogleMapsUrl', () => {
  test('uses verified Google Place IDs directly', () => {
    expect(buildGoogleMapsUrl({ google_place_id: 'ChIJ123' })).toBe(
      'https://www.google.com/maps/place/?q=place_id:ChIJ123'
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
})
