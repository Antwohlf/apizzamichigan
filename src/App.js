// src/App.js
import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import Sidebar from './Sidebar'
import SuggestionForm from './SuggestionForm'
import AdminForm from './AdminForm'
import FrozenPizzaDirectory from './FrozenPizzaDirectory'
import AdminSubmit from './AdminSubmit'
import AdminReviewsPage from './admin/AdminReviewsPage'
import { StatsPanel } from './sidebar/StatsPanel'
import { MapPopupProvider, useMapPopup } from './map/useMapPopup'
import DataDashboard from './pages/DataDashboard'
import PlaceDetailPage from './pages/PlaceDetailPage'
import DiscoveryConceptPage from './pages/DiscoveryConceptPage'
import PublicSuggestionPage from './pages/PublicSuggestionPage'
import { BugReportFab } from './components/bug-report/BugReportFab'
import ProductionDiscoveryShell, { sortProductionPlaces } from './components/ProductionDiscoveryShell'

import { ThemeProvider, useTheme } from './themes/ThemeProvider'
import { ThemeKeys } from './themes/siteTheme'
import { supabase } from './supabaseClient'
import { trackSiteSwitch } from './analytics'
import { STATE_CENTROIDS } from './data/stateCentroids'
import { getDistanceMiles } from './utils/geo'
import './App.css'
import { GlobalLoadingProvider, useGlobalLoading } from './hooks/useGlobalLoading'
import { SelectedPlaceProvider } from './store/selectedPlace'
import { useSelectedPlace } from './store/selectedPlace'
import { MapControls } from './map/MapControls'
import {
  publicPlaceSearchSelectForTable,
  publicPlaceLegacySelectForTable,
  publicPlaceSelectForTable,
  publicPizzaPlaceSelect,
} from './lib/publicPlaceFields'
import { entityConfig, entityConfigForTheme, normalizeEntityStyle } from './config/entityConfig'
import { normalizeLifecycleStatus } from './lib/lifecycle'
import { readSupabase } from './lib/supabaseRead'
import { normalizeRating } from './lib/ratings'
import { isLegacyPublicSchema, markLegacyPublicSchema } from './lib/publicSchemaCapabilities'
import { shouldForceIndividualMarkers } from './map/viewport'
import { readExpiringBrowserCache, writeExpiringBrowserCache } from './lib/expiringBrowserCache'

export { normalizeLifecycleStatus }

export const publicPlaceSelect = publicPizzaPlaceSelect
export const publicSearchSelectForTable = publicPlaceSearchSelectForTable
export { publicPlaceSelectForTable }

export const shouldApplyMinimumRating = minimumRating => (
  minimumRating !== null &&
  minimumRating !== undefined &&
  String(minimumRating).trim() !== '' &&
  Number.isFinite(Number(minimumRating))
)

// Helper to fetch places for a specific state
export async function fetchPlacesForState(table, stateCode) {
  const pageSize = 1000
  const fetchAll = async select => {
    const allData = []
    let offset = 0

    while (true) {
      const pageOffset = offset
      const { data, error } = await readSupabase(() => supabase
        .from(table)
        .select(select)
        .eq('state', stateCode)
        .range(pageOffset, pageOffset + pageSize - 1))

      if (error) throw error
      if (!data || data.length === 0) break

      allData.push(...data)
      if (data.length < pageSize) break
      offset += pageSize
    }

    return allData
  }

  try {
    return await fetchAll(isLegacyPublicSchema(supabase.from, table)
      ? publicPlaceLegacySelectForTable(table)
      : publicPlaceSelectForTable(table))
  } catch (error) {
    if (!isMissingSearchColumnError(error)) throw error
    // Lifecycle columns are additive; retain the older-schema fallback used
    // by search while production migrations are being rolled out.
    markLegacyPublicSchema(supabase.from, table)
    return fetchAll(publicPlaceLegacySelectForTable(table))
  }
}

const GENERIC_SEARCH_TERMS = new Set([
  'pizza',
  'pizzeria',
  'slice',
  'slices',
  'taco',
  'tacos',
  'taqueria',
  'restaurant',
  'restaurants',
])
const SEARCH_TERM_ALIASES = {
  aa: ['ann arbor'],
  annarbor: ['ann arbor'],
  affordable: ['$'],
  blaze: ['blaze pizza'],
  budget: ['$'],
  closed: ['permanently closed', 'replaced'],
  cheap: ['$'],
  favorite: ['golden'],
  favorites: ['golden'],
  dominos: ['domino', 'domino s'],
  expensive: ['$$$'],
  godfathers: ['godfather', 'godfather s'],
  hungryhowies: ['hungry howies', 'hungry howie', 'howies', 'howie'],
  historical: ['closed', 'replaced'],
  inexpensive: ['$'],
  jetpizza: ['jet pizza', 'jets pizza', 'jet s pizza'],
  jetspizza: ['jets pizza', 'jet pizza', 'jet s pizza'],
  jets: ['jet', 'jet s'],
  littlecaesars: ['little caesars', 'little caesar', 'caesars', 'caesar'],
  loumalnatis: ['lou malnatis', 'lou malnati', 'malnatis', 'malnati'],
  marcos: ['marco', 'marco s'],
  midrange: ['$$'],
  moderate: ['$$'],
  nyc: ['new york'],
  // Common local shorthand that is not stored as a canonical field.
  nypd: ['new york pizza depot'],
  papajohn: ['papa john', 'papa johns', 'john'],
  papajohns: ['papa johns', 'papa john', 'johns', 'john'],
  papamurphy: ['papa murphy', 'papa murphys', 'murphy'],
  papamurphys: ['papa murphys', 'papa murphy', 'murphys', 'murphy'],
  philly: ['philadelphia'],
  pizzahut: ['pizza hut', 'hut'],
  premium: ['$$$$'],
  reviewed: ['visited', 'golden'],
  splurge: ['$$$$'],
  tried: ['visited'],
  upscale: ['$$$'],
}
const STATE_SEARCH_ALIASES = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  rhodeisland: 'RI',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  dc: 'DC',
  'washington dc': 'DC',
}
const US_STATE_CODES = new Set(Object.values(STATE_SEARCH_ALIASES))

const supabaseIlikePattern = term => `%${String(term || '').trim().replace(/[%_]/g, value => `\\${value}`)}%`
const SEARCH_LOOKUP_LIMIT = 250
const MAX_REMOTE_SEARCH_TERMS = 6
const MAX_STATE_SCOPED_SEARCH_TERMS = 4
const SEARCH_RESULT_LIMIT = 250
const SEARCH_PHOTO_LIMIT = 100
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 32
const LIFECYCLE_SEARCH_TERMS = new Set(['closed', 'historical', 'replaced', 'demolished'])
const searchCache = new Map()

const readSearchCache = key => {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.createdAt > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }
  // Refresh insertion order so frequently repeated searches stay resident.
  searchCache.delete(key)
  searchCache.set(key, entry)
  return entry.rows
}

const writeSearchCache = (key, rows) => {
  searchCache.delete(key)
  searchCache.set(key, { createdAt: Date.now(), rows })
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    searchCache.delete(searchCache.keys().next().value)
  }
}

export const remoteSearchableColumns = table => table === 'taco_places'
  ? ['name', 'address', 'state', 'style', 'status', 'price']
  : [
    'name',
    'address',
    'website_url',
    'phone',
    'state',
    'style',
    'status',
    'price_range',
    'brand',
    'operator',
  ]

// Older public deployments may not have the additive city/brand/operator
// columns yet. Keep the compatibility retry aligned with the actual filter
// columns as well as the selected fields.
export const legacyRemoteSearchableColumns = table => table === 'taco_places'
  ? ['name', 'address', 'state', 'style', 'status', 'price']
  : ['name', 'address', 'website_url', 'phone', 'state', 'style', 'status', 'price_range']

// Search and map views intentionally share the same bounded public shape.
export const publicSearchSelect = publicPlaceSelect

const isMissingSearchColumnError = error => {
  const message = String(error?.message || error?.details || '').toLowerCase()
  return message.includes('column') && (
    message.includes('does not exist') ||
    message.includes('not found') ||
    message.includes('schema cache')
  )
}

async function executeSearchQuery(queryFactory, table) {
  if (isLegacyPublicSchema(supabase.from, table)) {
    return readSupabase(() => queryFactory(
      publicPlaceLegacySelectForTable(table),
      legacyRemoteSearchableColumns(table),
    ))
  }

  const compactResult = await readSupabase(() => queryFactory(
    publicPlaceSearchSelectForTable(table),
    remoteSearchableColumns(table),
  ))
  if (!compactResult.error || !isMissingSearchColumnError(compactResult.error)) return compactResult
  // Keep deployments with an older enrichment schema usable while the
  // additive migration is rolled out. This path is intentionally rare, but
  // must downgrade the filter columns too or PostgREST still rejects it.
  markLegacyPublicSchema(supabase.from, table)
  return readSupabase(() => queryFactory(
    publicPlaceLegacySelectForTable(table),
    legacyRemoteSearchableColumns(table),
  ))
}

export async function fetchPlacesForSearch(table, searchTerms, originalQuery = '', scopeStates = []) {
  const terms = [...new Set((Array.isArray(searchTerms) ? searchTerms : [searchTerms])
    .map(term => String(term || '').trim())
    .filter(term => term.length >= 2))].slice(0, MAX_REMOTE_SEARCH_TERMS)
  if (!terms.length) return []

  const termBatches = []
  for (let index = 0; index < terms.length; index += 3) termBatches.push(terms.slice(index, index + 3))
  const responses = await Promise.all(termBatches.map(async batch => {
    const queryFactory = (select, searchableColumns = remoteSearchableColumns(table)) => {
      const remoteSearchFilter = searchableColumns
        .flatMap(column => batch.map(term => `${column}.ilike.${supabaseIlikePattern(term)}`))
        .join(',')
      let query = supabase
        .from(table)
        .select(select)
        .or(remoteSearchFilter)
        .order('rating', { ascending: false, nullsFirst: false })
        .order('name', { ascending: true })
        .limit(Math.min(SEARCH_LOOKUP_LIMIT * batch.length, 1000))
      if (Array.isArray(scopeStates) && scopeStates.length) query = query.in('state', scopeStates)
      return query
    }
    const { data, error } = await executeSearchQuery(queryFactory, table)

    if (error) throw error
    return data || []
  }))

  // Editorial intent is not stored in the place name. Query the bounded
  // canonical pick set directly, then let the normal local ranker apply any
  // accompanying location or identity terms.
  if (isPicksSearchQuery(originalQuery)) {
    const entityKey = table === 'taco_places' ? 'taco' : 'pizza'
    const minimumRating = Number(entityConfig(entityKey).editorial?.picks?.minimumRating ?? 8)
    const picksQueryFactory = (select) => {
      let query = supabase
        .from(table)
        .select(select)
        .in('status', ['visited', 'golden'])
        .gte('rating', minimumRating)
        .order('rating', { ascending: false, nullsFirst: false })
        .order('name', { ascending: true })
        .limit(1000)
      if (Array.isArray(scopeStates) && scopeStates.length) query = query.in('state', scopeStates)
      return query
    }
    const { data, error } = await executeSearchQuery(picksQueryFactory, table)
    if (error) throw error
    responses.push(...(data || []))
  }

  const lifecycleTerms = String(originalQuery || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(term => LIFECYCLE_SEARCH_TERMS.has(term))
  if (lifecycleTerms.length && !isLegacyPublicSchema(supabase.from, table)) {
    const lifecycleFilter = lifecycleTerms
      .map(term => `lifecycle_status.ilike.${supabaseIlikePattern(term)}`)
      .join(',')
    const lifecycleQueryFactory = () => {
      let query = supabase
        .from(table)
        .select(`${publicSearchSelectForTable(table)}, lifecycle_status, lifecycle_replaced_by_id`)
        .or(lifecycleFilter)
        .order('name', { ascending: true })
        .limit(SEARCH_LOOKUP_LIMIT)
      if (Array.isArray(scopeStates) && scopeStates.length) query = query.in('state', scopeStates)
      return query
    }
    const { data, error } = await readSupabase(lifecycleQueryFactory)
    // Older Supabase schemas do not have lifecycle columns yet. The normal
    // search response remains valid; this optional lookup becomes active
    // automatically once the additive lifecycle migration is applied.
    if (!error) responses.push(...(data || []))
  }

  const stateCodes = stateCodesForSearch(originalQuery)
  if (stateCodes.length) {
    const stateScopedTerms = stateScopedNameTerms(originalQuery).slice(0, MAX_STATE_SCOPED_SEARCH_TERMS)
    if (!stateScopedTerms.length) return [...new Map(responses.flat().map(row => [row.id ?? `${row.google_place_id || ''}:${row.name || ''}:${row.address || ''}`, row])).values()]
    const stateResponses = await Promise.all(stateCodes.map(async stateCode => {
      const { data, error } = await executeSearchQuery((select, searchableColumns) => {
        const scopedSearchFilter = searchableColumns
          .flatMap(column => stateScopedTerms.map(term => `${column}.ilike.${supabaseIlikePattern(term)}`))
          .join(',')
        return supabase
          .from(table)
          .select(select)
          .eq('state', stateCode)
          .or(scopedSearchFilter)
          .order('rating', { ascending: false, nullsFirst: false })
          .limit(Math.min(SEARCH_LOOKUP_LIMIT * stateScopedTerms.length, 1000))
      }, table)

      if (error) throw error
      return data || []
    }))
    responses.push(...stateResponses)
  }

  const byId = new Map()
  for (const row of responses.flat()) {
    byId.set(row.id ?? `${row.google_place_id || ''}:${row.name || ''}:${row.address || ''}`, row)
  }
  return [...byId.values()]
}

// Helper to fetch state counts for aggregate markers, with optional filtering/progressive updates
export async function fetchStateCounts(table, {
  includeStates,
  includeStatuses,
  caseInsensitiveStatuses = false,
  splitEuropeByCountry = false,
  requireRating = false,
  minimumRating = null,
  excludeHistorical = false,
  onProgress,
  progressEveryPages = 1,
} = {}) {
  // Primary markets are a bounded list of explicit regions. Ask PostgREST for
  // exact head counts instead of downloading every matching row just to build
  // aggregate markers. Broad all-market hydration still uses the paginated
  // path below because it must derive international region keys from rows.
  const canUseHeadCounts = Array.isArray(includeStates)
    && includeStates.length > 0
    && includeStates.every(state => !String(state || '').startsWith('EU'))

  const applyCountFilters = (query, applyHistoricalFilter) => {
    let nextQuery = query
    if (Array.isArray(includeStatuses) && includeStatuses.length > 0) {
      if (caseInsensitiveStatuses) {
        const statusOr = includeStatuses
          .map(status => `status.ilike.${String(status).trim().toLowerCase()}*`)
          .join(',')
        nextQuery = nextQuery.or(statusOr)
      } else {
        nextQuery = nextQuery.in('status', includeStatuses)
      }
    }
    if (requireRating) {
      nextQuery = nextQuery.not('rating', 'is', null)
    }
    if (shouldApplyMinimumRating(minimumRating)) {
      nextQuery = nextQuery.gte('rating', Number(minimumRating))
    }
    if (applyHistoricalFilter && !isLegacyPublicSchema(supabase.from, table) && typeof nextQuery.is === 'function') {
      nextQuery = nextQuery.is('lifecycle_status', null)
    }
    return nextQuery
  }

  const fetchHeadCounts = async applyHistoricalFilter => {
    const counts = {}
    let stateIndex = 0
    for (const state of includeStates) {
      const { count, error } = await readSupabase(() => {
        let query = supabase
          .from(table)
          .select('state', { count: 'exact', head: true })
          .in('state', [state])
        query = applyCountFilters(query, applyHistoricalFilter)
        return query
      })
      if (error) throw error
      const numericCount = Number.isFinite(Number(count)) ? Number(count) : 0
      if (numericCount > 0) counts[state] = numericCount
      stateIndex += 1
      if (typeof onProgress === 'function' && stateIndex % progressEveryPages === 0) {
        onProgress({ ...counts })
      }
    }
    if (typeof onProgress === 'function') onProgress({ ...counts })
    return counts
  }

  const fetchCounts = async applyHistoricalFilter => {
    const pageSize = 1000
    const counts = {}
    let offset = 0
    let page = 0

    while (true) {
      const pageOffset = offset
      const { data, error } = await readSupabase(() => {
        let query = supabase
          .from(table)
          .select(splitEuropeByCountry ? 'state,address' : 'state')
          .range(pageOffset, pageOffset + pageSize - 1)

        if (Array.isArray(includeStates) && includeStates.length > 0) {
          query = query.in('state', includeStates)
        }
        query = applyCountFilters(query, applyHistoricalFilter)
        return query
      })

      if (error) throw error
      if (!data || data.length === 0) break

      data.forEach(row => {
        const regionKey = resolveRegionKey(row, splitEuropeByCountry)
        counts[regionKey] = (counts[regionKey] || 0) + 1
      })

      page += 1
      if (typeof onProgress === 'function' && page % progressEveryPages === 0) {
        onProgress({ ...counts })
      }

      if (data.length < pageSize) break
      offset += pageSize
    }

    if (typeof onProgress === 'function') {
      onProgress({ ...counts })
    }

    return counts
  }

  try {
    return canUseHeadCounts
      ? await fetchHeadCounts(excludeHistorical)
      : await fetchCounts(excludeHistorical)
  } catch (error) {
    // Lifecycle columns are additive. Keep the public app usable against an
    // older Supabase schema until the production migration is applied.
    if (excludeHistorical && isMissingSearchColumnError(error)) {
      markLegacyPublicSchema(supabase.from, table)
      return canUseHeadCounts ? fetchHeadCounts(false) : fetchCounts(false)
    }
    throw error
  }
}

const MapView = lazy(() => import('./map'))

const normalizeSearchText = value =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const searchablePlaceText = place => normalizeSearchText([
  place?.name,
  place?.brand,
  place?.operator,
  place?.address,
  place?.website_url,
  place?.phone,
  place?.city,
  place?.state,
  place?.style,
  place?.type,
  place?.price_range,
  place?.price,
  place?.status,
].filter(Boolean).join(' '))

const searchWords = value => normalizeSearchText(value).split(/\s+/).filter(Boolean)

const compactSearchText = value => normalizeSearchText(value).replace(/\s+/g, '')

export const stateCodesForSearch = value => {
  const normalized = normalizeSearchText(value)
  if (!normalized) return []
  const terms = normalized.split(/\s+/).filter(Boolean)
  const codes = new Set()

  for (const term of terms) {
    const upper = term.toUpperCase()
    if (US_STATE_CODES.has(upper)) codes.add(upper)
    if (STATE_SEARCH_ALIASES[term]) codes.add(STATE_SEARCH_ALIASES[term])
  }

  for (const [alias, code] of Object.entries(STATE_SEARCH_ALIASES)) {
    if (alias.includes(' ') && normalized.includes(alias)) {
      codes.add(code)
    }
  }

  return [...codes]
}

export const searchStateCode = value => {
  const normalized = normalizeSearchText(value).toUpperCase()
  if (!normalized) return ''
  if (US_STATE_CODES.has(normalized)) return normalized
  return stateCodesForSearch(value)[0] || normalized
}

const stateAliasTermsForSearch = value => {
  const normalized = normalizeSearchText(value)
  if (!normalized) return new Set()
  const aliases = new Set()
  const inputTerms = new Set(normalized.split(/\s+/).filter(Boolean))

  for (const [alias, code] of Object.entries(STATE_SEARCH_ALIASES)) {
    const matched = alias.includes(' ')
      ? normalized.includes(alias)
      : inputTerms.has(alias)
    if (matched) {
      alias.split(/\s+/).forEach(term => aliases.add(term))
      aliases.add(code.toLowerCase())
    }
  }

  for (const term of inputTerms) {
    if (US_STATE_CODES.has(term.toUpperCase())) aliases.add(term)
  }

  return aliases
}

export const stateScopedNameTerms = value => {
  const stateTerms = stateAliasTermsForSearch(value)
  const terms = searchWords(value)
    .filter(term => term.length >= 2)
    .filter(term => !stateTerms.has(term))
  const adjacentNamePhrases = adjacentSearchPhrases(terms)
    .filter(phrase => phrase.split(/\s+/).some(term => !GENERIC_SEARCH_TERMS.has(term)))
  const usableTerms = meaningfulSearchTerms(terms)
    .filter(term => !stateTerms.has(term))
    .filter(term => !GENERIC_SEARCH_TERMS.has(term))

  return [...new Set([
    ...adjacentNamePhrases,
    ...usableTerms.flatMap(searchTermVariants),
  ])]
    .filter(term => term.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
}

const searchTermVariants = term => {
  const variants = [term]
  if (/^[a-z0-9]{4,}s$/.test(term)) {
    variants.push(term.slice(0, -1))
  }
  if (/^lindustrie[a-z0-9]*$/.test(term)) {
    variants.push(term.slice(1))
  }
  if (SEARCH_TERM_ALIASES[term]) {
    variants.push(...SEARCH_TERM_ALIASES[term])
  }
  return variants
}

const termMatchesText = (text, term) =>
  searchTermVariants(term).some(variant => text.includes(variant))

const termHasStrongPhraseMatch = (text, term) =>
  searchTermVariants(term).some(variant => variant.includes(' ') && text.includes(variant))

const meaningfulSearchTerms = terms => {
  const specificTerms = terms.filter(term => !GENERIC_SEARCH_TERMS.has(term))
  return specificTerms.length ? specificTerms : terms
}

const adjacentSearchPhrases = terms => {
  const phrases = []
  for (let index = 0; index < terms.length - 1; index += 1) {
    const leftVariants = searchTermVariants(terms[index])
    const rightVariants = searchTermVariants(terms[index + 1])
    for (const left of leftVariants) {
      for (const right of rightVariants) {
        phrases.push(`${left} ${right}`)
      }
    }
  }
  return phrases
}

const priceQueryTermsByValue = {
  '$': ['$', 'cheap', 'budget', 'inexpensive', 'affordable'],
  '$$': ['$$', 'moderate', 'midrange', 'mid range'],
  '$$$': ['$$$', 'expensive', 'upscale'],
  '$$$$': ['$$$$', 'premium', 'splurge'],
}

const normalizedPlacePrice = place =>
  String(place?.price_range || place?.priceRange || place?.price || '').trim()

const termMatchesPrice = (term, price) => {
  if (!price) return false
  const variants = priceQueryTermsByValue[price] || []
  return variants.some(variant => normalizeSearchText(variant) === term || variant === term)
}

const isPriceSearchTerm = term =>
  Object.values(priceQueryTermsByValue)
    .flat()
    .some(variant => normalizeSearchText(variant) === term || variant === term)

const queryMatchesPrice = (query, price) => {
  if (!price) return false
  const rawQuery = String(query || '').toLowerCase()
  const symbolicPrices = rawQuery.match(/\${1,4}/g) || []
  if (symbolicPrices.includes(price.toLowerCase())) return true
  const terms = searchWords(query)
  return terms.some(term => termMatchesPrice(term, price))
}

const statusQueryTerms = {
  // Do not treat "Anthony" as a status term: it is commonly part of a place
  // name such as "Anthony's Gourmet Pizza". Use the explicit Picks filter or
  // words like reviewed/visited/tried for personal-history searches.
  reviewed: ['reviewed', 'visited', 'tried'],
  favorite: ['favorite', 'favorites', 'golden', 'best'],
  picks: ['pick', 'picks'],
  suggestion: ['suggestion', 'suggestions', 'unvisited'],
  lifecycle: ['closed', 'historical', 'replaced'],
}

export const readPublicMapQuery = search => {
  const params = new URLSearchParams(search || '')
  const readList = key => [...new Set((params.get(key) || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))]
  const statusValues = (params.get('status') || '')
    .split(',')
    .map(value => value.trim())
    .filter(value => DEFAULT_STATUSES.includes(value))
  return {
    query: params.get('q') || '',
    styles: readList('style'),
    prices: readList('price'),
    statuses: [...new Set(statusValues)],
    anthonysPicks: ['1', 'true', 'yes'].includes(String(params.get('picks') || '').toLowerCase()),
    showHistorical: ['1', 'true', 'yes'].includes(String(params.get('history') || '').toLowerCase()),
    showAllMarkets: ['1', 'true', 'yes', 'all'].includes(String(params.get('scope') || '').toLowerCase()),
  }
}

const normalizedPlaceStatus = place =>
  String(place?.statusRaw ?? place?.status ?? '').trim().toLowerCase()

const isStatusSearchTerm = term =>
  Object.values(statusQueryTerms).some(terms => terms.includes(term))

const termMatchesPlaceStatus = (term, place) => {
  const status = normalizedPlaceStatus(place)
  if (statusQueryTerms.lifecycle.includes(term)) {
    const lifecycle = normalizeLifecycleStatus(place?.lifecycleStatus || place?.lifecycle_status || place?.statusRaw)
    if (term === 'historical') return Boolean(lifecycle)
    if (term === 'closed') return lifecycle === 'closed'
    if (term === 'replaced') return lifecycle === 'replaced'
    return Boolean(lifecycle)
  }
  if (!status) return false
  if (statusQueryTerms.picks.includes(term)) {
    return isAnthonyReviewedPlace(place) && isAnthonysPick(place)
  }
  if (statusQueryTerms.favorite.includes(term)) return status.startsWith('golden')
  if (statusQueryTerms.reviewed.includes(term)) return status.startsWith('visited') || status.startsWith('golden')
  if (statusQueryTerms.suggestion.includes(term)) return status.startsWith('unvisited')
  return false
}

export const isPicksSearchQuery = query => {
  const terms = searchWords(query)
  return terms.includes('picks') || (
    terms.includes('pick') && terms.some(term => ['anthony', 'my', 'top'].includes(term))
  )
}

const queryMatchesPlaceStatus = (terms, place) =>
  terms.some(term => isStatusSearchTerm(term) && termMatchesPlaceStatus(term, place))

export const remoteSearchTerms = query => {
  const terms = searchWords(query).filter(term => term.length >= 2)
  if (!terms.length) return []

  const usableTerms = meaningfulSearchTerms(terms)
  const adjacentPhrases = [
    ...adjacentSearchPhrases(terms),
    ...adjacentSearchPhrases(usableTerms),
  ]
  const expandedTerms = usableTerms.flatMap(searchTermVariants)
  const phrase = normalizeSearchText(query)
  return [...new Set([
    phrase.length >= 3 && phrase.includes(' ') ? phrase : '',
    ...[...new Set(adjacentPhrases)].sort((a, b) => b.length - a.length).slice(0, 4),
    ...expandedTerms.slice().sort((a, b) => b.length - a.length).slice(0, 5),
  ].filter(Boolean))]
}

export const placeSearchRank = (place, query, terms = searchWords(query)) => {
  if (!query || terms.length === 0) return 0
  const name = normalizeSearchText(place?.name)
  const compactName = compactSearchText(place?.name)
  const compactQuery = compactSearchText(query)
  const address = normalizeSearchText(place?.address)
  const addressParts = String(place?.address || '')
    .split(',')
    .map(part => normalizeSearchText(part))
    .filter(Boolean)
  // Some public rows do not have a separate city column, but their address
  // still follows the usual "street, city, state" shape. Treat the
  // post-street portion as location evidence without mistaking "Ann Arbor
  // Road" for the city of Ann Arbor.
  const addressLocationText = addressParts.length > 1 ? addressParts.slice(1).join(' ') : ''
  const normalizedQuery = normalizeSearchText(query)
  const exactLocationMatch = normalizedQuery && (
    normalizeSearchText(place?.city) === normalizedQuery ||
    addressParts.slice(1).some(part => part === normalizedQuery)
  )
  const website = compactSearchText(place?.website_url)
  const phone = compactSearchText(place?.phone)
  const cityState = normalizeSearchText([place?.city, place?.state].filter(Boolean).join(' '))
  const stateCode = searchStateCode(place?.state)
  const locationText = normalizeSearchText([place?.address, place?.city, place?.state].filter(Boolean).join(' '))
  const identityText = normalizeSearchText([place?.name, place?.brand, place?.operator].filter(Boolean).join(' '))
  const compactIdentity = compactSearchText([place?.name, place?.brand, place?.operator].filter(Boolean).join(' '))
  const fullText = searchablePlaceText(place)
  const nameWords = searchWords(place?.name)
  const identityWords = searchWords([place?.name, place?.brand, place?.operator].filter(Boolean).join(' '))
  const meaningfulTerms = meaningfulSearchTerms(terms)
  const hasPicksIntent = isPicksSearchQuery(query)
  const assumedLocationTerm = meaningfulTerms.length >= 2 ? meaningfulTerms[meaningfulTerms.length - 1] : ''
  const assumedNameTerms = assumedLocationTerm ? meaningfulTerms.slice(0, -1) : []
  const price = normalizedPlacePrice(place)
  const hasPriceMatch = queryMatchesPrice(query, price)
  const hasStatusMatch = queryMatchesPlaceStatus(meaningfulTerms, place)
  const hasPriceIntent = meaningfulTerms.some(isPriceSearchTerm) || (String(query || '').match(/\${1,4}/g) || []).length > 0
  const hasStatusIntent = meaningfulTerms.some(isStatusSearchTerm)
  const hasStreetAddressSignal = /\d|\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|highway|hwy|parkway|pkwy|court|ct|place|pl|way)\b/i.test(query)
  const hasWebsiteSignal = /(?:https?:\/\/|www\.|\.(?:com|net|org|us)\b)/i.test(query)
  const hasAddressLocationMatch = addressLocationText && meaningfulTerms.every(term => addressLocationText.includes(term))
  const isCityOnlyLocationQuery = meaningfulTerms.length >= 2 && !hasStreetAddressSignal && !stateCodesForSearch(query).length
    && !hasWebsiteSignal && !cityState.includes(query) && !hasAddressLocationMatch
  const termExplainsMetadataResult = term =>
    (hasPicksIntent && ['anthony', 'my', 'top', 'pick', 'picks'].includes(term)) ||
    termMatchesText(identityText, term) ||
    termMatchesText(locationText, term) ||
    termMatchesPrice(term, price) ||
    termMatchesPlaceStatus(term, place)

  if (name === query) return 0
  if (compactName === compactQuery) return 0.5
  // A city search should open the city, not a business whose name happens to
  // start with that city. Full place-name matches still win above this rule.
  if (exactLocationMatch) return 0.75
  if (website && website.includes(compactQuery) && !isCityOnlyLocationQuery) return 1.25
  if (phone && compactQuery.length >= 4 && phone.includes(compactQuery)) return 1.25
  if (name.startsWith(query)) return 1
  if (compactName.startsWith(compactQuery)) return 1.5
  if (name.includes(query)) return 2
  if (compactQuery.length >= 4 && compactName.includes(compactQuery)) return 2.5
  if (identityText && identityText !== name && identityText.includes(query)) return 3
  if (compactQuery.length >= 4 && compactIdentity !== compactName && compactIdentity.includes(compactQuery)) return 3.5
  if (terms.every(term => nameWords.includes(term))) return 3
  if (terms.every(term => nameWords.some(word => word.startsWith(term)))) return 4
  if (
    assumedNameTerms.length > 0 &&
    assumedNameTerms.every(term => termMatchesText(identityText, term)) &&
    (termMatchesText(cityState, assumedLocationTerm) || stateCodesForSearch(assumedLocationTerm).includes(stateCode))
  ) {
    if (assumedNameTerms.some(term => termHasStrongPhraseMatch(identityText, term))) return 4.5
    return 5
  }
  if (meaningfulTerms.length >= 3) {
    for (let splitIndex = 1; splitIndex < meaningfulTerms.length; splitIndex += 1) {
      const nameTerms = meaningfulTerms.slice(0, splitIndex)
      const locationTerms = meaningfulTerms.slice(splitIndex)
      if (
        nameTerms.every(term => termMatchesText(identityText, term)) &&
        locationTerms.every(term => termMatchesText(cityState, term) || stateCodesForSearch(term).includes(stateCode))
      ) return 5
    }
  }
  if (meaningfulTerms.length >= 2) {
    const hasStrongNameLocationSplit = meaningfulTerms.some((locationTerm, index) => {
      if (!termMatchesText(cityState, locationTerm) && !stateCodesForSearch(locationTerm).includes(stateCode)) return false
      const nameTerms = meaningfulTerms.filter((_, termIndex) => termIndex !== index)
      return (
        nameTerms.length > 0 &&
        nameTerms.some(term => termHasStrongPhraseMatch(identityText, term)) &&
        nameTerms.every(term => termHasStrongPhraseMatch(identityText, term) || identityWords.includes(term))
      )
    })
    if (hasStrongNameLocationSplit) return 5

    const hasNameLocationSplit = meaningfulTerms.some((locationTerm, index) => {
      if (!termMatchesText(cityState, locationTerm) && !stateCodesForSearch(locationTerm).includes(stateCode)) return false
      const nameTerms = meaningfulTerms.filter((_, termIndex) => termIndex !== index)
      return nameTerms.length > 0 && nameTerms.every(term => (
        identityWords.includes(term) || termHasStrongPhraseMatch(identityText, term)
      ))
    })
    if (hasNameLocationSplit) return 5
  }
  if (
    meaningfulTerms.some(term => identityWords.includes(term) || termMatchesText(identityText, term)) &&
    meaningfulTerms.every(term => termMatchesText(identityText, term) || termMatchesText(locationText, term))
  ) return 6
  if (
    meaningfulTerms.length > 0 &&
    !meaningfulTerms.some(term => identityWords.includes(term) || termMatchesText(identityText, term)) &&
    meaningfulTerms.every(term => termMatchesText(locationText, term)) &&
    !isCityOnlyLocationQuery
  ) return 6
  if (
    (hasPriceMatch || hasStatusMatch) &&
    meaningfulTerms.every(termExplainsMetadataResult)
  ) {
    const hasIdentityTerm = meaningfulTerms.some(term => termMatchesText(identityText, term))
    const hasLocationTerm = meaningfulTerms.some(term => termMatchesText(locationText, term))
    if (hasIdentityTerm && hasLocationTerm) return 6.5
    if (hasIdentityTerm || hasLocationTerm) return 7.5
    return 8.5
  }
  if (hasPriceIntent && !hasPriceMatch) return 99
  if (hasStatusIntent && !hasStatusMatch) return 99
  if (terms.every(term => name.includes(term))) return 6
  if (address.includes(query)) return isCityOnlyLocationQuery ? 99 : 6
  if (cityState.includes(query)) return 7
  if (terms.every(term => termMatchesText(address, term))) return isCityOnlyLocationQuery ? 99 : 8
  if (terms.every(term => termMatchesText(cityState, term))) return 9
  if (terms.every(term => termMatchesText(fullText, term))) return isCityOnlyLocationQuery ? 99 : 10
  return 99
}

export const isAnthonyReviewedPlace = place => {
  const statusRaw = String(place?.statusRaw ?? place?.status ?? '').trim().toLowerCase()
  const rating = normalizeRating(place?.rating)
  return (
    (statusRaw.startsWith('visited') || statusRaw.startsWith('golden')) &&
    rating !== null
  )
}

export const isEligibleForAnthonysPicks = (place = {}, options = {}) => (
  isAnthonyReviewedPlace(place) && isAnthonysPick(place, options)
)

export const searchResultPriority = place => {
  if (isAnthonyReviewedPlace(place)) return 0
  if (typeof place?.rating === 'number' && !Number.isNaN(place.rating)) return 1
  if (Array.isArray(place?.photos) && place.photos.length > 0) return 2
  if (place?.photo) return 2
  return 3
}

export const searchLifecyclePriority = place => (
  normalizeLifecycleStatus(place?.lifecycleStatus || place?.lifecycle_status || place?.statusRaw) ? 1 : 0
)

export const searchStatePriority = (place, preferredStates = []) => {
  const state = searchStateCode(place?.state)
  const index = preferredStates.indexOf(state)
  return index === -1 ? preferredStates.length : index
}

export const compareSearchResults = (a, b, options = {}) => {
  const preferredStates = Array.isArray(options.preferredStates) ? options.preferredStates : []

  if (options.prioritizeCurrent) {
    const lifecycleDelta = searchLifecyclePriority(a) - searchLifecyclePriority(b)
    if (lifecycleDelta !== 0) return lifecycleDelta
  }

  // An exact identity match is the user's clearest signal. Do this before
  // market preference only when lifecycle status has not already established
  // that a current record should lead its historical predecessor.
  const aIsExactIdentity = (a?._searchRank ?? 99) <= 0.5
  const bIsExactIdentity = (b?._searchRank ?? 99) <= 0.5
  if (aIsExactIdentity !== bIsExactIdentity) return aIsExactIdentity ? -1 : 1

  if (preferredStates.length) {
    const localityDelta = searchStatePriority(a, preferredStates) - searchStatePriority(b, preferredStates)
    if (localityDelta !== 0) return localityDelta
  }

  const rankDelta = (a?._searchRank ?? 99) - (b?._searchRank ?? 99)
  if (rankDelta !== 0) return rankDelta

  // When a chain or common name produces several exact matches, prefer the
  // records a person can actually locate on the map. Keep incomplete rows in
  // the result set, but do not let them displace a branch with an address or
  // coordinates.
  const locationDelta = searchResultLocationQuality(a) - searchResultLocationQuality(b)
  if (locationDelta !== 0) return locationDelta

  const priorityDelta = searchResultPriority(a) - searchResultPriority(b)
  if (priorityDelta !== 0) return priorityDelta

  const ratingDelta = (Number(b?.rating) || 0) - (Number(a?.rating) || 0)
  if (ratingDelta !== 0) return ratingDelta

  return String(a?.name || '').localeCompare(String(b?.name || ''))
}

const hasUsableSearchAddress = place => {
  const address = normalizeSearchText(place?.address)
  const state = normalizeSearchText(place?.state)
  if (!address || address === state || address === 'unknown' || address === 'not available') return false
  // A useful address normally includes a street number or enough text to be
  // more than a region-only placeholder. Keep this intentionally conservative
  // so two legitimate same-name locations are never collapsed accidentally.
  return /\d/.test(address) || address.length >= 8
}

const hasUsableSearchCoordinates = place => (
  typeof place?.lat === 'number' && Number.isFinite(place.lat) &&
  typeof place?.lng === 'number' && Number.isFinite(place.lng)
)

const searchResultLocationQuality = place => {
  const hasAddress = hasUsableSearchAddress(place)
  const hasCoordinates = hasUsableSearchCoordinates(place)
  if (hasAddress && hasCoordinates) return 0
  if (hasAddress || hasCoordinates) return 1
  return 2
}

const normalizeSearchStreet = value => normalizeSearchText(String(value || '').split(',')[0])
  .replace(/\bnorth\b/g, 'n')
  .replace(/\bsouth\b/g, 's')
  .replace(/\beast\b/g, 'e')
  .replace(/\bwest\b/g, 'w')
  .replace(/\b(?:street|st)\b/g, 'st')
  .replace(/\b(?:road|rd)\b/g, 'rd')
  .replace(/\b(?:avenue|ave)\b/g, 'ave')
  .replace(/\b(?:boulevard|blvd)\b/g, 'blvd')
  .replace(/\b(?:drive|dr)\b/g, 'dr')
  .replace(/\b(?:lane|ln)\b/g, 'ln')
  .replace(/\b(?:highway|hwy)\b/g, 'hwy')
  .replace(/\b(?:parkway|pkwy)\b/g, 'pkwy')
  .replace(/\s+/g, ' ')
  .trim()

const searchAddressIdentity = place => {
  const street = normalizeSearchStreet(place?.address)
  return /\d/.test(street) ? street : ''
}

const searchPhoneIdentity = value => {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length > 10 ? digits.slice(-10) : digits
}

const searchWebsiteIdentity = value => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

const strongSearchIdentity = place => {
  const lifecycle = normalizeLifecycleStatus(place?.lifecycleStatus || place?.lifecycle_status || place?.statusRaw)
  // A current record and its historical predecessor can intentionally share
  // an address. Never collapse that relationship from contact evidence alone.
  if (lifecycle) return ''

  const state = normalizeSearchText(place?.state)
  const googlePlaceId = normalizeSearchText(place?.google_place_id || place?.googlePlaceId)
  if (googlePlaceId) return `google:${googlePlaceId}`

  const street = searchAddressIdentity(place)
  if (!state || !street) return ''
  const phone = searchPhoneIdentity(place?.phone)
  if (phone.length >= 7) return `phone:${state}|${street}|${phone}`
  const website = searchWebsiteIdentity(place?.website_url || place?.websiteUrl)
  return website ? `website:${state}|${street}|${website}` : ''
}

const strongerSearchRow = (left, right) => (
  compareSearchResults(left, right) <= 0 ? left : right
)

export const dedupeSearchRows = rows => {
  const sourceRows = Array.isArray(rows) ? rows : []
  const parents = sourceRows.map((_, index) => index)
  const keyOwners = new Map()

  const find = index => {
    let root = index
    while (parents[root] !== root) root = parents[root]
    while (parents[index] !== index) {
      const next = parents[index]
      parents[index] = root
      index = next
    }
    return root
  }

  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }

  sourceRows.forEach((row, index) => {
    const lifecycle = normalizeLifecycleStatus(row?.lifecycleStatus || row?.lifecycle_status || row?.statusRaw)
    const lifecycleBucket = lifecycle ? `historical:${lifecycle}` : 'current'
    const name = normalizeSearchText(row?.name)
    const state = normalizeSearchText(row?.state)
    const street = searchAddressIdentity(row)
    const baseIdentity = name && state
      ? `base:${lifecycleBucket}|${name}|${state}|${street || 'no-street'}`
      : ''
    const keys = [baseIdentity, strongSearchIdentity(row) ? `strong:${strongSearchIdentity(row)}` : '']
      .filter(Boolean)

    keys.forEach(key => {
      const owner = keyOwners.get(key)
      if (owner === undefined) keyOwners.set(key, index)
      else union(index, owner)
    })
  })

  const groups = new Map()
  const ungrouped = []
  sourceRows.forEach((row, index) => {
    const name = normalizeSearchText(row?.name)
    const state = normalizeSearchText(row?.state)
    if ((!name || !state) && !strongSearchIdentity(row)) {
      ungrouped.push(row)
      return
    }
    const root = find(index)
    const group = groups.get(root) || []
    group.push(row)
    groups.set(root, group)
  })

  const groupNameKey = group => {
    const first = group[0]
    const lifecycle = normalizeLifecycleStatus(first?.lifecycleStatus || first?.lifecycle_status || first?.statusRaw)
    return `${normalizeSearchText(first?.name)}|${normalizeSearchText(first?.state)}|${lifecycle || 'current'}`
  }
  const locatedNameKeys = new Set(
    [...groups.values()]
      .filter(group => group.some(hasUsableSearchAddress))
      .map(groupNameKey)
  )

  return [
    ...ungrouped,
    ...[...groups.values()].flatMap(group => {
      if (!group.some(hasUsableSearchAddress) && locatedNameKeys.has(groupNameKey(group))) return []
      // Strong identifiers can span different source names or languages.
      // Keep the strongest canonical representation in the public result.
      if (group.some(strongSearchIdentity) && group.every(row => !normalizeLifecycleStatus(row?.lifecycleStatus || row?.lifecycle_status || row?.statusRaw))) {
        return [group.reduce(strongerSearchRow)]
      }
      const located = group.filter(hasUsableSearchAddress)
      if (!located.length) return group

      // Source providers spell the same street in incompatible ways (for
      // example, "East William Street" versus "E William St"). Collapse only
      // an exact normalized street identity, retaining distinct branches.
      const byStreet = new Map()
      const withoutStreetIdentity = []
      located.forEach(row => {
        const street = searchAddressIdentity(row)
        if (!street) {
          withoutStreetIdentity.push(row)
          return
        }
        const existing = byStreet.get(street)
        byStreet.set(street, existing ? strongerSearchRow(existing, row) : row)
      })

      return [...byStreet.values(), ...withoutStreetIdentity]
    }),
  ]
}

export const rankSearchRows = (rows, query, options = {}) => {
  const normalizedQuery = normalizeSearchText(query)
  const terms = searchWords(query)
  return dedupeSearchRows(rows)
    .map(row => ({
      ...row,
      _searchRank: placeSearchRank(row, normalizedQuery, terms),
    }))
    .filter(row => row._searchRank < 99)
    .sort((left, right) => compareSearchResults(left, right, options))
}

const REGION_COUNTS_CACHE = new Map()
const ANTHONY_COUNTS_CACHE = new Map()
const ANTHONY_PICKS_COUNTS_CACHE = new Map()
const MAP_COUNTS_CACHE_TTL_MS = 15 * 60 * 1000
const MAP_COUNTS_STORAGE_PREFIX = 'apizza:map-counts:'

const readPersistedMapCounts = key => readExpiringBrowserCache(
  `${MAP_COUNTS_STORAGE_PREFIX}${key}`,
  { storage: typeof window === 'undefined' ? null : window.localStorage, ttlMs: MAP_COUNTS_CACHE_TTL_MS },
)

const writePersistedMapCounts = (key, counts) => writeExpiringBrowserCache(
  `${MAP_COUNTS_STORAGE_PREFIX}${key}`,
  counts,
  { storage: typeof window === 'undefined' ? null : window.localStorage, ttlMs: MAP_COUNTS_CACHE_TTL_MS },
)

const buildRegionStatesFromCounts = (counts, existing = {}) => {
  const next = { ...existing }
  Object.entries(counts || {}).forEach(([stateCode, count]) => {
    if (stateCode === 'Unknown' || !STATE_CENTROIDS[stateCode]) return
    const previous = next[stateCode]
    next[stateCode] = previous
      ? { ...previous, originalCount: count }
      : { status: 'unloaded', originalCount: count, places: [] }
  })
  return next
}

const REVIEW_PHOTO_BUCKET = 'review-photos'
const REVIEW_PHOTO_TABLE = 'review-photos'
let reviewPhotosTableAvailable = true

const DEFAULT_STATUSES = ['visited', 'unvisited', 'golden']
const FAVORITE_FLAG_FIELDS = ['favorited', 'is_favorited', 'isFavorite', 'is_favorite', 'favorite']
const VALID_PLACE_TYPES = new Set(['pizzeria', 'taqueria', 'tamaleria'])
const PLACE_TYPE_FIELDS = ['place_type', 'placeType', 'place_category', 'placeCategory']
const MARKER_ICON_FIELDS = ['marker_icon_url', 'markerIconUrl', 'icon_url', 'iconUrl']
const normalizeRegionCode = value => (typeof value === 'string' ? value.trim().toUpperCase() : '')
const isPlaceInPublicScope = (place, showAllMarkets, publicScopeStates) => (
  showAllMarkets || !publicScopeStates.length || publicScopeStates.includes(normalizeRegionCode(place?.state))
)
const EUROPE_COUNTRY_BY_ADDRESS_NAME = {
  SPAIN: 'EU_ES',
  ITALY: 'EU_IT',
  NETHERLANDS: 'EU_NL',
  CZECHIA: 'EU_CZ',
  'CZECH REPUBLIC': 'EU_CZ',
}

const resolveRegionKey = ({ state, address }, splitEuropeByCountry = false) => {
  const normalizedState = normalizeRegionCode(state)
  if (!normalizedState) return 'Unknown'
  if (!splitEuropeByCountry || normalizedState !== 'EU') return normalizedState

  const addressParts = typeof address === 'string'
    ? address.split(',').map(part => part.trim()).filter(Boolean)
    : []
  const countryName = addressParts.length
    ? addressParts[addressParts.length - 1].toUpperCase()
    : ''

  return EUROPE_COUNTRY_BY_ADDRESS_NAME[countryName] || 'EU'
}

const normalizeStatus = (status) => {
  if (typeof status === 'string') {
    const lower = status.toLowerCase()
    if (DEFAULT_STATUSES.includes(lower)) {
      return lower
    }
  }
  return 'visited'
}

const convertLegacyPhotos = photos =>
  Array.isArray(photos)
    ? photos
        .filter(Boolean)
        .map((url, index) => ({
          id: `${url}-${index}`,
          path: url,
          publicUrl: url,
          sortOrder: index + 1,
        }))
    : []

async function fetchPhotoMap(placeIds = []) {
  if (!reviewPhotosTableAvailable) {
    return {}
  }
  if (!Array.isArray(placeIds) || placeIds.length === 0) {
    return {}
  }

  try {
    const { data, error } = await supabase
      .from(REVIEW_PHOTO_TABLE)
      .select('id, place_id, storage_path, sort_order')
      .in('place_id', placeIds)
      .order('sort_order', { ascending: true })

    if (error) throw error

    const storage = supabase.storage?.from?.(REVIEW_PHOTO_BUCKET)
    return (data || []).reduce((acc, photo) => {
      let publicUrl = null
      if (storage) {
        const { data: publicData, error: publicError } = storage.getPublicUrl(photo.storage_path)
        if (publicError) {
          console.warn('[photos] failed to compute public URL', publicError)
        } else {
          publicUrl = publicData?.publicUrl ?? null
        }
      }

      const mapped = {
        id: photo.id,
        path: photo.storage_path,
        sortOrder: photo.sort_order,
        publicUrl,
      }

      if (!acc[photo.place_id]) {
        acc[photo.place_id] = [mapped]
      } else {
        acc[photo.place_id].push(mapped)
      }
      return acc
    }, {})
  } catch (err) {
    if (err?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      return {}
    }
    console.warn('[photos] review photo fetch error', err)
    return {}
  }
}

const parseBoolean = value => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    return ['true', '1', 'yes', 'y'].includes(normalized)
  }
  return null
}

const computeFavorited = (place = {}, normalizedStatus = 'visited') => {
  for (const field of FAVORITE_FLAG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(place, field)) {
      const parsed = parseBoolean(place[field])
      if (parsed !== null) return parsed
    }
  }
  return normalizedStatus === 'golden'
}

export const isAnthonysPick = (place = {}, options = {}) => {
  const rating = normalizeRating(place.rating)
  const minimumRating = Number(options.minimumRating)
  const threshold = Number.isFinite(minimumRating) ? minimumRating : 8
  return rating !== null && rating >= threshold
}

const computePlaceType = (place = {}, fallback) => {
  for (const field of PLACE_TYPE_FIELDS) {
    const value = place[field]
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().toLowerCase()
      if (VALID_PLACE_TYPES.has(normalized)) {
        return normalized
      }
    }
  }
  return fallback
}

const computeMarkerIconUrl = (place = {}) => {
  for (const field of MARKER_ICON_FIELDS) {
    const value = place[field]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function SiteContainer({ themeKey }) {
  // Seed public state from the URL during the first render. Reading it in an
  // effect allowed the URL-sync effect below to erase a shared search before
  // the state update landed.
  const initialPublicQuery = React.useRef(
    readPublicMapQuery(typeof window === 'undefined' ? '' : window.location.search)
  ).current
  const [filters, setFilters] = useState(() => ({
    styles: initialPublicQuery.styles,
    prices: initialPublicQuery.prices,
    statuses: initialPublicQuery.statuses,
  }))
  const [view, setView] = useState('map')
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState(null)
  const [showClusterCounts, setShowClusterCounts] = useState(true)
  const [showAnthonysVisits, setShowAnthonysVisits] = useState(false)
  const [showAnthonysPicks, setShowAnthonysPicks] = useState(initialPublicQuery.anthonysPicks)
  const [showHistorical, setShowHistorical] = useState(initialPublicQuery.showHistorical)
  const [anthonysCountsByState, setAnthonysCountsByState] = useState({})
  const [anthonysPickCountsByState, setAnthonysPickCountsByState] = useState({})

  // Search and Near Me state
  const [searchQuery, setSearchQuery] = useState(initialPublicQuery.query)
  const [searchPlaces, setSearchPlaces] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [searchNotice, setSearchNotice] = useState(null)
  const [searchRetryToken, setSearchRetryToken] = useState(0)
  const [showAllMarkets, setShowAllMarkets] = useState(initialPublicQuery.showAllMarkets)
  const searchRequestIdRef = React.useRef(0)
  const [userLocation, setUserLocation] = useState(null)
  const [nearMeActive, setNearMeActive] = useState(false)
  const [nearMeRadius, setNearMeRadius] = useState(25)
  const [locationError, setLocationError] = useState(null)
  const [flyToLocation, setFlyToLocation] = useState(null)
  const [sortMode, setSortMode] = useState('recommended')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [visibleMapBounds, setVisibleMapBounds] = useState(null)
  const [appliedMapBounds, setAppliedMapBounds] = useState(null)
  const [mapMoved, setMapMoved] = useState(false)

  // Three-state region model: UNLOADED -> LOADING -> LOADED
  // Shape: { [stateCode]: { status: 'unloaded'|'loading'|'loaded', places: [], originalCount } }
  const [regionStates, setRegionStates] = useState({})
  const loadingStatesRef = React.useRef(new Set())

  const { theme } = useTheme()
  const entity = entityConfigForTheme(themeKey)
  const entityTable = entity.table
  const picksConfig = entity.editorial?.picks || {}
  const picksMinimumRating = Number.isFinite(Number(picksConfig.minimumRating))
    ? Number(picksConfig.minimumRating)
    : 8
  const picksLabel = picksConfig.label || "Anthony's Picks"
  const preferredSearchStates = useMemo(() => theme.search?.preferredStates || [], [theme])
  const publicScopeStates = useMemo(() => (
    theme.search?.publicStates || theme.search?.preferredStates || []
  ), [theme])
  const initialStates = useMemo(() => (
    Array.isArray(theme.search?.initialStates)
      ? theme.search.initialStates
      : (theme.search?.preferredStates || [])
  ), [theme])
  const { open: openMapPopup } = useMapPopup()
  const { selectedPlace } = useSelectedPlace()
  const { open: openLoading, close: closeLoading, setVariant: setLoadingVariant } = useGlobalLoading()

  const handleFilterChange = useCallback(next => setFilters(next), [])

  const handleMapViewportChange = useCallback((bounds, initial = false) => {
    if (!bounds) return
    setVisibleMapBounds(bounds)
    if (!initial) {
      setMapMoved(true)
    }
  }, [])

  useEffect(() => {
    setVisibleMapBounds(null)
    setAppliedMapBounds(null)
    setMapMoved(false)
    setSortMode('recommended')
  }, [themeKey, showAllMarkets])

  useEffect(() => {
    document.body.style.backgroundColor = theme.palette.bg
    document.body.style.color = theme.palette.text
  }, [theme])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const currentStyles = filters.styles || []
    const currentPrices = filters.prices || []
    const currentStatuses = filters.statuses || []
    if (currentStyles.length) {
      params.set('style', currentStyles.join(','))
    } else {
      params.delete('style')
    }
    if (currentPrices.length) {
      params.set('price', currentPrices.join(','))
    } else {
      params.delete('price')
    }
    if (currentStatuses.length && currentStatuses.length !== DEFAULT_STATUSES.length) {
      params.set('status', currentStatuses.join(','))
    } else {
      params.delete('status')
    }
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim())
    } else {
      params.delete('q')
    }
    if (showAnthonysPicks) {
      params.set('picks', '1')
    } else {
      params.delete('picks')
    }
    if (showHistorical) {
      params.set('history', '1')
    } else {
      params.delete('history')
    }
    if (showAllMarkets) {
      params.set('scope', 'all')
    } else {
      params.delete('scope')
    }
    const next = params.toString()
    const newUrl = next ? `${window.location.pathname}?${next}` : window.location.pathname
    window.history.replaceState({}, '', newUrl)
  }, [filters.styles, filters.prices, filters.statuses, searchQuery, showAnthonysPicks, showHistorical, showAllMarkets])

  useEffect(() => {
    const pageTitle = entity.pageTitle
    const description = entity.pageDescription

    document.title = pageTitle

    const setFavicon = (href) => {
      if (typeof document === 'undefined') return
      let link = document.querySelector("link[rel='icon']")
      if (!link) {
        link = document.createElement('link')
        link.setAttribute('rel', 'icon')
        document.head.appendChild(link)
      }
      link.setAttribute('href', href)
    }

    const upsertMeta = (attr, key, value) => {
      if (!value) return
      let meta = document.querySelector(`meta[${attr}="${key}"]`)
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute(attr, key)
        document.head.appendChild(meta)
      }
      meta.setAttribute('content', value)
    }

    upsertMeta('name', 'description', description)
    upsertMeta('property', 'og:title', pageTitle)
    upsertMeta('property', 'og:description', description)
    setFavicon(entity.favicon)
  }, [entity])

  useEffect(() => {
    setLoadingVariant(entity.loadingVariant)
  }, [entity, setLoadingVariant])

  // Normalize place data (extracted for reuse)
  const normalizePlaceData = useCallback((data, photoMap, defaultPlaceType) => {
    return (data || []).map((place, index) => {
      const canonicalId =
        place.id ??
        place.ID ??
        place.place_id ??
        place.slug ??
        `${entity.entity}-${index}`
      const normalizedPhotos = (() => {
        const fromMap = Array.isArray(photoMap[place.id]) ? photoMap[place.id] : []
        const fallback = convertLegacyPhotos(place.photos)
        const combined = fromMap.length > 0 ? fromMap : fallback
        return combined
          .slice()
          .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))
      })()
      const firstPhoto = normalizedPhotos.length
        ? normalizedPhotos[0]?.publicUrl || normalizedPhotos[0]?.path || normalizedPhotos[0]
        : place.photo_url || place.photoPath || null

      const normalizedLat = typeof place.lat === 'number' ? place.lat : Number(place.lat)
      const normalizedLng = typeof place.lng === 'number' ? place.lng : Number(place.lng)

      const normalizedStatus = normalizeStatus(place.status)
      const lifecycleStatus = normalizeLifecycleStatus(place.lifecycle_status || place.lifecycleStatus || place.status)
      const replacementId = place.lifecycle_replaced_by_id ?? place.lifecycleReplacedById ?? null
      const favorited = computeFavorited(place, normalizedStatus)
      const placeType = computePlaceType(place, defaultPlaceType)
      const markerIconUrl = computeMarkerIconUrl(place)
      const normalizedPrice = place.price || place.Price || ''
      const normalizedPriceRange = place.price_range || place.priceRange || normalizedPrice
      const rawStyle = place.style || null

      return {
        ...place,
        id: canonicalId,
        type: entity.entity,
        raw_style: rawStyle,
        style: normalizeEntityStyle(entity.entity, entity.entity === 'taco' ? place.type || place.style : place.style),
        price: normalizedPrice,
        price_range: normalizedPriceRange,
        priceRange: normalizedPriceRange,
        status: normalizedStatus,
        statusRaw: typeof place.status === 'string' ? place.status.trim().toLowerCase() : null,
        rating: normalizeRating(place.rating),
        lifecycleStatus,
        lifecycle_status: place.lifecycle_status || null,
        lifecycle_replaced_by_id: replacementId,
        favorited,
        lat: normalizedLat,
        lng: normalizedLng,
        address: place.address || place.Address || '',
        photoUrl: typeof firstPhoto === 'string' ? firstPhoto : null,
        photos: normalizedPhotos,
        place_type: placeType,
        placeType,
        marker_icon_url: markerIconUrl,
        markerIconUrl,
      }
    })
  }, [entity.entity])

  // Initial load: prioritize Michigan + nearby states, then progressively hydrate the rest
  useEffect(() => {
    let isMounted = true

    async function initialLoad() {
      setMapLoading(true)
      openLoading(theme.copy.loading || 'Loading map…')
      const table = entityTable
      try {
        const scopeKey = initialStates.length ? initialStates.join(',') : 'all'
        const regionCountsKey = `${table}:${showHistorical ? 'all' : 'active'}:${scopeKey}`
        const cachedRegionCounts = REGION_COUNTS_CACHE.get(regionCountsKey) || readPersistedMapCounts(regionCountsKey)
        const cachedAnthonyCounts = ANTHONY_COUNTS_CACHE.get(regionCountsKey) || readPersistedMapCounts(`${regionCountsKey}:reviewed`)

        if (cachedRegionCounts) REGION_COUNTS_CACHE.set(regionCountsKey, cachedRegionCounts)
        if (cachedAnthonyCounts) ANTHONY_COUNTS_CACHE.set(regionCountsKey, cachedAnthonyCounts)

        if (cachedAnthonyCounts) {
          setAnthonysCountsByState(cachedAnthonyCounts)
        } else {
          setAnthonysCountsByState({})
        }

        if (cachedRegionCounts && cachedAnthonyCounts) {
          setRegionStates(buildRegionStatesFromCounts(cachedRegionCounts))
          setMapError(null)
          setMapLoading(false)
          closeLoading()
        } else {
          const [priorityCounts, priorityAnthonyCounts] = await Promise.all([
            cachedRegionCounts
              ? Promise.resolve(cachedRegionCounts)
              : fetchStateCounts(table, { includeStates: initialStates, excludeHistorical: !showHistorical }),
            cachedAnthonyCounts
              ? Promise.resolve(cachedAnthonyCounts)
              : fetchStateCounts(table, {
                includeStates: initialStates,
                includeStatuses: ['visited', 'golden'],
                splitEuropeByCountry: true,
                requireRating: true,
                excludeHistorical: !showHistorical,
              }),
          ])
          if (!isMounted) return

          setRegionStates(buildRegionStatesFromCounts(priorityCounts))
          setAnthonysCountsByState(priorityAnthonyCounts)
          REGION_COUNTS_CACHE.set(regionCountsKey, priorityCounts)
          ANTHONY_COUNTS_CACHE.set(regionCountsKey, priorityAnthonyCounts)
          writePersistedMapCounts(regionCountsKey, priorityCounts)
          writePersistedMapCounts(`${regionCountsKey}:reviewed`, priorityAnthonyCounts)
          setMapError(null)
          setMapLoading(false)
          closeLoading()
        }

      } catch (error) {
        if (!isMounted) return
        console.error('[App] Failed to load region counts:', error)
        setMapError(error)
        setMapLoading(false)
        closeLoading()
      }
    }

    initialLoad()
    return () => {
      isMounted = false
      closeLoading()
    }
  }, [themeKey, entityTable, theme.copy.loading, initialStates, openLoading, closeLoading, showHistorical])

  // The default map only needs the configured primary states. Loading every
  // market is explicit because this aggregate query scans the public table.
  useEffect(() => {
    if (!showAllMarkets) return undefined

    let isMounted = true
    const table = entityTable
    const countsKey = `${table}:${showHistorical ? 'all' : 'active'}:all`
    const cachedCounts = REGION_COUNTS_CACHE.get(countsKey) || readPersistedMapCounts(countsKey)
    if (cachedCounts) {
      REGION_COUNTS_CACHE.set(countsKey, cachedCounts)
      setRegionStates(prev => buildRegionStatesFromCounts(cachedCounts, prev))
      return () => {
        isMounted = false
      }
    }

    fetchStateCounts(table, {
      excludeHistorical: !showHistorical,
      onProgress: counts => {
        if (!isMounted) return
        REGION_COUNTS_CACHE.set(countsKey, counts)
        writePersistedMapCounts(countsKey, counts)
        setRegionStates(prev => buildRegionStatesFromCounts(counts, prev))
      },
      progressEveryPages: 3,
    }).catch(error => {
      if (!isMounted) return
      console.warn('[App] All-markets region hydration failed:', error)
    })

    return () => {
      isMounted = false
    }
  }, [themeKey, entityTable, showAllMarkets, showHistorical])

  // Primary-state reviewed counts arrive with the initial load. Only scan
  // the complete table when the user explicitly asks for all-market reviews.
  useEffect(() => {
    if (!showAllMarkets || !showAnthonysVisits) return undefined

    let isMounted = true
    const table = entityTable
    const countsKey = `${table}:${showHistorical ? 'all' : 'active'}:all-reviewed`
    const cachedCounts = ANTHONY_COUNTS_CACHE.get(countsKey) || readPersistedMapCounts(`${countsKey}:reviewed`)
    if (cachedCounts) {
      ANTHONY_COUNTS_CACHE.set(countsKey, cachedCounts)
      setAnthonysCountsByState(cachedCounts)
      return () => {
        isMounted = false
      }
    }

    fetchStateCounts(table, {
      includeStatuses: ['visited', 'golden'],
      splitEuropeByCountry: true,
      requireRating: true,
      excludeHistorical: !showHistorical,
      onProgress: counts => {
        if (!isMounted) return
        ANTHONY_COUNTS_CACHE.set(countsKey, counts)
        writePersistedMapCounts(`${countsKey}:reviewed`, counts)
        setAnthonysCountsByState(counts)
      },
      progressEveryPages: 3,
    }).catch(error => {
      if (!isMounted) return
      console.warn('[App] All-markets reviewed-count hydration failed:', error)
    })

    return () => {
      isMounted = false
    }
  }, [themeKey, entityTable, showAllMarkets, showAnthonysVisits, showHistorical])

  // Picks is an opt-in view. Avoid another full-table count scan on ordinary
  // map loads, especially on the smallest Supabase compute tier.
  useEffect(() => {
    if (!showAnthonysPicks) return undefined

    let isMounted = true
    const table = entityTable
    const countsKey = `${table}:${showHistorical ? 'all' : 'active'}`
    const cachedCounts = ANTHONY_PICKS_COUNTS_CACHE.get(countsKey) || readPersistedMapCounts(`${countsKey}:picks`)
    if (cachedCounts) {
      ANTHONY_PICKS_COUNTS_CACHE.set(countsKey, cachedCounts)
      setAnthonysPickCountsByState(cachedCounts)
      return () => {
        isMounted = false
      }
    }

    fetchStateCounts(table, {
      includeStatuses: ['visited', 'golden'],
      splitEuropeByCountry: true,
      requireRating: true,
      minimumRating: picksMinimumRating,
      excludeHistorical: !showHistorical,
      onProgress: (counts) => {
        if (!isMounted) return
        ANTHONY_PICKS_COUNTS_CACHE.set(countsKey, counts)
        writePersistedMapCounts(`${countsKey}:picks`, counts)
        setAnthonysPickCountsByState(counts)
      },
      progressEveryPages: 1,
    }).catch(error => {
      if (!isMounted) return
      console.warn('[App] Anthony pick counts hydration failed:', error)
    })

    return () => {
      isMounted = false
    }
  }, [themeKey, entityTable, showAnthonysPicks, showHistorical, picksMinimumRating])

  // Load places for a region when clicked or zoomed into
  const handleStateClick = useCallback(async (stateCode) => {
    if (!stateCode || loadingStatesRef.current.has(stateCode)) {
      return
    }

    const loadKey = stateCode.startsWith('EU_') ? 'EU' : stateCode
    const region = regionStates[loadKey]
    // Only load if unloaded (not loading or already loaded)
    if (!region || region.status !== 'unloaded') {
      return
    }

    // Mark as loading (aggregate stays visible with spinner)
    setRegionStates(prev => ({
      ...prev,
      [loadKey]: { ...prev[loadKey], status: 'loading' }
    }))
    loadingStatesRef.current.add(loadKey)

    const defaultPlaceType = entity.defaultPlaceType
    const table = entityTable

    try {
      const stateData = await fetchPlacesForState(table, loadKey)

      // Region loading should stay focused on map data. Review photos are
      // loaded lazily when a user opens a place popup; fetching every photo in
      // a state-sized batch creates unnecessary database and storage work.
      const normalized = normalizePlaceData(stateData, {}, defaultPlaceType)

      // Mark as loaded (aggregate hides, markers show)
      setRegionStates(prev => ({
        ...prev,
        [loadKey]: { ...prev[loadKey], status: 'loaded', places: normalized }
      }))
      return normalized
    } catch (err) {
      // Revert to unloaded on error (aggregate stays visible)
      setRegionStates(prev => ({
        ...prev,
        [loadKey]: { ...prev[loadKey], status: 'unloaded' }
      }))
      console.error(`[App] Failed to load region ${loadKey}:`, err)
      return null
    } finally {
      loadingStatesRef.current.delete(loadKey)
    }
  }, [regionStates, entity.defaultPlaceType, entityTable, normalizePlaceData])

  // Keep a normalized local set available as a graceful search fallback when
  // the remote lookup is temporarily unavailable.
  const allLoadedPlaces = useMemo(() => {
    const loadedPlaces = Object.values(regionStates)
      .filter(r => r.status === 'loaded')
      .flatMap(r => r.places)
    return dedupeSearchRows(loadedPlaces)
  }, [regionStates])

  useEffect(() => {
    let isMounted = true
    const requestId = searchRequestIdRef.current + 1
    searchRequestIdRef.current = requestId
    const isCurrentRequest = () => isMounted && searchRequestIdRef.current === requestId
    const lookupTerms = remoteSearchTerms(searchQuery)

    if (!lookupTerms.length) {
      setSearchPlaces([])
      setSearchError(null)
      setSearchNotice(null)
      setSearchLoading(false)
      return () => {
        isMounted = false
      }
    }

    async function loadSearchPlaces() {
      setSearchLoading(true)
      setSearchError(null)
      setSearchNotice(null)
      setSearchPlaces([])
      const table = entityTable
      const defaultPlaceType = entity.defaultPlaceType

      try {
      const scopeKey = showAllMarkets ? 'all' : publicScopeStates.join(',')
      const cacheKey = `${table}|${scopeKey}|${normalizeSearchText(searchQuery)}|${lookupTerms.join('|')}`
      const cachedRows = readSearchCache(cacheKey)
      const rows = cachedRows || await fetchPlacesForSearch(
        table,
        lookupTerms,
        searchQuery,
        showAllMarkets ? [] : publicScopeStates
      )
        if (!cachedRows) writeSearchCache(cacheKey, rows)
        if (!isCurrentRequest()) return

        // Rank and cap before loading photo metadata. Broad searches such as
        // "pizza" can otherwise turn one keystroke into hundreds of photo
        // requests before the map has anything useful to render.
        const rankedRows = rankSearchRows(rows, searchQuery)
          .slice(0, SEARCH_RESULT_LIMIT)

        let photoMap = {}
        const placeIds = rankedRows.slice(0, SEARCH_PHOTO_LIMIT).map(p => p.id).filter(Boolean)
        if (placeIds.length) {
          try {
            photoMap = await fetchPhotoMap(placeIds)
          } catch (err) {
            console.warn('[App] Search photo fetch failed:', err)
          }
        }

        if (!isCurrentRequest()) return
        setSearchPlaces(normalizePlaceData(rankedRows, photoMap, defaultPlaceType))
      } catch (err) {
        if (!isCurrentRequest()) return
        const fallbackRows = rankSearchRows(allLoadedPlaces, searchQuery)
          .slice(0, SEARCH_RESULT_LIMIT)
        if (fallbackRows.length) {
          setSearchPlaces(normalizePlaceData(fallbackRows, {}, defaultPlaceType))
          setSearchNotice('Search is temporarily unavailable. Showing places already loaded on the map.')
          setSearchError(null)
        } else {
          setSearchPlaces([])
          setSearchError(err)
        }
        console.warn('[App] Search lookup failed:', err)
      } finally {
        if (isCurrentRequest()) setSearchLoading(false)
      }
    }

    const debounceTimer = window.setTimeout(loadSearchPlaces, 250)
    return () => {
      isMounted = false
      window.clearTimeout(debounceTimer)
    }
  }, [searchQuery, searchRetryToken, themeKey, entity.defaultPlaceType, entityTable, normalizePlaceData, showAllMarkets, publicScopeStates, allLoadedPlaces])

  // Handle Near Me toggle
  const handleNearMeToggle = useCallback(() => {
    if (nearMeActive) {
      setNearMeActive(false)
      setFlyToLocation(null)
      return
    }

    if (userLocation) {
      setNearMeActive(true)
      setFlyToLocation(userLocation)
      return
    }

    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }
        setUserLocation(loc)
        setNearMeActive(true)
        setFlyToLocation(loc)
        setLocationError(null)
      },
      () => {
        setLocationError('Location access denied')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [nearMeActive, userLocation])

  const effectiveStatusSet = useMemo(
    () => (
      showAnthonysVisits
        ? new Set(['visited', 'golden'])
        : new Set(filters.statuses && filters.statuses.length ? filters.statuses : DEFAULT_STATUSES)
    ),
    [filters.statuses, showAnthonysVisits]
  )

  const filteredPlaces = useMemo(() => {
    const searchLower = normalizeSearchText(searchQuery)
    const searchTerms = searchLower.split(/\s+/).filter(Boolean)
    const sourcePlaces = searchLower ? searchPlaces : allLoadedPlaces
    let results = sourcePlaces.reduce((matches, place) => {
      let nextPlace = place
      if (!isPlaceInPublicScope(place, showAllMarkets, publicScopeStates)) return matches
      // Historical records stay out of the default map, but any explicit
      // search should be able to find an old name or replacement record.
      if (place.lifecycleStatus && !showHistorical && !searchTerms.length) return matches
      // Search filter
      if (searchTerms.length > 0) {
        const searchRank = placeSearchRank(place, searchLower, searchTerms)
        if (searchRank >= 99) {
          return matches
        }
        nextPlace = { ...nextPlace, _searchRank: searchRank }
      }

      // Near me filter
      if (nearMeActive && userLocation) {
        const distance = getDistanceMiles(userLocation.lat, userLocation.lng, place.lat, place.lng)
        if (distance > nearMeRadius) return matches
        nextPlace = { ...nextPlace, _distance: distance }
      }

      if (showAnthonysPicks && !isEligibleForAnthonysPicks(place, { minimumRating: picksMinimumRating })) return matches

      // Style, price, status filters
      const placeStatus = place.status || 'visited'
      const isExplicitAnthonyVisit = isAnthonyReviewedPlace(place)
      const passesFilters = (
        (filters.styles.length === 0 || filters.styles.includes(place.style)) &&
        (filters.prices.length === 0 || filters.prices.includes(place.price_range || place.price)) &&
        (showAnthonysVisits ? isExplicitAnthonyVisit : effectiveStatusSet.has(placeStatus))
      )
      if (passesFilters) matches.push(nextPlace)
      return matches
    }, [])

    // Sort by distance when near me is active, otherwise by search relevance.
    if (nearMeActive && userLocation) {
      results = results.slice().sort((a, b) => (a._distance || 0) - (b._distance || 0))
    } else if (searchLower) {
      results = results.slice().sort((left, right) => compareSearchResults(left, right, {
        preferredStates: preferredSearchStates,
        prioritizeCurrent: !searchTerms.some(term => LIFECYCLE_SEARCH_TERMS.has(term)),
      }))
    }

    return results
  }, [allLoadedPlaces, searchPlaces, filters, searchQuery, nearMeActive, userLocation, nearMeRadius, effectiveStatusSet, showAnthonysVisits, showAnthonysPicks, showHistorical, preferredSearchStates, showAllMarkets, publicScopeStates, picksMinimumRating])

  const mapVisiblePlaces = useMemo(() => {
    const searchIsActive = Boolean(searchQuery.trim()) || nearMeActive
    const scopedPlaces = searchIsActive || !appliedMapBounds
      ? filteredPlaces
      : filteredPlaces.filter(place => appliedMapBounds.contains([place.lat, place.lng]))
    return sortProductionPlaces(scopedPlaces, sortMode)
  }, [appliedMapBounds, filteredPlaces, nearMeActive, searchQuery, sortMode])

  const shouldDimUnloadedAggregates = useMemo(() => {
    return (
      filters.styles?.length > 0 ||
      filters.prices?.length > 0 ||
      (filters.statuses?.length > 0 && filters.statuses.length < 3) ||
      showAnthonysPicks ||
      searchQuery.trim().length > 0 ||
      nearMeActive
    )
  }, [filters, searchQuery, nearMeActive, showAnthonysPicks])

  const filteredCountByState = useMemo(() => {
    return filteredPlaces.reduce((acc, place) => {
      const stateCode = showAnthonysVisits
        ? resolveRegionKey({ state: place.state, address: place.address }, true)
        : normalizeRegionCode(place.state)
      if (stateCode) {
        acc[stateCode] = (acc[stateCode] || 0) + 1
      }
      return acc
    }, {})
  }, [filteredPlaces, showAnthonysVisits])

  const filteredDisplayAggregates = useMemo(() => {
    const baseAggregates = Object.entries(regionStates)
      .map(([stateCode, region]) => {
        const centroid = STATE_CENTROIDS[stateCode]
        if (!centroid) return null

        const isLoaded = region.status === 'loaded'
        const reviewedCount = isLoaded
          ? (filteredCountByState[stateCode] || 0)
          : (anthonysCountsByState[stateCode] || 0)
        const picksCount = isLoaded
          ? (filteredCountByState[stateCode] || 0)
          : (anthonysPickCountsByState[stateCode] || 0)
        const count = showAnthonysPicks
          ? picksCount
          : showAnthonysVisits
            ? reviewedCount
            : (isLoaded ? (filteredCountByState[stateCode] || 0) : region.originalCount)
        return {
          id: `state-${stateCode}`,
          stateCode,
          stateName: centroid.name,
          country: centroid.country || 'US',
          regionStatus: region.status,
          count,
          lat: centroid.lat,
          lng: centroid.lng,
          isLoading: region.status === 'loading',
          isDimmed: !showAnthonysVisits && !showAnthonysPicks && !isLoaded && shouldDimUnloadedAggregates,
          isHighlighted: (showAnthonysVisits || showAnthonysPicks) && count > 0,
        }
      })
      .filter(Boolean)
    if (!showAnthonysVisits && !showAnthonysPicks) {
      return baseAggregates
    }

    const euBase = baseAggregates.find(agg => agg.stateCode === 'EU')
    const countSource = showAnthonysPicks ? anthonysPickCountsByState : anthonysCountsByState
    const euCountryAggregates = Object.entries(countSource)
      .filter(([code, count]) => code.startsWith('EU_') && count > 0 && STATE_CENTROIDS[code])
      .map(([code, count]) => {
        const centroid = STATE_CENTROIDS[code]
        return {
          id: `state-${code}`,
          stateCode: code,
          stateName: centroid.name,
          country: centroid.country || 'EU',
          regionStatus: euBase?.regionStatus || 'unloaded',
          count,
          lat: centroid.lat,
          lng: centroid.lng,
          isLoading: Boolean(euBase?.isLoading),
          isDimmed: false,
          isHighlighted: true,
        }
      })

    return [
      ...baseAggregates.filter(agg => agg.stateCode !== 'EU' && agg.count > 0),
      ...euCountryAggregates,
    ]
  }, [regionStates, filteredCountByState, anthonysCountsByState, anthonysPickCountsByState, showAnthonysVisits, showAnthonysPicks, shouldDimUnloadedAggregates])

  const themeStyles = useMemo(
    () => ({
      '--app-bg': theme.palette.bg,
      '--app-card': theme.palette.card,
      '--app-text': theme.palette.text,
      '--app-text-muted': theme.palette.mutedText,
      '--app-border': theme.palette.border,
      '--app-accent': theme.palette.accent,
      '--app-accent-muted': theme.palette.accentMuted,
      '--title-color-1': theme.titleRotation[0] || theme.palette.accent,
      '--title-color-2': theme.titleRotation[1] || theme.palette.text,
      '--title-color-3': theme.titleRotation[2] || theme.palette.accentMuted,
    }),
    [theme]
  )

  const nextThemeKey = entity.switchTo.themeKey
  const switchTarget = entity.switchTo.route
  const switchLabel = entity.switchTo.label

  const handleLocatePlace = useCallback(
    details => {
      if (!details) return
      setView('map')
      const lat = typeof details.lat === 'number' ? details.lat : null
      const lng = typeof details.lng === 'number' ? details.lng : null
      if (lat !== null && lng !== null) {
        // nothing additional; map layer will pan when popup opens
      }
      const targetType = details.entity || entity.entity
      const id = details.id || details.place_id || null
      if (id) {
        openMapPopup(targetType, id)
      }
    },
    [entity.entity, openMapPopup]
  )

  // Handle clicking a place in the results list
  const handlePlaceClick = useCallback(
    (place) => {
      if (!place) return
      setView('map')
      const targetType = entity.entity
      if (place.id) {
        openMapPopup(targetType, place.id)
      }
    },
    [entity.entity, openMapPopup]
  )

  const handleSiteSwitch = () => {
    trackSiteSwitch(themeKey, nextThemeKey)
  }

  const filterPanel = (
    <Sidebar
      onFilterChange={handleFilterChange}
      themeKey={themeKey}
      filters={filters}
      showClusterCounts={showClusterCounts}
      onClusterCountsToggle={setShowClusterCounts}
      showAnthonysVisits={showAnthonysVisits}
      onAnthonysVisitsToggle={setShowAnthonysVisits}
      showAnthonysPicks={showAnthonysPicks}
      onAnthonysPicksToggle={setShowAnthonysPicks}
      anthonysPicksLabel={picksLabel}
      anthonysPicksMinimumRating={picksMinimumRating}
      showHistorical={showHistorical}
      onHistoricalToggle={setShowHistorical}
    />
  )

  const mapControls = (
    <MapControls
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      nearMeActive={nearMeActive}
      nearMeRadius={nearMeRadius}
      locationError={locationError}
      searchLoading={searchLoading}
      searchError={searchError}
      searchNotice={searchNotice}
      searchResultLimitReached={Boolean(searchQuery.trim()) && searchPlaces.length >= SEARCH_RESULT_LIMIT}
      onSearchRetry={() => setSearchRetryToken(value => value + 1)}
      onNearMeToggle={handleNearMeToggle}
      onRadiusChange={setNearMeRadius}
      filteredPlaces={mapVisiblePlaces}
      onPlaceClick={handlePlaceClick}
      showAllMarkets={showAllMarkets}
      onAllMarketsToggle={setShowAllMarkets}
    />
  )

  const mapNode = (
    <div className="map-container-wrapper">
      <Suspense fallback={<div className="map-status" data-status="loading">{theme.copy.loading}</div>}>
        <MapView
          key={`${entity.entity}-map`}
          places={mapVisiblePlaces}
          theme={theme}
          site={entity.entity}
          showClusterCounts={showClusterCounts}
          stateAggregates={filteredDisplayAggregates}
          onStateClick={handleStateClick}
          flyToLocation={flyToLocation}
          onViewportChange={handleMapViewportChange}
          searchFocusKey={searchQuery.trim() ? `${normalizeSearchText(searchQuery)}:${mapVisiblePlaces.map(place => place.id).join(',')}` : ''}
          forceIndividualMarkers={shouldForceIndividualMarkers({
            searchActive: Boolean(searchQuery.trim()),
            nearMeActive,
            placeCount: mapVisiblePlaces.length,
          })}
          showAllMarkets={showAllMarkets}
          resetKey={`${themeKey}-${filters.styles.join(',')}-${filters.prices.join(',')}-${filters.statuses.join(',')}-${showAnthonysVisits ? 'anthony-visits' : 'all-statuses'}-${showAnthonysPicks ? 'anthonys-picks' : 'all-places'}-${showHistorical ? 'historical' : 'current'}`}
        />
      </Suspense>
    </div>
  )

  const frozenNode = entity.features?.frozenDirectory === false
    ? <div className="map-status" data-status="loading">{entity.frozenUnavailableMessage}</div>
    : <FrozenPizzaDirectory filters={filters} theme={theme} themeKey={themeKey} />

  return (
    <div className="app-shell" style={themeStyles}>
      <ProductionDiscoveryShell
        theme={theme}
        entity={entity.entity}
        view={view}
        setView={setView}
        mapLoading={mapLoading}
        mapError={mapError ? new Error(`${theme.copy.errorPrefix}: ${mapError.message}`) : null}
        mapNode={mapNode}
        mapControls={mapControls}
        places={mapVisiblePlaces}
        hasMapAggregates={filteredDisplayAggregates.some(aggregate => aggregate.count > 0)}
        searchActive={Boolean(searchQuery.trim()) || nearMeActive}
        selectedPlace={selectedPlace}
        onPlaceClick={handlePlaceClick}
        onPicksToggle={setShowAnthonysPicks}
        showPicks={showAnthonysPicks}
        picksLabel={picksLabel}
        isPickForPlace={place => isEligibleForAnthonysPicks(place, { minimumRating: picksMinimumRating })}
        sortMode={sortMode}
        onSortChange={setSortMode}
        filterPanel={filterPanel}
        filtersOpen={filtersOpen}
        onFiltersToggle={() => setFiltersOpen(open => !open)}
        statsPanel={<StatsPanel variant="compact" table={entity.table} states={showAllMarkets ? [] : publicScopeStates} />}
        suggestionPanel={<>
          <SuggestionForm
            key={themeKey}
            theme={theme}
            isPizza={entity.entity === 'pizza'}
            onLocatePlace={handleLocatePlace}
          />
        </>}
        switchTarget={switchTarget}
        switchLabel={switchLabel}
        onSwitch={handleSiteSwitch}
        suggestTarget={entity.entity === 'pizza' ? '/suggest' : '/tacos/suggest'}
        isPizza={entity.entity === 'pizza'}
        scopeNotice={mapMoved ? 'Map moved. Search this area to update the place list.' : null}
        onSearchArea={mapMoved && visibleMapBounds ? () => {
          setAppliedMapBounds(visibleMapBounds)
          setMapMoved(false)
        } : null}
        frozenNode={frozenNode}
      />
      <BugReportFab />
    </div>
  )
}

function ThemedRoute({ themeKey }) {
  return (
    <ThemeProvider themeKey={themeKey}>
      <MapPopupProvider>
        <SiteContainer themeKey={themeKey} />
      </MapPopupProvider>
    </ThemeProvider>
  )
}

function PlaceDetailRoute({ themeKey }) {
  return (
    <ThemeProvider themeKey={themeKey}>
      <PlaceDetailPage themeKey={themeKey} />
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <SelectedPlaceProvider>
      <GlobalLoadingProvider>
        <Router>
          <Routes>
            <Route path="/" element={<ThemedRoute themeKey={ThemeKeys.PIZZA} />} />
            <Route path="/tacos" element={<ThemedRoute themeKey={ThemeKeys.TACO} />} />
            <Route path="/places/:id" element={<PlaceDetailRoute themeKey={ThemeKeys.PIZZA} />} />
            <Route path="/tacos/places/:id" element={<PlaceDetailRoute themeKey={ThemeKeys.TACO} />} />
            <Route path="/data" element={<DataDashboard />} />
            <Route path="/concept" element={<DiscoveryConceptPage entity="pizza" />} />
            <Route path="/concept/tacos" element={<DiscoveryConceptPage entity="taco" />} />
            <Route path="/suggest" element={<PublicSuggestionPage entity="pizza" />} />
            <Route path="/tacos/suggest" element={<PublicSuggestionPage entity="taco" />} />
            <Route path="/admin/submit" element={<AdminSubmit />} />
            <Route path="/admin/reviews/*" element={<AdminReviewsPage />} />
            <Route
              path="/admin"
              element={
                <div className="admin-shell">
                  <AdminForm />
                </div>
              }
            />
          </Routes>
        </Router>
      </GlobalLoadingProvider>
    </SelectedPlaceProvider>
  )
}
