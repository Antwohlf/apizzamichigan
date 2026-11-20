import { fetchStateCounts, mergeLoadedRegionPlaces } from './App'
import { loadMapSummary, summaryStats } from './lib/mapSummary'
import { supabase } from './supabaseClient'

jest.mock('./supabaseClient', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }))

test('cold map totals, reviewed markers and statistics share one request', async () => {
  const rows = [
    { state: 'MI', status: 'unvisited', lifecycle_status: null, rating: null, place_count: 3000 },
    { state: 'MI', status: 'visited', lifecycle_status: null, rating: 8, place_count: 2 },
    { state: 'NY', status: 'golden', lifecycle_status: null, rating: 10, place_count: 1 },
    { state: 'MI', status: 'visited', lifecycle_status: 'permanently_closed', rating: 6, place_count: 1 },
  ]
  let resolve
  supabase.rpc.mockReturnValue(new Promise(done => { resolve = done }))
  const totals = fetchStateCounts('pizza_places', { includeStates: ['MI', 'NY'], excludeHistorical: true })
  const reviewed = fetchStateCounts('pizza_places', {
    includeStates: ['MI', 'NY'], includeStatuses: ['visited', 'golden'],
    splitEuropeByCountry: true, requireRating: true, excludeHistorical: true,
  })
  const stats = loadMapSummary('pizza_places').then(summary => summaryStats(summary))
  resolve({ data: rows, error: null })
  expect(await totals).toEqual({ MI: 3002, NY: 1 })
  expect(await reviewed).toEqual({ MI: 2, NY: 1 })
  expect(await stats).toEqual({ tried: 4, unvisited: 3000, average: '8.0' })
  expect(supabase.rpc).toHaveBeenCalledTimes(1)
  expect(supabase.from).not.toHaveBeenCalled()
})

test('a failed summary does not fan out into legacy count scans', async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
  await expect(fetchStateCounts('taco_places', { includeStates: ['MI', 'NY'] })).rejects.toMatchObject({ code: '42501' })
  expect(supabase.from).not.toHaveBeenCalled()
})

test('count/loading updates preserve existing place identity until rows change', () => {
  const michigan = [{ id: 'mi1', name: 'Michigan Pizza' }]
  const initial = mergeLoadedRegionPlaces({ MI: { status: 'loaded', places: michigan, originalCount: 1 } })
  const counts = mergeLoadedRegionPlaces({
    MI: { status: 'loaded', places: michigan, originalCount: 2 },
    NY: { status: 'loading', places: [], originalCount: 1000 },
  }, initial)
  expect(counts).toBe(initial)
  const newYork = [{ id: 'ny1', name: 'New York Pizza' }]
  const loaded = mergeLoadedRegionPlaces({
    MI: { status: 'loaded', places: michigan }, NY: { status: 'loaded', places: newYork },
  }, counts)
  expect(loaded.places).toEqual([...michigan, ...newYork])
  expect(loaded.places[0]).toBe(michigan[0])
})
