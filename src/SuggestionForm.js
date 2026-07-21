// src/SuggestionForm.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import InlineSpinner from './components/ui/InlineSpinner'

const stripTags = str => str.replace(/<\/?[^>]+(>|$)/g, '').trim()

const MIN_AUTOCOMPLETE_CHARS = 3
const AUTOCOMPLETE_DEBOUNCE_MS = 250

const generateSessionToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function checkExistingPlace(placeId, isPizza) {
  if (!placeId) return null

  const tables = ['locations', isPizza ? 'pizza_places' : 'taco_places']

  for (const table of tables) {
    if (!table) continue
    try {
      const query = supabase
        .from(table)
        .select('id, name, lat, lng, entity, google_place_id')
        .eq('google_place_id', placeId)
        .maybeSingle()

      const { data, error } = await query
      if (error) {
        if (error?.code && ['PGRST116', 'PGRST301', 'PGRST205'].includes(error.code)) {
          continue
        }
        console.warn(`[suggestion] google_place check error on ${table}`, error)
        continue
      }
      if (data) {
        return {
          id: data.id,
          name: data.name,
          lat: typeof data.lat === 'number' ? data.lat : Number(data.lat),
          lng: typeof data.lng === 'number' ? data.lng : Number(data.lng),
          entity: data.entity || (isPizza ? 'pizza' : 'taco'),
        }
      }
    } catch (err) {
      console.warn(`[suggestion] google_place check failure on ${table}`, err)
    }
  }

  return null
}

export default function SuggestionForm({ theme, isPizza, onLocatePlace }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [order, setOrder] = useState('')
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')
  const [autoCompleteError, setAutoCompleteError] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [sessionToken, setSessionToken] = useState(() => generateSessionToken())
  const [isFetchingPredictions, setIsFetchingPredictions] = useState(false)
  const [isFetchingDetails, setIsFetchingDetails] = useState(false)
  const [placeDetails, setPlaceDetails] = useState(null)
  const [existingPlace, setExistingPlace] = useState(null)
  const [mapStatus, setMapStatus] = useState('')

  const debounceRef = useRef()
  const hideTimeoutRef = useRef()
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    setStatus('idle')
    setErrorMsg('')
    setAutoCompleteError('')
    setName('')
    setLocation('')
    setOrder('')
    setSuggestions([])
    setShowSuggestions(false)
    setPlaceDetails(null)
    setExistingPlace(null)
    setMapStatus('')
    setSessionToken(generateSessionToken())

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = undefined
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = undefined
    }
  }, [isPizza])

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    },
    []
  )

  useEffect(() => {
    if (!showSuggestions || typeof document === 'undefined') return undefined

    const handleClickAway = event => {
      if (!containerRef.current?.contains(event.target)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('pointerdown', handleClickAway)
    return () => document.removeEventListener('pointerdown', handleClickAway)
  }, [showSuggestions])

  const requestPredictions = useCallback(
    async value => {
      const trimmed = value.trim()
      if (!trimmed || trimmed.length < MIN_AUTOCOMPLETE_CHARS) {
        setSuggestions([])
        setShowSuggestions(false)
        return
      }

      setIsFetchingPredictions(true)
      setAutoCompleteError('')
      try {
        const params = new URLSearchParams({
          input: trimmed,
          sessiontoken: sessionToken,
        })
        const res = await fetch(`/api/places/autocomplete?${params.toString()}`)
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          throw new Error(payload?.error || 'Unable to fetch predictions')
        }
        const payload = await res.json()
        const deduped = new Map()
        if (Array.isArray(payload?.predictions)) {
          payload.predictions.forEach(prediction => {
            if (!prediction?.place_id) return
            if (!deduped.has(prediction.place_id)) {
              deduped.set(prediction.place_id, {
                id: prediction.place_id,
                description: prediction.description,
              })
            }
          })
        }
        const items = Array.from(deduped.values())
        setSuggestions(items)
        setShowSuggestions(items.length > 0)
      } catch (err) {
        console.warn('[suggestions] autocomplete error', err)
        setAutoCompleteError('Unable to reach Google Autocomplete right now.')
        setSuggestions([])
        setShowSuggestions(false)
      } finally {
        setIsFetchingPredictions(false)
      }
    },
    [sessionToken]
  )

  const fetchPlaceDetails = useCallback(
    async (placeId, description) => {
      if (!placeId) return
      setIsFetchingDetails(true)
      setAutoCompleteError('')
      setMapStatus('')
      try {
        const params = new URLSearchParams({
          place_id: placeId,
          sessiontoken: sessionToken,
        })
        const res = await fetch(`/api/places/details?${params.toString()}`)
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          throw new Error(payload?.error || 'Unable to fetch place details')
        }
        const payload = await res.json()
        const lat = typeof payload.lat === 'number' ? payload.lat : null
        const lng = typeof payload.lng === 'number' ? payload.lng : null
        const details = {
          place_id: payload.place_id,
          name: payload.name || description || '',
          formatted_address: payload.formatted_address || description || '',
          lat,
          lng,
        }
        setPlaceDetails(details)

        const existing = await checkExistingPlace(details.place_id, isPizza)
        if (existing) {
          setExistingPlace(existing)
          setMapStatus('found')
          if (
            typeof onLocatePlace === 'function' &&
            typeof existing.lat === 'number' &&
            typeof existing.lng === 'number'
          ) {
            onLocatePlace({
              id: existing.id || details.place_id,
              lat: existing.lat,
              lng: existing.lng,
              name: existing.name || details.name,
              entity: existing.entity || (isPizza ? 'pizza' : 'taco'),
            })
          }
        } else {
          setExistingPlace(null)
          setMapStatus('not-found')
        }
      } catch (err) {
        console.warn('[suggestions] place details error', err)
        setPlaceDetails(null)
        setExistingPlace(null)
        setMapStatus('')
        setAutoCompleteError('Unable to load details for that place. Try another search.')
      } finally {
        setIsFetchingDetails(false)
        setSessionToken(generateSessionToken())
      }
    },
    [isPizza, onLocatePlace, sessionToken]
  )

  const cancelHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = undefined
    }
  }, [])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 120)
  }, [cancelHide])

  const handleLocationChange = useCallback(
    event => {
      const value = event.target.value
      setLocation(value)
      setPlaceDetails(null)
      setExistingPlace(null)
      setMapStatus('')
      setAutoCompleteError('')

      cancelHide()

      if (debounceRef.current) clearTimeout(debounceRef.current)

      debounceRef.current = setTimeout(() => requestPredictions(value), AUTOCOMPLETE_DEBOUNCE_MS)
    },
    [cancelHide, requestPredictions]
  )

  const handleSuggestionSelect = useCallback(
    suggestion => {
      cancelHide()
      setLocation(suggestion.description)
      setSuggestions([])
      setShowSuggestions(false)
      inputRef.current?.focus()
      fetchPlaceDetails(suggestion.id, suggestion.description)
    },
    [cancelHide, fetchPlaceDetails]
  )

  const handleLocationFocus = () => {
    cancelHide()
    if (suggestions.length) {
      setShowSuggestions(true)
    }
  }

  const handleLocationKeyDown = event => {
    if (event.key === 'Escape') {
      setShowSuggestions(false)
      event.currentTarget.blur()
    }
  }

  const handleSubmit = async event => {
    event.preventDefault()
    if (!name || !location || !order) {
      setErrorMsg('All fields are required.')
      setStatus('error')
      return
    }
    if (!placeDetails || !placeDetails.place_id) {
      setErrorMsg('Please select a place from the suggestions dropdown first.')
      setStatus('error')
      return
    }

    setStatus('submitting')
    setErrorMsg('')

    const clean = {
      name: stripTags(name),
      location: stripTags(location),
      order: stripTags(order),
    }

    const payload = {
      entity: isPizza ? 'pizza' : 'taco',
      google_place_id: placeDetails.place_id,
      name: placeDetails.name,
      formatted_address: placeDetails.formatted_address,
      lat: typeof placeDetails.lat === 'number' ? placeDetails.lat : null,
      lng: typeof placeDetails.lng === 'number' ? placeDetails.lng : null,
      user_name: clean.name,
      recommendation: clean.order,
      location_text: clean.location,
      status: existingPlace ? 'existing' : 'pending',
      existing_place_id: existingPlace?.id ?? null,
    }

    try {
      const { error } = await supabase.from('suggested_places').insert([payload])
      if (error) {
        // Fallback to legacy tables if the unified table does not exist.
        if (error.code === 'PGRST205') {
          const legacyTable = isPizza ? 'pizza_suggestions' : 'taco_suggestions'
          const legacyRow = {
            name: clean.name,
            location: clean.location,
            order: clean.order,
          }
          const legacyInsert = await supabase.from(legacyTable).insert([legacyRow])
          if (legacyInsert.error) throw legacyInsert.error
        } else {
          throw error
        }
      }
      setStatus('success')
      setName('')
      setLocation('')
      setOrder('')
      setSuggestions([])
      setShowSuggestions(false)
      setPlaceDetails(null)
      setExistingPlace(null)
      setMapStatus('')
      setSessionToken(generateSessionToken())
    } catch (err) {
      console.error('[suggestions] insert error', err)
      setErrorMsg(err?.message || 'Unable to submit suggestion right now.')
      setStatus('error')
    }
  }

  const mapStatusMessage = useMemo(() => {
    if (mapStatus === 'found') {
      return 'Already on the map! We just centered the view there.'
    }
    if (mapStatus === 'not-found') {
      return 'Not on the map yet — share what to order and we’ll queue it for review.'
    }
    return ''
  }, [mapStatus])

  const submitLabel = status === 'submitting' ? 'Submitting…' : 'Suggest this place'

  return (
    <div className="sidebar-container suggestion-form" ref={containerRef}>
      <h2 className="filter-section__title suggestion-form__title">Recommendations</h2>

      {status === 'success' ? (
        <p className="suggestion-form__success">
          Thanks! Your suggestion has been received. {isPizza ? '🍕' : '🌮'}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="suggestion-form__form">
          {status === 'error' && errorMsg && (
            <p className="suggestion-form__error" style={{ color: theme?.palette?.accent || '#f87171' }}>
              {errorMsg}
            </p>
          )}

          <label className="suggestion-form__label" htmlFor="suggestion-name">
            <span>Your Name</span>
            <input
              id="suggestion-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={event => setName(event.target.value)}
              required
            />
          </label>

          <label className="suggestion-form__label" htmlFor="suggestion-location">
            <span>Location</span>
            <div className="suggestion-form__autocomplete">
              <input
                id="suggestion-location"
                name="location"
                ref={inputRef}
                value={location}
                onChange={handleLocationChange}
                onFocus={handleLocationFocus}
                onBlur={scheduleHide}
                onKeyDown={handleLocationKeyDown}
                placeholder="Search for a spot"
                autoComplete="street-address"
                required
              />
              {(isFetchingPredictions || isFetchingDetails) && (
                <span className="suggestion-form__spinner" aria-hidden />
              )}
              {showSuggestions && suggestions.length > 0 && (
                <div className="suggestion-form__suggestions-wrapper">
                  <ul className="suggestion-form__suggestions" role="listbox">
                    {suggestions.map(suggestion => (
                      <li key={suggestion.id}>
                        <button
                          type="button"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => handleSuggestionSelect(suggestion)}
                        >
                          {suggestion.description}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="suggestion-form__powered">Powered by Google</div>
                </div>
              )}
            </div>
          </label>

          {autoCompleteError && (
            <p className="suggestion-form__hint suggestion-form__hint--error">{autoCompleteError}</p>
          )}

          {mapStatusMessage && (
            <p
              className={
                mapStatus === 'found'
                  ? 'suggestion-form__hint suggestion-form__hint--success'
                  : 'suggestion-form__hint suggestion-form__hint--info'
              }
            >
              {mapStatusMessage}
            </p>
          )}

          <label className="suggestion-form__label" htmlFor="suggestion-order">
            <span>{isPizza ? 'What should I order?' : 'What should I try?'}</span>
            <textarea
              id="suggestion-order"
              name="order"
              value={order}
              onChange={event => setOrder(event.target.value)}
              required
            />
          </label>

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="suggestion-form__submit"
          >
            {status === 'submitting' ? (
              <InlineSpinner size={18} variant={isPizza ? 'pizza' : 'taco'} label="Submitting suggestion" />
            ) : (
              submitLabel
            )}
          </button>
        </form>
      )}
    </div>
  )
}
