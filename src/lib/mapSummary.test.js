jest.mock('../supabaseClient', () => ({
  SUPABASE_URL: 'https://summary-test.supabase.co',
  supabase: { rpc: jest.fn() },
}))

const row = (overrides = {}) => ({ state: 'MI', status: 'unvisited', lifecycle_status: null, rating: null, place_count: 12, ...overrides })
const storageKey = table => `apizza:map-summary:v1:https://summary-test.supabase.co:${table}`
const ttl = 15 * 60 * 1000
let summary
let rpc
let now

beforeEach(() => {
  jest.resetModules()
  window.localStorage.clear()
  now = 1000000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  summary = require('./mapSummary')
  rpc = require('../supabaseClient').supabase.rpc
})

afterEach(() => jest.restoreAllMocks())

test('shares one in-flight load and cached row identity, with a separate entity cache', async () => {
  let resolve
  rpc.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const first = summary.loadMapSummary('pizza_places')
  const second = summary.loadMapSummary('pizza_places')
  expect(second).toBe(first)
  expect(summary.loadMapSummary('pizza_places', { force: true })).toBe(first)
  expect(rpc).toHaveBeenCalledTimes(1)
  resolve({ data: [row()], error: null })
  const rows = await first
  expect(await second).toBe(rows)
  expect(await summary.loadMapSummary('pizza_places')).toBe(rows)

  rpc.mockResolvedValueOnce({ data: [row({ place_count: 3 })], error: null })
  expect((await summary.loadMapSummary('taco_places'))[0].place_count).toBe(3)
  expect(rpc.mock.calls).toEqual([
    ['public_map_summary', { p_entity: 'pizza' }],
    ['public_map_summary', { p_entity: 'taco' }],
  ])
  expect(await summary.loadMapSummary('pizza_places')).toBe(rows)
})

test('expires memory entries after 15 minutes and force refreshes a fresh entry', async () => {
  rpc.mockResolvedValue({ data: [row()], error: null })
  await summary.loadMapSummary('pizza_places')
  now += ttl - 1
  await summary.loadMapSummary('pizza_places')
  expect(rpc).toHaveBeenCalledTimes(1)
  now += 1
  await summary.loadMapSummary('pizza_places')
  expect(rpc).toHaveBeenCalledTimes(2)
  await summary.loadMapSummary('pizza_places', { force: true })
  expect(rpc).toHaveBeenCalledTimes(3)
})

test('restores persisted rows without extending their original freshness', async () => {
  window.localStorage.setItem(storageKey('pizza_places'), JSON.stringify({
    createdAt: now - ttl + 20,
    value: { fetchedAt: now - ttl + 20, rows: [row({ place_count: 7 })] },
  }))
  expect((await summary.loadMapSummary('pizza_places'))[0].place_count).toBe(7)
  expect(rpc).not.toHaveBeenCalled()
  now += 20
  rpc.mockResolvedValue({ data: [row()], error: null })
  expect((await summary.loadMapSummary('pizza_places'))[0].place_count).toBe(12)
  expect(rpc).toHaveBeenCalledTimes(1)
})

test('rejects invalid API payloads without poisoning subsequent requests', async () => {
  rpc.mockResolvedValueOnce({ data: { rows: [row()] }, error: null })
    .mockResolvedValueOnce({ data: [row({ place_count: '12' })], error: null })
    .mockResolvedValueOnce({ data: [row({ rating: Number.NaN })], error: null })
    .mockResolvedValueOnce({ data: [row()], error: null })
  for (let index = 0; index < 3; index += 1) {
    await expect(summary.loadMapSummary('pizza_places')).rejects.toMatchObject({ code: 'INVALID_MAP_SUMMARY' })
    expect(window.localStorage.getItem(storageKey('pizza_places'))).toBeNull()
  }
  expect((await summary.loadMapSummary('pizza_places'))[0].place_count).toBe(12)
})

test('ignores corrupt persisted data and caches only public fields from valid rows', async () => {
  window.localStorage.setItem(storageKey('pizza_places'), JSON.stringify({
    createdAt: now,
    value: { fetchedAt: now, rows: [row({ lifecycle_status: undefined })] },
  }))
  rpc.mockResolvedValue({ data: [row({ unexpected_field: 'discard me' })], error: null })
  const rows = await summary.loadMapSummary('pizza_places')
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rows[0]).toEqual(row())
  expect(Object.isFrozen(rows[0])).toBe(true)
  expect(window.localStorage.getItem(storageKey('pizza_places'))).not.toContain('unexpected_field')
})

test('storage denial does not break a successful request', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied') })
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Denied') })
  rpc.mockResolvedValue({ data: [], error: null })
  await expect(summary.loadMapSummary('pizza_places')).resolves.toEqual([])
})

test.each(['PGRST202', '42883'])('preserves missing-RPC %s for deployment fallback and permits a later retry', async code => {
  const error = { code, message: 'Function unavailable' }
  rpc.mockResolvedValueOnce({ data: null, error }).mockResolvedValueOnce({ data: [], error: null })
  await expect(summary.loadMapSummary('pizza_places')).rejects.toBe(error)
  expect(summary.isMissingMapSummaryError(error)).toBe(true)
  expect(summary.isMissingMapSummaryError({ code: '57014', message: 'statement timeout' })).toBe(false)
  await expect(summary.loadMapSummary('pizza_places')).resolves.toEqual([])
})

test('a failed forced refresh leaves the previous successful cache intact', async () => {
  rpc.mockResolvedValueOnce({ data: [row()], error: null })
  const original = await summary.loadMapSummary('pizza_places')
  rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } })
  await expect(summary.loadMapSummary('pizza_places', { force: true })).rejects.toMatchObject({ code: '42501' })
  expect(await summary.loadMapSummary('pizza_places')).toBe(original)
})

test('shares the bounded retry after a transient RPC failure', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'service unavailable' }, status: 503 })
    .mockResolvedValueOnce({ data: [row()], error: null })
  const first = summary.loadMapSummary('pizza_places')
  const second = summary.loadMapSummary('pizza_places')
  expect(second).toBe(first)
  const rows = await first
  expect(await second).toBe(rows)
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(await summary.loadMapSummary('pizza_places')).toBe(rows)
})

test('weighted statistics preserve prefix status, null-rating and exact unvisited semantics', () => {
  const rows = [
    row({ status: 'VISITED', rating: 8, place_count: 3 }),
    row({ status: 'golden pick', rating: 10, place_count: 1 }),
    row({ status: 'visited', rating: null, place_count: 20 }),
    row({ status: 'visited old', rating: 0, lifecycle_status: 'closed', place_count: 1 }),
    row({ status: 'Unvisited', place_count: 12 }),
    row({ status: 'unvisited suggestion', place_count: 100 }),
    row({ status: ' visited', rating: 9, place_count: 50 }),
    row({ state: 'NY', status: 'golden', rating: 6, place_count: 2 }),
  ]
  expect(summary.summaryStats(rows, ['MI'])).toEqual({ tried: 5, unvisited: 12, average: '6.8' })
  expect(summary.summaryStats(rows)).toEqual({ tried: 7, unvisited: 12, average: '6.6' })
  expect(summary.summaryStats(rows, ['CA'])).toEqual({ tried: 0, unvisited: 0, average: '—' })
})

test('state totals compose scope, exact or prefix statuses, rating and lifecycle filters', () => {
  const rows = [
    row({ status: 'visited', rating: 8, place_count: 3 }),
    row({ status: 'Visited extra', rating: 9, place_count: 2 }),
    row({ status: 'golden', rating: 10, lifecycle_status: 'closed', place_count: 4 }),
    row({ status: 'visited', rating: null, place_count: 5 }),
    row({ state: 'NY', status: 'golden', rating: 7, place_count: 6 }),
    row({ state: null, place_count: 1 }),
  ]
  expect(summary.summaryStateCounts(rows)).toEqual({ MI: 14, NY: 6, Unknown: 1 })
  expect(summary.summaryStateCounts(rows, { includeStates: ['MI'], includeStatuses: ['visited'], requireRating: true })).toEqual({ MI: 3 })
  expect(summary.summaryStateCounts(rows, {
    includeStatuses: ['visited', 'golden'], caseInsensitiveStatuses: true,
    requireRating: true, minimumRating: 8, excludeHistorical: true,
  })).toEqual({ MI: 5 })
  expect(summary.summaryStateCounts(rows, { minimumRating: 0 })).toEqual({ MI: 9, NY: 6 })
  expect(summary.summaryStateCounts(rows, { minimumRating: '' })).toEqual({ MI: 14, NY: 6, Unknown: 1 })
})
