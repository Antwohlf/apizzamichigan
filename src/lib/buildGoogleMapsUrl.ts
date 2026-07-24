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

function normalizeLocationPart(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function addressContainsPart(address: string | null | undefined, part: string | null | undefined): boolean {
  const normalizedAddress = normalizeLocationPart(address)
  const normalizedPart = normalizeLocationPart(part)
  if (!normalizedAddress || !normalizedPart) return false
  return ` ${normalizedAddress} `.includes(` ${normalizedPart} `)
}

function locationParts(place: PlaceLike): string[] {
  const address = String(place.address || '').trim()
  const parts = [place.address, place.city, place.state].map(value => String(value || '').trim()).filter(Boolean)
  if (!address) return parts
  return parts.filter((part, index) => index === 0 || !addressContainsPart(address, part))
}

export function buildGoogleMapsUrl(place: PlaceLike | null | undefined): string {
  if (!place) {
    return GOOGLE_MAPS_BASE_URL
  }

  const { google_place_id, google_maps_url, name, lat, lng } = place

  const explicitMapsUrl = safeGoogleMapsUrl(google_maps_url)
  if (explicitMapsUrl) {
    return explicitMapsUrl
  }

  if (isGooglePlaceId(google_place_id)) {
    const trimmedPlaceId = google_place_id!.trim()
    const query = [name, ...locationParts(place)].filter(Boolean).join(' ').trim()
    const queryParam = query || coordinateQuery(lat, lng) || trimmedPlaceId
    return `${GOOGLE_MAPS_BASE_URL}/search/?api=1&query=${encodeURIComponent(queryParam)}&query_place_id=${encodeURIComponent(trimmedPlaceId)}`
  }

  const queryParts: string[] = []
  if (name) {
    queryParts.push(name)
  }
  const places = locationParts(place)
  if (places.length) {
    if (place.address) {
      queryParts.push(places[0])
      if (places.length > 1) queryParts.push(places.slice(1).join(', '))
    } else {
      queryParts.push(places.join(', '))
    }
  }

  const query = queryParts.join(' ').trim() || coordinateQuery(lat, lng)
  if (!query) {
    return GOOGLE_MAPS_BASE_URL
  }

  return `${GOOGLE_MAPS_BASE_URL}/search/?api=1&query=${encodeURIComponent(query)}`
}
