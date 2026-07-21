// src/App.js
import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'

import Sidebar from './Sidebar'
import SuggestionForm from './SuggestionForm'
import AdminForm from './AdminForm'
import FrozenPizzaDirectory from './FrozenPizzaDirectory'
import AdminSubmit from './AdminSubmit'
import AdminReviewsPage from './admin/AdminReviewsPage'
import { SiteTitle } from './header/SiteTitle'
import { StatsPanel } from './sidebar/StatsPanel'
import { MapPopupProvider, useMapPopup } from './map/useMapPopup'
import DataDashboard from './pages/DataDashboard'
import PlaceDetailPage from './pages/PlaceDetailPage'

import { ThemeProvider, useTheme } from './themes/ThemeProvider'
import { DEFAULT_THEME_KEY, ThemeKeys } from './themes/siteTheme'
import { supabase } from './supabaseClient'
import { trackSiteSwitch } from './analytics'
import { STATE_CENTROIDS } from './data/stateCentroids'
import { getDistanceMiles } from './utils/geo'
import './App.css'
import { GlobalLoadingProvider, useGlobalLoading } from './hooks/useGlobalLoading'
import { SelectedPlaceProvider } from './store/selectedPlace'
import { BugReportFab } from './components/bug-report/BugReportFab'
import { MapControls } from './map/MapControls'

// Helper to fetch places for a specific state
async function fetchPlacesForState(table, stateCode) {
  const pageSize = 1000
  let allData = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('state', stateCode)
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allData = allData.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return allData
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

export const remoteSearchableColumns = table => [
  'name',
  'address',
  'state',
  'style',
  'status',
  table === 'pizza_places' ? 'price_range' : 'price',
  ...(table === 'pizza_places' ? ['brand', 'operator'] : []),
]

// Search results do not need enrichment internals, audit columns, or large
// JSON fields. Keep this list limited to fields used by ranking and popups.
export const publicSearchSelect = [
  'id',
  'name',
  'lat',
  'lng',
  'address',
  'google_place_id',
  'state',
  'status',
  'style',
  'price',
  'price_range',
  'rating',
  'brand',
  'operator',
  'lifecycle_status',
  'lifecycle_replaced_by_id',
].join(', ')

const isMissingSearchColumnError = error => {
  const message = String(error?.message || error?.details || '').toLowerCase()
  return message.includes('column') && (
    message.includes('does not exist') ||
    message.includes('not found') ||
    message.includes('schema cache')
  )
}

async function executeSearchQuery(queryFactory) {
  const compactResult = await queryFactory(publicSearchSelect)
  if (!compactResult.error || !isMissingSearchColumnError(compactResult.error)) return compactResult
  // Keep deployments with an older enrichment schema usable while the
  // additive migration is rolled out. This path is intentionally rare.
  return queryFactory('*')
}

async function fetchPlacesForSearch(table, searchTerms, originalQuery = '') {
  const terms = [...new Set((Array.isArray(searchTerms) ? searchTerms : [searchTerms])
    .map(term => String(term || '').trim())
    .filter(term => term.length >= 2))].slice(0, MAX_REMOTE_SEARCH_TERMS)
  if (!terms.length) return []

  const termBatches = []
  for (let index = 0; index < terms.length; index += 3) termBatches.push(terms.slice(index, index + 3))
  const responses = await Promise.all(termBatches.map(async batch => {
    const remoteSearchFilter = remoteSearchableColumns(table)
      .flatMap(column => batch.map(term => `${column}.ilike.${supabaseIlikePattern(term)}`))
      .join(',')
    const { data, error } = await executeSearchQuery(select => supabase
      .from(table)
      .select(select)
      .or(remoteSearchFilter)
      .order('rating', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true })
      .limit(Math.min(SEARCH_LOOKUP_LIMIT * batch.length, 1000)))

    if (error) throw error
    return data || []
  }))

  const lifecycleTerms = String(originalQuery || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(term => LIFECYCLE_SEARCH_TERMS.has(term))
  if (lifecycleTerms.length) {
    const lifecycleFilter = lifecycleTerms
      .map(term => `lifecycle_status.ilike.${supabaseIlikePattern(term)}`)
      .join(',')
    const { data, error } = await supabase
      .from(table)
      .select(`${publicSearchSelect}, lifecycle_status, lifecycle_replaced_by_id`)
      .or(lifecycleFilter)
      .order('name', { ascending: true })
      .limit(SEARCH_LOOKUP_LIMIT)
    // Older Supabase schemas do not have lifecycle columns yet. The normal
    // search response remains valid; this optional lookup becomes active
    // automatically once the additive lifecycle migration is applied.
    if (!error) responses.push(...(data || []))
  }

  const stateCodes = stateCodesForSearch(originalQuery)
  if (stateCodes.length) {
    const stateScopedTerms = stateScopedNameTerms(originalQuery).slice(0, MAX_STATE_SCOPED_SEARCH_TERMS)
    if (!stateScopedTerms.length) return [...new Map(responses.flat().map(row => [row.id ?? `${row.google_place_id || ''}:${row.name || ''}:${row.address || ''}`, row])).values()]
    const stateSearchColumns = [
      'name',
      'address',
      'style',
      ...(table === 'pizza_places' ? ['brand', 'operator'] : []),
    ]
    const stateResponses = await Promise.all(stateCodes.map(async stateCode => {
      const stateSearchFilter = stateSearchColumns
        .flatMap(column => stateScopedTerms.map(term => `${column}.ilike.${supabaseIlikePattern(term)}`))
        .join(',')
      const { data, error } = await executeSearchQuery(select => supabase
        .from(table)
        .select(select)
        .eq('state', stateCode)
        .or(stateSearchFilter)
        .order('rating', { ascending: false, nullsFirst: false })
        .limit(Math.min(SEARCH_LOOKUP_LIMIT * stateScopedTerms.length, 1000)))

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
async function fetchStateCounts(table, {
  includeStates,
  includeStatuses,
  caseInsensitiveStatuses = false,
  splitEuropeByCountry = false,
  requireRating = false,
  onProgress,
  progressEveryPages = 1,
} = {}) {
  const pageSize = 1000
  const counts = {}
  let offset = 0
  let page = 0

  while (true) {
    let query = supabase
      .from(table)
      .select(splitEuropeByCountry ? 'state,address' : 'state')
      .range(offset, offset + pageSize - 1)

    if (Array.isArray(includeStates) && includeStates.length > 0) {
      query = query.in('state', includeStates)
    }
    if (Array.isArray(includeStatuses) && includeStatuses.length > 0) {
      if (caseInsensitiveStatuses) {
        const statusOr = includeStatuses
          .map(status => `status.ilike.${String(status).trim().toLowerCase()}*`)
          .join(',')
        query = query.or(statusOr)
      } else {
        query = query.in('status', includeStatuses)
      }
    }
    if (requireRating) {
      query = query.not('rating', 'is', null)
    }

    const { data, error } = await query

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
  reviewed: ['reviewed', 'visited', 'tried', 'anthony'],
  favorite: ['favorite', 'favorites', 'golden', 'best'],
  suggestion: ['suggestion', 'suggestions', 'unvisited'],
  lifecycle: ['closed', 'historical', 'replaced'],
}

const normalizedPlaceStatus = place =>
  String(place?.statusRaw ?? place?.status ?? '').trim().toLowerCase()

const isStatusSearchTerm = term =>
  Object.values(statusQueryTerms).some(terms => terms.includes(term))

const termMatchesPlaceStatus = (term, place) => {
  const status = normalizedPlaceStatus(place)
  if (!status) return false
  if (statusQueryTerms.favorite.includes(term)) return status.startsWith('golden')
  if (statusQueryTerms.reviewed.includes(term)) return status.startsWith('visited') || status.startsWith('golden')
  if (statusQueryTerms.suggestion.includes(term)) return status.startsWith('unvisited')
  if (statusQueryTerms.lifecycle.includes(term)) {
    const lifecycle = String(place?.lifecycleStatus || place?.statusRaw || '').trim().toLowerCase()
    if (term === 'historical') return lifecycle.startsWith('closed') && place?.rating != null
    return lifecycle.startsWith('closed') || lifecycle.startsWith('replaced')
  }
  return false
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
  const cityState = normalizeSearchText([place?.city, place?.state].filter(Boolean).join(' '))
  const stateCode = normalizeSearchText(place?.state).toUpperCase()
  const locationText = normalizeSearchText([place?.address, place?.city, place?.state].filter(Boolean).join(' '))
  const identityText = normalizeSearchText([place?.name, place?.brand, place?.operator].filter(Boolean).join(' '))
  const compactIdentity = compactSearchText([place?.name, place?.brand, place?.operator].filter(Boolean).join(' '))
  const fullText = searchablePlaceText(place)
  const nameWords = searchWords(place?.name)
  const identityWords = searchWords([place?.name, place?.brand, place?.operator].filter(Boolean).join(' '))
  const meaningfulTerms = meaningfulSearchTerms(terms)
  const assumedLocationTerm = meaningfulTerms.length >= 2 ? meaningfulTerms[meaningfulTerms.length - 1] : ''
  const assumedNameTerms = assumedLocationTerm ? meaningfulTerms.slice(0, -1) : []
  const price = normalizedPlacePrice(place)
  const hasPriceMatch = queryMatchesPrice(query, price)
  const hasStatusMatch = queryMatchesPlaceStatus(meaningfulTerms, place)
  const hasPriceIntent = meaningfulTerms.some(isPriceSearchTerm) || (String(query || '').match(/\${1,4}/g) || []).length > 0
  const hasStatusIntent = meaningfulTerms.some(isStatusSearchTerm)
  const termExplainsMetadataResult = term =>
    termMatchesText(identityText, term) ||
    termMatchesText(locationText, term) ||
    termMatchesPrice(term, price) ||
    termMatchesPlaceStatus(term, place)

  if (name === query) return 0
  if (compactName === compactQuery) return 0.5
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
  if (address.includes(query)) return 6
  if (cityState.includes(query)) return 7
  if (terms.every(term => termMatchesText(address, term))) return 8
  if (terms.every(term => termMatchesText(cityState, term))) return 9
  if (terms.every(term => termMatchesText(fullText, term))) return 10
  return 99
}

export const isAnthonyReviewedPlace = place => {
  const statusRaw = String(place?.statusRaw ?? place?.status ?? '').trim().toLowerCase()
  return (
    (statusRaw.startsWith('visited') || statusRaw.startsWith('golden')) &&
    typeof place?.rating === 'number' &&
    !Number.isNaN(place.rating)
  )
}

export const searchResultPriority = place => {
  if (isAnthonyReviewedPlace(place)) return 0
  if (typeof place?.rating === 'number' && !Number.isNaN(place.rating)) return 1
  if (Array.isArray(place?.photos) && place.photos.length > 0) return 2
  if (place?.photo) return 2
  return 3
}

export const compareSearchResults = (a, b) => {
  const rankDelta = (a?._searchRank ?? 99) - (b?._searchRank ?? 99)
  if (rankDelta !== 0) return rankDelta

  const priorityDelta = searchResultPriority(a) - searchResultPriority(b)
  if (priorityDelta !== 0) return priorityDelta

  const ratingDelta = (Number(b?.rating) || 0) - (Number(a?.rating) || 0)
  if (ratingDelta !== 0) return ratingDelta

  return String(a?.name || '').localeCompare(String(b?.name || ''))
}

const PLACE_TABLE_BY_THEME = {
  [ThemeKeys.PIZZA]: 'pizza_places',
  [ThemeKeys.TACO]: 'taco_places',
}
const PRIORITY_INITIAL_STATES = ['MI', 'WI', 'IN', 'OH', 'IL']
const REGION_COUNTS_CACHE = new Map()
const ANTHONY_COUNTS_CACHE = new Map()

const REVIEW_PHOTO_BUCKET = 'review-photos'
const REVIEW_PHOTO_TABLE = 'review-photos'
let reviewPhotosTableAvailable = true

const DEFAULT_STATUSES = ['visited', 'unvisited', 'golden']
const FAVORITE_FLAG_FIELDS = ['favorited', 'is_favorited', 'isFavorite', 'is_favorite', 'favorite']
const VALID_PLACE_TYPES = new Set(['pizzeria', 'taqueria', 'tamaleria'])
const PLACE_TYPE_FIELDS = ['place_type', 'placeType', 'place_category', 'placeCategory']
const MARKER_ICON_FIELDS = ['marker_icon_url', 'markerIconUrl', 'icon_url', 'iconUrl']
const normalizeRegionCode = value => (typeof value === 'string' ? value.trim().toUpperCase() : '')
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

export const normalizeLifecycleStatus = status => {
  const lower = String(status || '').trim().toLowerCase()
  if (lower.startsWith('permanently closed') || lower.startsWith('closed')) return 'closed'
  if (lower.startsWith('replaced')) return 'replaced'
  if (lower.startsWith('demolished')) return 'demolished'
  return null
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
  const [filters, setFilters] = useState({ styles: [], prices: [], statuses: [] })
  const [view, setView] = useState('map')
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState(null)
  const [showClusterCounts, setShowClusterCounts] = useState(true)
  const [showAnthonysVisits, setShowAnthonysVisits] = useState(false)
  const [anthonysCountsByState, setAnthonysCountsByState] = useState({})

  // Search and Near Me state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPlaces, setSearchPlaces] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const searchRequestIdRef = React.useRef(0)
  const [userLocation, setUserLocation] = useState(null)
  const [nearMeActive, setNearMeActive] = useState(false)
  const [nearMeRadius, setNearMeRadius] = useState(25)
  const [locationError, setLocationError] = useState(null)
  const [flyToLocation, setFlyToLocation] = useState(null)

  // Three-state region model: UNLOADED -> LOADING -> LOADED
  // Shape: { [stateCode]: { status: 'unloaded'|'loading'|'loaded', places: [], originalCount } }
  const [regionStates, setRegionStates] = useState({})
  const loadingStatesRef = React.useRef(new Set())

  const { theme } = useTheme()
  const isPizza = themeKey === ThemeKeys.PIZZA
  const { open: openMapPopup } = useMapPopup()
  const { open: openLoading, close: closeLoading, setVariant: setLoadingVariant } = useGlobalLoading()

  const handleFilterChange = useCallback(next => setFilters(next), [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const statusParam = params.get('status')
    if (statusParam) {
      const next = statusParam
        .split(',')
        .map(v => v.trim())
        .filter(v => DEFAULT_STATUSES.includes(v))
      if (next.length) {
        setFilters(prev => ({ ...prev, statuses: next }))
      }
    }
  }, [])

  useEffect(() => {
    document.body.style.backgroundColor = theme.palette.bg
    document.body.style.color = theme.palette.text
  }, [theme])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const currentStatuses = filters.statuses || []
    if (currentStatuses.length && currentStatuses.length !== DEFAULT_STATUSES.length) {
      params.set('status', currentStatuses.join(','))
    } else {
      params.delete('status')
    }
    const next = params.toString()
    const newUrl = next ? `${window.location.pathname}?${next}` : window.location.pathname
    window.history.replaceState({}, '', newUrl)
  }, [filters.statuses])

  useEffect(() => {
    const pageTitle = isPizza
      ? 'APizzaMichigan - Best Michigan Pizza Map'
      : 'TacoBoutMichigan - Best Michigan Taco Map'
    const description = isPizza
      ? 'Discover Michigan\'s best pizza joints with live filters, maps, and crowd-sourced intel.'
      : 'Track down Michigan\'s top tacos with the same interactive map experience, now in festive colors.'

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
    setFavicon(isPizza ? '/favicon-pizza.svg' : '/favicon-taco.svg')
  }, [isPizza, themeKey, theme.brandName])

  useEffect(() => {
    setLoadingVariant(isPizza ? 'pizza' : 'taco')
  }, [isPizza, setLoadingVariant])

  // Normalize place data (extracted for reuse)
  const normalizePlaceData = useCallback((data, photoMap, defaultPlaceType) => {
    return (data || []).map((place, index) => {
      const canonicalId =
        place.id ??
        place.ID ??
        place.place_id ??
        place.slug ??
        `${themeKey === ThemeKeys.TACO ? 'taco' : 'pizza'}-${index}`
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
      const favorited = computeFavorited(place, normalizedStatus)
      const placeType = computePlaceType(place, defaultPlaceType)
      const markerIconUrl = computeMarkerIconUrl(place)
      const normalizedPrice = place.price || place.Price || ''
      const normalizedPriceRange = place.price_range || place.priceRange || normalizedPrice

      return {
        ...place,
        id: canonicalId,
        type: themeKey === ThemeKeys.TACO ? 'taco' : 'pizza',
        style:
          themeKey === ThemeKeys.TACO
            ? place.type || place.style
            : place.style === 'Standard' || place.style === 'Traditional'
              ? 'Standard Round'
              : place.style === 'Chicago'
                ? 'Chicago Deep Dish'
                : place.style,
        price: normalizedPrice,
        price_range: normalizedPriceRange,
        priceRange: normalizedPriceRange,
        status: normalizedStatus,
        statusRaw: typeof place.status === 'string' ? place.status.trim().toLowerCase() : null,
        lifecycleStatus,
        lifecycle_status: place.lifecycle_status || null,
        lifecycle_replaced_by_id: place.lifecycle_replaced_by_id || null,
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
  }, [themeKey])

  // Initial load: prioritize Michigan + nearby states, then progressively hydrate the rest
  useEffect(() => {
    let isMounted = true
    const buildRegionStatesFromCounts = (counts, existing = {}) => {
      const next = { ...existing }
      Object.entries(counts).forEach(([stateCode, count]) => {
        if (stateCode === 'Unknown' || !STATE_CENTROIDS[stateCode]) return
        const prevRegion = next[stateCode]
        next[stateCode] = prevRegion
          ? { ...prevRegion, originalCount: count }
          : { status: 'unloaded', originalCount: count, places: [] }
      })
      return next
    }

    async function initialLoad() {
      setMapLoading(true)
      openLoading(theme.copy.loading || 'Loading map…')
      const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]

      try {
        const cachedRegionCounts = REGION_COUNTS_CACHE.get(table)
        const cachedAnthonyCounts = ANTHONY_COUNTS_CACHE.get(table)

        if (cachedAnthonyCounts) {
          setAnthonysCountsByState(cachedAnthonyCounts)
        } else {
          setAnthonysCountsByState({})
        }

        if (cachedRegionCounts) {
          setRegionStates(buildRegionStatesFromCounts(cachedRegionCounts))
          setMapError(null)
          setMapLoading(false)
          closeLoading()
        } else {
          const [priorityCounts, priorityAnthonyCounts] = await Promise.all([
            fetchStateCounts(table, { includeStates: PRIORITY_INITIAL_STATES }),
            cachedAnthonyCounts
              ? Promise.resolve(cachedAnthonyCounts)
              : fetchStateCounts(table, {
                includeStates: PRIORITY_INITIAL_STATES,
                includeStatuses: ['visited', 'golden'],
                splitEuropeByCountry: true,
                requireRating: true,
              }),
          ])
          if (!isMounted) return

          setRegionStates(buildRegionStatesFromCounts(priorityCounts))
          if (!cachedAnthonyCounts) {
            setAnthonysCountsByState(priorityAnthonyCounts)
          }
          setMapError(null)
          setMapLoading(false)
          closeLoading()
        }

        // Non-blocking background hydration for the rest of the map
        fetchStateCounts(table, {
          onProgress: (allCounts) => {
            if (!isMounted) return
            REGION_COUNTS_CACHE.set(table, allCounts)
            setRegionStates(prev => buildRegionStatesFromCounts(allCounts, prev))
          },
          progressEveryPages: 3,
        }).catch(error => {
          if (!isMounted) return
          console.warn('[App] Background region hydration failed:', error)
        })

        fetchStateCounts(table, {
          includeStatuses: ['visited', 'golden'],
          splitEuropeByCountry: true,
          requireRating: true,
          onProgress: (counts) => {
            if (!isMounted) return
            ANTHONY_COUNTS_CACHE.set(table, counts)
            setAnthonysCountsByState(counts)
          },
          progressEveryPages: 1,
        }).catch(error => {
          if (!isMounted) return
          console.warn('[App] Background Anthony counts hydration failed:', error)
        })
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
  }, [themeKey, theme.copy.loading, openLoading, closeLoading])

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

    const defaultPlaceType = isPizza ? 'pizzeria' : 'taqueria'
    const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]

    try {
      const stateData = await fetchPlacesForState(table, loadKey)

      // Fetch photos
      let photoMap = {}
      if (stateData.length) {
        const placeIds = stateData.map(p => p.id).filter(Boolean)
        if (placeIds.length) {
          photoMap = await fetchPhotoMap(placeIds)
        }
      }

      const normalized = normalizePlaceData(stateData, photoMap, defaultPlaceType)

      // Mark as loaded (aggregate hides, markers show)
      setRegionStates(prev => ({
        ...prev,
        [loadKey]: { ...prev[loadKey], status: 'loaded', places: normalized }
      }))
    } catch (err) {
      // Revert to unloaded on error (aggregate stays visible)
      setRegionStates(prev => ({
        ...prev,
        [loadKey]: { ...prev[loadKey], status: 'unloaded' }
      }))
      console.error(`[App] Failed to load region ${loadKey}:`, err)
    } finally {
      loadingStatesRef.current.delete(loadKey)
    }
  }, [regionStates, isPizza, themeKey, normalizePlaceData])

  useEffect(() => {
    let isMounted = true
    const requestId = searchRequestIdRef.current + 1
    searchRequestIdRef.current = requestId
    const isCurrentRequest = () => isMounted && searchRequestIdRef.current === requestId
    const lookupTerms = remoteSearchTerms(searchQuery)

    if (!lookupTerms.length) {
      setSearchPlaces([])
      setSearchError(null)
      setSearchLoading(false)
      return () => {
        isMounted = false
      }
    }

    async function loadSearchPlaces() {
      setSearchLoading(true)
      setSearchError(null)
      setSearchPlaces([])
      const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]
      const defaultPlaceType = isPizza ? 'pizzeria' : 'taqueria'

      try {
        const cacheKey = `${table}|${normalizeSearchText(searchQuery)}|${lookupTerms.join('|')}`
        const cachedRows = readSearchCache(cacheKey)
        const rows = cachedRows || await fetchPlacesForSearch(table, lookupTerms, searchQuery)
        if (!cachedRows) writeSearchCache(cacheKey, rows)
        if (!isCurrentRequest()) return

        // Rank and cap before loading photo metadata. Broad searches such as
        // "pizza" can otherwise turn one keystroke into hundreds of photo
        // requests before the map has anything useful to render.
        const rankedRows = rows
          .map(row => ({
            ...row,
            _searchRank: placeSearchRank(row, normalizeSearchText(searchQuery), searchWords(searchQuery)),
          }))
          .filter(row => row._searchRank < 99)
          .sort((left, right) => {
            const rankDelta = left._searchRank - right._searchRank
            if (rankDelta !== 0) return rankDelta
            return String(left.name || '').localeCompare(String(right.name || ''))
          })
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
        setSearchPlaces([])
        setSearchError(err)
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
  }, [searchQuery, themeKey, isPizza, normalizePlaceData])

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

  // Derive all loaded places from regionStates
  const allLoadedPlaces = useMemo(() => {
    return Object.values(regionStates)
      .filter(r => r.status === 'loaded')
      .flatMap(r => r.places)
  }, [regionStates])

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
    const lifecycleSearch = searchTerms.some(term => statusQueryTerms.lifecycle.includes(term))

    let results = sourcePlaces.reduce((matches, place) => {
      let nextPlace = place
      const isHistorical = place.lifecycleStatus === 'closed' && place.rating != null
      if (place.lifecycleStatus && !isHistorical && !lifecycleSearch) return matches
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
      results = results.slice().sort(compareSearchResults)
    }

    return results
  }, [allLoadedPlaces, searchPlaces, filters, searchQuery, nearMeActive, userLocation, nearMeRadius, effectiveStatusSet, showAnthonysVisits])

  const shouldDimUnloadedAggregates = useMemo(() => {
    return (
      filters.styles?.length > 0 ||
      filters.prices?.length > 0 ||
      (filters.statuses?.length > 0 && filters.statuses.length < 3) ||
      searchQuery.trim().length > 0 ||
      nearMeActive
    )
  }, [filters, searchQuery, nearMeActive])

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
        const anthonyCount = isLoaded
          ? (filteredCountByState[stateCode] || 0)
          : (anthonysCountsByState[stateCode] || 0)
        const count = showAnthonysVisits
          ? anthonyCount
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
          isDimmed: !showAnthonysVisits && !isLoaded && shouldDimUnloadedAggregates,
          isHighlighted: showAnthonysVisits && count > 0,
        }
      })
      .filter(Boolean)
    if (!showAnthonysVisits) {
      return baseAggregates
    }

    const euBase = baseAggregates.find(agg => agg.stateCode === 'EU')
    const euCountryAggregates = Object.entries(anthonysCountsByState)
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
  }, [regionStates, filteredCountByState, anthonysCountsByState, showAnthonysVisits, shouldDimUnloadedAggregates])

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

  const nextThemeKey = isPizza ? ThemeKeys.TACO : ThemeKeys.PIZZA
  const switchTarget = isPizza ? '/tacos' : '/'
  const switchLabel = isPizza
    ? 'Check out TacoBoutMichigan'
    : 'Check out APizzaMichigan'

  const handleLocatePlace = useCallback(
    details => {
      if (!details) return
      setView('map')
      const lat = typeof details.lat === 'number' ? details.lat : null
      const lng = typeof details.lng === 'number' ? details.lng : null
      if (lat !== null && lng !== null) {
        // nothing additional; map layer will pan when popup opens
      }
      const targetType = details.entity === 'taco' ? 'taco' : 'pizza'
      const id = details.id || details.place_id || null
      if (id) {
        openMapPopup(targetType, id)
      }
    },
    [openMapPopup]
  )

  // Handle clicking a place in the results list
  const handlePlaceClick = useCallback(
    (place) => {
      if (!place) return
      setView('map')
      const targetType = isPizza ? 'pizza' : 'taco'
      if (place.id) {
        openMapPopup(targetType, place.id)
      }
    },
    [isPizza, openMapPopup]
  )

  const handleSiteSwitch = () => {
    trackSiteSwitch(themeKey, nextThemeKey)
  }

  return (
    <div className="app-shell" style={themeStyles}>
      <div className="app-layout">
        <aside className="sidebar-wrapper sidebar-wrapper--filters" aria-label="Map filters">
          <Sidebar
            onFilterChange={handleFilterChange}
            themeKey={themeKey}
            filters={filters}
            showClusterCounts={showClusterCounts}
            onClusterCountsToggle={setShowClusterCounts}
            showAnthonysVisits={showAnthonysVisits}
            onAnthonysVisitsToggle={setShowAnthonysVisits}
          />
        </aside>

        <main className="main-content">
          <SiteTitle title={theme.brandName} />

          <div className="view-toggle">
            {['map', 'frozen'].map(mode => {
              const isActive = view === mode
              const isTacoComingSoonTab = !isPizza && mode === 'frozen'
              const label = mode === 'map'
                ? theme.copy.frozenToggleMap
                : (isTacoComingSoonTab ? 'Coming Soon' : theme.copy.frozenToggleFrozen)
              return (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className={isActive ? 'toggle-button active' : 'toggle-button'}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div
            className="map-or-directory"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '600px' }}
          >
            {view === 'map' ? (
              mapLoading ? (
                <div className="map-status" data-status="loading">
                  {theme.copy.loading}
                </div>
              ) : mapError ? (
                <div className="map-status" data-status="error">
                  {theme.copy.errorPrefix}: {mapError.message}
                </div>
              ) : (
                <div className="map-container-wrapper">
                  <MapControls
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    nearMeActive={nearMeActive}
                    nearMeRadius={nearMeRadius}
                    locationError={locationError}
                    searchLoading={searchLoading}
                    searchError={searchError}
                    onNearMeToggle={handleNearMeToggle}
                    onRadiusChange={setNearMeRadius}
                    filteredPlaces={filteredPlaces}
                    onPlaceClick={handlePlaceClick}
                  />
                  <Suspense fallback={<div className="map-status" data-status="loading">{theme.copy.loading}</div>}>
                    <MapView
                      key={isPizza ? 'pizza-map' : 'taco-map'}
                      places={filteredPlaces}
                      theme={theme}
                      site={isPizza ? 'pizza' : 'taco'}
                      showClusterCounts={showClusterCounts}
                      stateAggregates={filteredDisplayAggregates}
                      onStateClick={handleStateClick}
                      flyToLocation={flyToLocation}
                      forceIndividualMarkers={Boolean(searchQuery.trim()) || nearMeActive}
                      resetKey={`${themeKey}-${filters.styles.join(',')}-${filters.prices.join(',')}-${filters.statuses.join(',')}-${showAnthonysVisits ? 'anthony-visits' : 'all-statuses'}`}
                    />
                  </Suspense>
                </div>
              )
            ) : (
              themeKey === ThemeKeys.TACO ? (
                <div className="map-status" data-status="loading">
                  Taco recipes are coming soon.
                </div>
              ) : (
                <FrozenPizzaDirectory filters={filters} theme={theme} themeKey={themeKey} />
              )
            )}
          </div>

          <footer className="site-footer">
            <Link to={switchTarget} className="cta-switch" onClick={handleSiteSwitch}>
              {switchLabel}
            </Link>
          </footer>
        </main>

        <aside className="sidebar-wrapper sidebar-wrapper--recommendations" aria-label="Recommendations and statistics">
          <div className="sidebar-inner sidebar-inner--sticky">
            <StatsPanel table={isPizza ? 'pizza_places' : 'taco_places'} />
            <SuggestionForm
              key={themeKey}
              theme={theme}
              isPizza={isPizza}
              onLocatePlace={handleLocatePlace}
            />
            <BugReportFab />
          </div>
        </aside>
      </div>
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
