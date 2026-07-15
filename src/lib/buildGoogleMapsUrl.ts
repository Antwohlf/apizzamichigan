type PlaceLike = {
  google_place_id?: string | null
  google_maps_url?: string | null
  name?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
}

export function isGooglePlaceId(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }

  return !value.startsWith('osm:')
}

export function buildGoogleMapsUrl(place: PlaceLike | null | undefined): string {
  if (!place) {
    return 'https://www.google.com/maps'
  }

  const { google_place_id, google_maps_url, name, address, city, state } = place

  if (isGooglePlaceId(google_place_id)) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(google_place_id)}`
  }

  if (google_maps_url) {
    return google_maps_url
  }

  const queryParts: string[] = []
  if (name) {
    queryParts.push(name)
  }
  if (address) {
    queryParts.push(address)
  } else {
    const cityState = [city, state].filter(Boolean).join(', ')
    if (cityState) {
      queryParts.push(cityState)
    }
  }

  const query = queryParts.join(' ').trim()
  if (!query) {
    return 'https://www.google.com/maps'
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
