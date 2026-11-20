import { supabase, SUPABASE_URL } from '../supabaseClient'
import { readSupabase } from './supabaseRead'
import { readExpiringBrowserCache, writeExpiringBrowserCache } from './expiringBrowserCache'

const CACHE_TTL_MS = 15 * 60 * 1000
const memoryCache = new Map()
const pendingLoads = new Map()
const entityForTable = { pizza_places: 'pizza', taco_places: 'taco' }

export const isMissingMapSummaryError = error => ['PGRST202', '42883'].includes(error?.code)

const browserStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch (error) {
    return null
  }
}

const invalidSummary = () => Object.assign(new Error('Invalid public map summary response'), {
  code: 'INVALID_MAP_SUMMARY',
})

function validateSummary(rows) {
  if (!Array.isArray(rows)) throw invalidSummary()
  return Object.freeze(rows.map(row => {
    if (!row || typeof row !== 'object'
      || !['state', 'status', 'lifecycle_status'].every(key => row[key] === null || typeof row[key] === 'string')
      || !(row.rating === null || (typeof row.rating === 'number' && Number.isFinite(row.rating)))
      || !Number.isSafeInteger(row.place_count) || row.place_count < 0) throw invalidSummary()

    // Cache only the public aggregate contract, even if the response gains fields.
    return Object.freeze({
      state: row.state,
      status: row.status,
      lifecycle_status: row.lifecycle_status,
      rating: row.rating,
      place_count: row.place_count,
    })
  }))
}

const isFresh = (entry, now) => entry && Number.isFinite(entry.fetchedAt)
  && now >= entry.fetchedAt && now - entry.fetchedAt < CACHE_TTL_MS

// Both App and StatsPanel share this promise and the same validated row array.
// The RPC returns one JSONB array, avoiding PostgREST's set-returning row limit.
export function loadMapSummary(table, { force = false } = {}) {
  const entity = Object.prototype.hasOwnProperty.call(entityForTable, table) ? entityForTable[table] : null
  if (!entity) return Promise.reject(new Error(`Unsupported map summary table: ${table}`))
  if (pendingLoads.has(table)) return pendingLoads.get(table)

  const key = `apizza:map-summary:v1:${SUPABASE_URL || 'default'}:${table}`
  const now = Date.now()
  if (!force) {
    const cached = memoryCache.get(table)
    if (isFresh(cached, now)) return Promise.resolve(cached.rows)
    memoryCache.delete(table)

    const persisted = readExpiringBrowserCache(key, {
      storage: browserStorage(), now, ttlMs: CACHE_TTL_MS,
    })
    if (isFresh(persisted, now)) {
      try {
        const entry = { fetchedAt: persisted.fetchedAt, rows: validateSummary(persisted.rows) }
        memoryCache.set(table, entry)
        return Promise.resolve(entry.rows)
      } catch (error) {
        // An old or malformed browser entry must not prevent a fresh request.
      }
    }
  }

  const request = (async () => {
    const { data, error } = await readSupabase(() => supabase.rpc('public_map_summary', { p_entity: entity }))
    if (error) throw error
    const rows = validateSummary(data)
    const entry = { fetchedAt: Date.now(), rows }
    memoryCache.set(table, entry)
    writeExpiringBrowserCache(key, entry, {
      storage: browserStorage(), now: entry.fetchedAt, ttlMs: CACHE_TTL_MS,
    })
    return rows
  })().finally(() => pendingLoads.delete(table))
  pendingLoads.set(table, request)
  return request
}

export function summaryStateCounts(rows, {
  includeStates,
  includeStatuses,
  caseInsensitiveStatuses = false,
  requireRating = false,
  minimumRating = null,
  excludeHistorical = false,
} = {}) {
  const states = Array.isArray(includeStates) && includeStates.length ? new Set(includeStates) : null
  const statuses = Array.isArray(includeStatuses) && includeStatuses.length ? includeStatuses : null
  const hasMinimum = minimumRating !== null && minimumRating !== undefined
    && String(minimumRating).trim() !== '' && Number.isFinite(Number(minimumRating))
  const counts = {}

  rows.forEach(row => {
    if (states && !states.has(row.state)) return
    if (excludeHistorical && row.lifecycle_status !== null) return
    if (requireRating && row.rating === null) return
    if (hasMinimum && (row.rating === null || row.rating < Number(minimumRating))) return
    if (statuses && !statuses.some(status => caseInsensitiveStatuses
      ? row.status !== null && row.status.toLowerCase().startsWith(String(status).trim().toLowerCase())
      : row.status === status)) return
    const state = row.state?.trim().toUpperCase() || 'Unknown'
    counts[state] = (counts[state] || 0) + row.place_count
  })
  return counts
}

export function summaryStats(rows, states = []) {
  const scope = Array.isArray(states) && states.length ? new Set(states) : null
  let tried = 0
  let unvisited = 0
  let ratingTotal = 0
  rows.forEach(row => {
    if (scope && !scope.has(row.state)) return
    const status = row.status?.toLowerCase() || ''
    if (status === 'unvisited') unvisited += row.place_count
    if ((status.startsWith('visited') || status.startsWith('golden')) && row.rating !== null) {
      tried += row.place_count
      ratingTotal += row.rating * row.place_count
    }
  })
  return { tried, unvisited, average: tried ? (ratingTotal / tried).toFixed(1) : '—' }
}
