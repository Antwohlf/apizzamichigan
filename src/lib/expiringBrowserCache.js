const canUseStorage = storage => storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'

export function readExpiringBrowserCache(key, { storage, now = Date.now(), ttlMs } = {}) {
  if (!canUseStorage(storage) || !key || !Number.isFinite(ttlMs) || ttlMs <= 0) return null

  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (!entry || !Number.isFinite(entry.createdAt) || now - entry.createdAt >= ttlMs) {
      storage.removeItem(key)
      return null
    }
    return entry.value ?? null
  } catch (error) {
    return null
  }
}

export function writeExpiringBrowserCache(key, value, { storage, now = Date.now(), ttlMs } = {}) {
  if (!canUseStorage(storage) || !key || !Number.isFinite(ttlMs) || ttlMs <= 0) return false

  try {
    storage.setItem(key, JSON.stringify({ createdAt: now, value }))
    return true
  } catch (error) {
    // Quota and privacy-mode failures should never affect the live data path.
    return false
  }
}
