const STORAGE_KEY = 'apizza-map-return-state'

function getStorage(storage) {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch (error) {
    return null
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function saveMapReturnState(state, storage) {
  const target = getStorage(storage)
  if (!target || !state) return false

  const center = state.center
  if (!center || !isFiniteNumber(center.lat) || !isFiniteNumber(center.lng) || !isFiniteNumber(state.zoom)) {
    return false
  }

  try {
    target.setItem(STORAGE_KEY, JSON.stringify({
      pathname: typeof state.pathname === 'string' ? state.pathname : '/',
      search: typeof state.search === 'string' ? state.search : '',
      center: { lat: center.lat, lng: center.lng },
      zoom: state.zoom,
    }))
    return true
  } catch (error) {
    return false
  }
}

export function readMapReturnState(storage) {
  const target = getStorage(storage)
  if (!target) return null

  try {
    const raw = target.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    if (
      !value ||
      !value.center ||
      !isFiniteNumber(value.center.lat) ||
      !isFiniteNumber(value.center.lng) ||
      !isFiniteNumber(value.zoom)
    ) {
      return null
    }
    return {
      pathname: value.pathname || '/',
      search: value.search || '',
      center: { lat: value.center.lat, lng: value.center.lng },
      zoom: value.zoom,
    }
  } catch (error) {
    return null
  }
}

export function consumeMapReturnState(storage, expectedPathname = null) {
  const target = getStorage(storage)
  const value = readMapReturnState(target)
  // Do not destroy a valid map context just because a different themed route
  // evaluated first. The matching map can consume it on the next render.
  if (expectedPathname && value && value.pathname !== expectedPathname) return null
  if (target) {
    try {
      target.removeItem(STORAGE_KEY)
    } catch (error) {
      // Session storage can be unavailable in privacy-restricted browsers.
    }
  }
  return value
}

export function mapReturnPath(state, fallback = '/') {
  if (!state) return fallback
  const pathname = state.pathname || '/'
  const search = state.search || ''
  return `${pathname}${search}`
}
