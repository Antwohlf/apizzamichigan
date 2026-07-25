import { readExpiringBrowserCache, writeExpiringBrowserCache } from './expiringBrowserCache'

function makeStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

test('round trips values until the TTL expires', () => {
  const storage = makeStorage()
  expect(writeExpiringBrowserCache('counts', { MI: 10 }, { storage, now: 100, ttlMs: 60 })).toBe(true)
  expect(readExpiringBrowserCache('counts', { storage, now: 159, ttlMs: 60 })).toEqual({ MI: 10 })
  expect(readExpiringBrowserCache('counts', { storage, now: 160, ttlMs: 60 })).toBeNull()
})

test('ignores malformed or unavailable storage', () => {
  const storage = makeStorage()
  storage.setItem('bad', '{not json')
  expect(readExpiringBrowserCache('bad', { storage, now: 100, ttlMs: 60 })).toBeNull()
  expect(writeExpiringBrowserCache('counts', { MI: 10 }, { storage: null, now: 100, ttlMs: 60 })).toBe(false)
})
