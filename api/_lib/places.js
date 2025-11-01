const { isRateLimited } = require('./rateLimit')

const GOOGLE_PLACES_API_KEY =
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.REACT_APP_GOOGLE_GEOCODE_KEY ||
  process.env.VITE_GOOGLE_PLACES_API_KEY

const RATE_LIMIT_WINDOW_MS = Number(process.env.PLACES_RATE_LIMIT_WINDOW_MS || 60 * 1000)
const AUTOCOMPLETE_RATE_LIMIT = Number(process.env.PLACES_AUTOCOMPLETE_RATE_LIMIT || 35)
const DETAILS_RATE_LIMIT = Number(process.env.PLACES_DETAILS_RATE_LIMIT || 60)

function normalizeString(value) {
  return typeof value === 'string' ? value : ''
}

async function handleAutocomplete({ input, sessionToken, ip }) {
  if (!GOOGLE_PLACES_API_KEY) {
    return { status: 503, body: { error: 'Google Places API key not configured' } }
  }

  const trimmedInput = normalizeString(input).trim()
  if (!trimmedInput) {
    return { status: 400, body: { error: 'Missing input parameter' } }
  }
  if (trimmedInput.length < 2) {
    return { status: 200, body: { predictions: [] } }
  }

  const limiterKey = `${ip || 'unknown'}:autocomplete`
  if (isRateLimited(limiterKey, AUTOCOMPLETE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return { status: 429, body: { error: 'Too many autocomplete requests' } }
  }

  try {
    const params = new URLSearchParams({
      input: trimmedInput,
      key: GOOGLE_PLACES_API_KEY,
      components: 'country:us',
      types: 'establishment',
    })
    if (sessionToken) {
      params.set('sessiontoken', sessionToken)
    }

    const endpoint = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`
    const response = await fetch(endpoint)
    if (!response.ok) {
      console.error('[places] autocomplete fetch failed', response.status, response.statusText)
      return { status: 502, body: { error: 'Autocomplete request failed' } }
    }

    const payload = await response.json()
    if (payload.status && payload.status !== 'OK') {
      if (payload.status === 'ZERO_RESULTS') {
        return { status: 200, body: { predictions: [] } }
      }
      console.warn('[places] autocomplete status', payload.status, payload.error_message)
      const statusCode = payload.status === 'REQUEST_DENIED' ? 503 : 502
      return {
        status: statusCode,
        body: {
          error:
            payload.status === 'REQUEST_DENIED'
              ? 'Google Places rejected the request. Check API credentials and quotas.'
              : 'Autocomplete request rejected by Google',
          status: payload.status,
        },
      }
    }

    const predictions = Array.isArray(payload.predictions)
      ? payload.predictions.map(prediction => ({
          description: prediction.description,
          place_id: prediction.place_id,
        }))
      : []

    return { status: 200, body: { predictions } }
  } catch (error) {
    console.error('[places] autocomplete error', error)
    return { status: 500, body: { error: 'Failed to fetch predictions' } }
  }
}

async function handlePlaceDetails({ placeId, sessionToken, ip }) {
  if (!GOOGLE_PLACES_API_KEY) {
    return { status: 503, body: { error: 'Google Places API key not configured' } }
  }

  const trimmedPlaceId = normalizeString(placeId).trim()
  if (!trimmedPlaceId) {
    return { status: 400, body: { error: 'Missing place_id parameter' } }
  }

  const limiterKey = `${ip || 'unknown'}:details`
  if (isRateLimited(limiterKey, DETAILS_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return { status: 429, body: { error: 'Too many place detail requests' } }
  }

  try {
    const params = new URLSearchParams({
      place_id: trimmedPlaceId,
      key: GOOGLE_PLACES_API_KEY,
      fields: 'place_id,name,formatted_address,geometry/location',
    })
    if (sessionToken) {
      params.set('sessiontoken', sessionToken)
    }

    const endpoint = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
    const response = await fetch(endpoint)
    if (!response.ok) {
      console.error('[places] details fetch failed', response.status, response.statusText)
      return { status: 502, body: { error: 'Place details request failed' } }
    }

    const payload = await response.json()
    if (payload.status !== 'OK') {
      console.warn('[places] details status', payload.status, payload.error_message)
      const statusCode = payload.status === 'REQUEST_DENIED' ? 503 : 502
      return {
        status: statusCode,
        body: {
          error:
            payload.status === 'REQUEST_DENIED'
              ? 'Google Places rejected the request. Check API credentials and quotas.'
              : 'Place details rejected by Google',
          status: payload.status,
        },
      }
    }

    const result = payload.result || {}
    const geometry = result.geometry?.location || {}

    return {
      status: 200,
      body: {
        place_id: result.place_id,
        name: result.name,
        formatted_address: result.formatted_address,
        lat: typeof geometry.lat === 'number' ? geometry.lat : null,
        lng: typeof geometry.lng === 'number' ? geometry.lng : null,
      },
    }
  } catch (error) {
    console.error('[places] details error', error)
    return { status: 500, body: { error: 'Failed to fetch place details' } }
  }
}

module.exports = {
  handleAutocomplete,
  handlePlaceDetails,
}

