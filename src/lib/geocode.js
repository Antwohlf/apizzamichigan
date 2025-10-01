const readEnv = key => {
  try {
    // eslint-disable-next-line no-eval
    const metaEnv = eval('import.meta').env
    if (metaEnv && metaEnv[key]) return metaEnv[key]
  } catch (err) {
    // ignore when import.meta is unavailable
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key]
  }
  return undefined
}

export async function geocodeAddress(address) {
  if (!address) throw new Error('Address is required')

  const provider = readEnv('VITE_GEOCODER') || readEnv('NEXT_PUBLIC_GEOCODER')

  if (provider === 'mapbox') {
    const token = readEnv('VITE_MAPBOX_TOKEN') || readEnv('NEXT_PUBLIC_MAPBOX_TOKEN')
    if (!token) throw new Error('Mapbox token missing')

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}`
    const response = await fetch(url)
    if (!response.ok) throw new Error('Geocoder request failed')
    const data = await response.json()
    const [lng, lat] = data?.features?.[0]?.center || []
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng }
    }
    throw new Error('Geocode failed')
  }

  throw new Error('No geocoder configured')
}
