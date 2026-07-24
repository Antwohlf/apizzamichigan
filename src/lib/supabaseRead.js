const TRANSIENT_ERROR_PATTERN = /failed to fetch|network|timeout|temporarily unavailable|connection reset|econnreset/i

export function isTransientSupabaseReadError(error) {
  const message = String(error?.message || error?.details || error || '')
  const name = String(error?.name || '')
  return name === 'AbortError' || TRANSIENT_ERROR_PATTERN.test(message) || /^5\d\d$/.test(String(error?.status || ''))
}

export async function readSupabase(queryFactory, { retries = 2, delayMs = 250 } = {}) {
  const maxAttempts = Math.max(1, Number(retries) + 1)
  let lastError = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let result
    try {
      result = await queryFactory()
    } catch (error) {
      lastError = error
      if (!isTransientSupabaseReadError(error) || attempt === maxAttempts - 1) throw error
    }

    if (result && !result.error) return result
    if (result && result.error) {
      lastError = result.error
      if (!isTransientSupabaseReadError(result.error) || attempt === maxAttempts - 1) return result
    }

    if (attempt < maxAttempts - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }

  throw lastError || new Error('Supabase read failed')
}
