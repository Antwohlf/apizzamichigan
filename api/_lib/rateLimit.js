const buckets = new Map()

function isRateLimited(key, limit, windowMs) {
  if (!key || typeof limit !== 'number' || limit <= 0) {
    return false
  }
  const now = Date.now()
  const bucket = buckets.get(key)
  if (bucket && bucket.expires > now) {
    if (bucket.count >= limit) {
      return true
    }
    bucket.count += 1
    return false
  }
  buckets.set(key, { count: 1, expires: now + windowMs })
  return false
}

module.exports = {
  isRateLimited,
}

