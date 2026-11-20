import { isTransientSupabaseReadError, readSupabase } from './supabaseRead'

describe('Supabase read retry policy', () => {
  test('recognizes transient network failures but not schema errors', () => {
    expect(isTransientSupabaseReadError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientSupabaseReadError({ status: 503, message: 'service unavailable' })).toBe(true)
    expect(isTransientSupabaseReadError({ code: '42703', message: 'column does not exist' })).toBe(false)
  })

  test('retries a transient query and returns the later successful result', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ error: new TypeError('Failed to fetch') })
      .mockResolvedValueOnce({ data: [{ state: 'MI' }], error: null })

    await expect(readSupabase(query, { retries: 2, delayMs: 0 })).resolves.toEqual({
      data: [{ state: 'MI' }],
      error: null,
    })
    expect(query).toHaveBeenCalledTimes(2)
  })

  test('returns non-transient query errors without retrying', async () => {
    const result = { data: null, error: { code: '42703', message: 'column does not exist' } }
    const query = jest.fn().mockResolvedValue(result)

    await expect(readSupabase(query, { retries: 2, delayMs: 0 })).resolves.toBe(result)
    expect(query).toHaveBeenCalledTimes(1)
  })

  test('retries a failed HEAD count using its HTTP status when the body is empty', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ error: { message: '' }, status: 500, count: null })
      .mockResolvedValueOnce({ error: null, status: 200, count: 125 })
    await expect(readSupabase(query, { retries: 1, delayMs: 0 })).resolves.toEqual({ error: null, status: 200, count: 125 })
    expect(query).toHaveBeenCalledTimes(2)
  })
})
