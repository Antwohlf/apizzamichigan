// src/App.js
import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'

import Sidebar from './Sidebar'
import SuggestionForm from './SuggestionForm'
import AdminForm from './AdminForm'
import FrozenPizzaDirectory from './FrozenPizzaDirectory'
import LatinMarkets from './LatinMarkets'
import AdminSubmit from './AdminSubmit'
import { SiteTitle } from './header/SiteTitle'
import { StatsPanel } from './sidebar/StatsPanel'

import { ThemeProvider, useTheme } from './themes/ThemeProvider'
import { DEFAULT_THEME_KEY, ThemeKeys } from './themes/siteTheme'
import { supabase } from './supabaseClient'
import pizzaPlacesFallback from './data'
import { trackSiteSwitch } from './analytics'
import { tacoPlacesFallback } from './data/tacoPlaces'
import { fetchTacoPlaces } from './lib/supabase-tacos'
import './App.css'

const MapView = lazy(() => import('./map'))

const PLACE_TABLE_BY_THEME = {
  [ThemeKeys.PIZZA]: 'pizza_places',
  [ThemeKeys.TACO]: 'taco_places',
}

const DEFAULT_STATUSES = ['visited', 'unvisited', 'golden']

const normalizeStatus = (status) => {
  if (typeof status === 'string') {
    const lower = status.toLowerCase()
    if (DEFAULT_STATUSES.includes(lower)) {
      return lower
    }
  }
  return 'visited'
}

function SiteContainer({ themeKey }) {
  const [filters, setFilters] = useState({ styles: [], prices: [], statuses: [] })
  const [view, setView] = useState('map')
  const [places, setPlaces] = useState([])
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState(null)

  const { theme } = useTheme()
  const isPizza = themeKey === ThemeKeys.PIZZA

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
    let isMounted = true
    async function fetchPlaces() {
      setMapLoading(true)
      const fallbackPlaces = themeKey === ThemeKeys.TACO ? tacoPlacesFallback : pizzaPlacesFallback

      let data = null
      let error = null

      try {
        if (themeKey === ThemeKeys.TACO) {
          const response = await fetchTacoPlaces()
          data = response?.data ?? null
          error = response?.error ?? null
        } else {
          const table = PLACE_TABLE_BY_THEME[themeKey] || PLACE_TABLE_BY_THEME[DEFAULT_THEME_KEY]
          const response = await supabase
            .from(table)
            .select('*')
            .order('name', { ascending: true })
          data = response?.data ?? null
          error = response?.error ?? null
        }
      } catch (err) {
        error = err
      }

      if (!isMounted) return

      if (error) {
        const normalizedFallback = (fallbackPlaces || []).map(place => ({
          ...place,
          status: normalizeStatus(place?.status),
          photos: Array.isArray(place?.photos) ? place.photos : [],
        }))
        setPlaces(normalizedFallback)
        setMapError(error)
      } else {
        const normalized = (data || []).map(place => ({
          ...place,
          style:
            themeKey === ThemeKeys.TACO
              ? place.type || place.style
              : place.style === 'Standard'
                ? 'Traditional'
                : place.style,
          price: place.price || place.Price || '',
          status: normalizeStatus(place.status),
          photos: Array.isArray(place.photos) ? place.photos : [],
        }))

        setPlaces(normalized)
        setMapError(null)
      }

      setMapLoading(false)
    }

    fetchPlaces()
    return () => {
      isMounted = false
    }
  }, [themeKey])

  const filteredPlaces = useMemo(() => {
    const statusSet = new Set(filters.statuses && filters.statuses.length ? filters.statuses : DEFAULT_STATUSES)
    return places.filter(place => {
      const placeStatus = place.status || 'visited'
      return (
        (filters.styles.length === 0 || filters.styles.includes(place.style)) &&
        (filters.prices.length === 0 || filters.prices.includes(place.price)) &&
        statusSet.has(placeStatus)
      )
    })
  }, [places, filters])

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

  const handleSiteSwitch = () => {
    trackSiteSwitch(themeKey, nextThemeKey)
  }

  return (
    <div className="app-shell" style={themeStyles}>
      <div className="app-layout">
        <div className="sidebar-wrapper">
          <Sidebar onFilterChange={handleFilterChange} themeKey={themeKey} filters={filters} />
        </div>

        <div className="main-content">
          <SiteTitle title={theme.brandName} />

          <div className="view-toggle">
            {['map', 'frozen'].map(mode => {
              const isActive = view === mode
              const label = mode === 'map' ? theme.copy.frozenToggleMap : theme.copy.frozenToggleFrozen
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
                <Suspense fallback={<div className="map-status" data-status="loading">{theme.copy.loading}</div>}>
                  <MapView places={filteredPlaces} theme={theme} site={isPizza ? 'pizza' : 'taco'} />
                </Suspense>
              )
            ) : (
              themeKey === ThemeKeys.TACO ? (
                <LatinMarkets />
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
        </div>

        <div className="sidebar-wrapper">
          <div className="sidebar-inner sidebar-inner--sticky">
            <StatsPanel places={filteredPlaces} />
            <SuggestionForm key={themeKey} theme={theme} isPizza={isPizza} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemedRoute({ themeKey }) {
  return (
    <ThemeProvider themeKey={themeKey}>
      <SiteContainer themeKey={themeKey} />
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<ThemedRoute themeKey={ThemeKeys.PIZZA} />} />
        <Route path="/tacos" element={<ThemedRoute themeKey={ThemeKeys.TACO} />} />
        <Route path="/admin/submit" element={<AdminSubmit />} />
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
  )
}
