type PlaceLike = {
  google_place_id?: string | null
  google_maps_url?: string | null
  name?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  lat?: number | string | null
  lng?: number | string | null
}

const GOOGLE_MAPS_BASE_URL = 'https://www.google.com/maps'
const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,}$/

export function isGooglePlaceId(value: string | null | undefined): boolean {
  const trimmed = value?.trim()
  if (!trimmed) {
    return false
  }

  if (trimmed.startsWith('osm:')) {
    return false
  }

  return GOOGLE_PLACE_ID_PATTERN.test(trimmed)
}

function safeGoogleMapsUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null
    }
    if (!/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname) && !/(^|\.)goo\.gl$/i.test(parsed.hostname)) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function coordinateQuery(lat: number | string | null | undefined, lng: number | string | null | undefined): string | null {
  const numericLat = typeof lat === 'number' ? lat : Number(lat)
  const numericLng = typeof lng === 'number' ? lng : Number(lng)

  if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
    return null
  }

  return `${numericLat},${numericLng}`
}

export function buildGoogleMapsUrl(place: PlaceLike | null | undefined): string {
  if (!place) {
    return GOOGLE_MAPS_BASE_URL
  }

  const { google_place_id, google_maps_url, name, address, city, state, lat, lng } = place

  const explicitMapsUrl = safeGoogleMapsUrl(google_maps_url)
  if (explicitMapsUrl) {
    return explicitMapsUrl
  }

  if (isGooglePlaceId(google_place_id)) {
    const trimmedPlaceId = google_place_id!.trim()
    const query = [name, address, city, state].filter(Boolean).join(' ').trim()
    const queryParam = query || coordinateQuery(lat, lng) || trimmedPlaceId
    return `${GOOGLE_MAPS_BASE_URL}/search/?api=1&query=${encodeURIComponent(queryParam)}&query_place_id=${encodeURIComponent(trimmedPlaceId)}`
  }

  const queryParts: string[] = []
  if (name) {
    queryParts.push(name)
  }
  if (address) {
    queryParts.push(address)
  }
  const cityState = [city, state].filter(Boolean).join(', ')
  if (cityState) {
    queryParts.push(cityState)
  }

  const query = queryParts.join(' ').trim() || coordinateQuery(lat, lng)
  if (!query) {
    return GOOGLE_MAPS_BASE_URL
  }

  return `${GOOGLE_MAPS_BASE_URL}/search/?api=1&query=${encodeURIComponent(query)}`
}
