// src/SuggestionForm.js
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

// simple strip-tags sanitizer
const stripTags = str => str.replace(/<\/?[^>]+(>|$)/g, '').trim()

const GOOGLE_PLACES_SCRIPT_ID = 'google-maps-places-api'
const MIN_AUTOCOMPLETE_CHARS = 3
const AUTOCOMPLETE_DEBOUNCE_MS = 200

export default function SuggestionForm({ theme, isPizza }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [order, setOrder] = useState('')
  const [status, setStatus] = useState('idle') // 'idle' | 'submitting' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const serviceRef = useRef(null)
  const debounceRef = useRef()
  const hideTimeoutRef = useRef()
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  const googleKey = process.env.REACT_APP_GOOGLE_GEOCODE_KEY

  useEffect(() => {
    setStatus('idle')
    setErrorMsg('')
    setName('')
    setLocation('')
    setOrder('')
    setSuggestions([])
    setShowSuggestions(false)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
  }, [isPizza])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (!googleKey) return

    const initializeService = () => {
      if (window.google?.maps?.places && !serviceRef.current) {
        serviceRef.current = new window.google.maps.places.AutocompleteService()
      }
    }

    const handleLoad = () => {
      const script = document.getElementById(GOOGLE_PLACES_SCRIPT_ID)
      if (script) script.dataset.loaded = 'true'
      initializeService()
    }

    if (window.google?.maps?.places) {
      initializeService()
      return
    }

    let script = document.getElementById(GOOGLE_PLACES_SCRIPT_ID)
    if (!script) {
      script = document.createElement('script')
      script.id = GOOGLE_PLACES_SCRIPT_ID
      script.src = `https://maps.googleapis.com/maps/api/js?key=${googleKey}&libraries=places`
      script.async = true
      script.defer = true
      script.dataset.loaded = 'loading'
      script.addEventListener('load', handleLoad)
      document.head.appendChild(script)
    } else if (script.dataset.loaded === 'true') {
      initializeService()
    } else {
      script.addEventListener('load', handleLoad)
    }

    return () => {
      script?.removeEventListener('load', handleLoad)
    }
  }, [googleKey])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (!showSuggestions || typeof document === 'undefined') return

    const handleClickAway = event => {
      if (!containerRef.current?.contains(event.target)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('pointerdown', handleClickAway)
    return () => document.removeEventListener('pointerdown', handleClickAway)
  }, [showSuggestions])

  const handleSubmit = async e => {
    e.preventDefault()
    if (!name || !location || !order) {
      setErrorMsg('All fields are required.')
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

    const table = isPizza ? 'pizza_suggestions' : 'taco_suggestions'

    const { error } = await supabase.from(table).insert([clean])

    if (error) {
      console.error('Insert error', error)
      setErrorMsg(error.message)
      setStatus('error')
    } else {
      setStatus('success')
      setName('')
      setLocation('')
      setOrder('')
      setSuggestions([])
      setShowSuggestions(false)
    }
  }

  const requestPredictions = value => {
    const service = serviceRef.current
    const google = typeof window !== 'undefined' ? window.google : undefined
    if (!service || !google?.maps?.places) return

    const trimmed = value.trim()
    if (!trimmed || trimmed.length < MIN_AUTOCOMPLETE_CHARS) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    service.getPlacePredictions(
      {
        input: trimmed,
        types: ['geocode'],
        componentRestrictions: { country: 'us' },
      },
      (predictions, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(predictions)) {
          setSuggestions([])
          setShowSuggestions(false)
          return
        }
        const items = predictions.map(prediction => ({
          id: prediction.place_id,
          description: prediction.description,
        }))
        setSuggestions(items)
        setShowSuggestions(items.length > 0)
      }
    )
  }

  const cancelHide = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = undefined
    }
  }

  const scheduleHide = () => {
    cancelHide()
    hideTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 120)
  }

  const handleLocationChange = event => {
    const value = event.target.value
    setLocation(value)
    cancelHide()

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!serviceRef.current) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    debounceRef.current = setTimeout(() => requestPredictions(value), AUTOCOMPLETE_DEBOUNCE_MS)
  }

  const handleSuggestionSelect = description => {
    cancelHide()
    setLocation(description)
    setSuggestions([])
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

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

  const submitLabel = 'Submit Suggestion'
  const questionLabel = isPizza ? 'What should I order?' : 'What should I try?'

  return (
    <div className="sidebar-container suggestion-form" ref={containerRef}>
      <h3 className="filter-section__title suggestion-form__title">Recommendations</h3>

      {status === 'success' ? (
        <p className="suggestion-form__success">Thanks! Your suggestion has been received. {isPizza ? '🍕' : '🌮'}</p>
      ) : (
        <form onSubmit={handleSubmit} className="suggestion-form__form">
          {status === 'error' && (
            <p className="suggestion-form__error" style={{ color: theme?.palette?.accent || 'salmon' }}>{errorMsg}</p>
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
                placeholder="City, neighborhood, or full address"
                autoComplete="street-address"
                required
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="suggestion-form__suggestions" role="listbox">
                  {suggestions.map(suggestion => (
                    <li key={suggestion.id}>
                      <button
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => handleSuggestionSelect(suggestion.description)}
                      >
                        {suggestion.description}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>

          <label className="suggestion-form__label" htmlFor="suggestion-order">
            <span>{questionLabel}</span>
            <textarea
              id="suggestion-order"
              name="order"
              value={order}
              onChange={event => setOrder(event.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={status === 'submitting'} className="suggestion-form__submit">
            {status === 'submitting' ? 'Submitting…' : submitLabel}
          </button>
        </form>
      )}
    </div>
  )
}
