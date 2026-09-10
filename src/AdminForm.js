import React, { useEffect, useMemo, useRef, useState } from 'react'
import { entityConfig } from './config/entityConfig'
import { prepareReviewPhotoUpload } from './utils/uploadPhoto'
import InlineSpinner from './components/ui/InlineSpinner'
import { useGlobalLoading } from './hooks/useGlobalLoading'

const PRICE_OPTIONS = ['$', '$$', '$$$', '$$$$']
const STATUS_OPTIONS = [
  { value: 'visited', label: 'Visited' },
  { value: 'unvisited', label: 'Unvisited' },
  { value: 'golden', label: 'Golden Slice' },
]

const stripTags = str => str.replace(/<\/?[^>]+(>|$)/g, '').trim()

const initialPizzaState = {
  name: '',
  address: '',
  lat: '',
  lng: '',
  price: '$',
  style: '',
  rating: '',
  status: 'visited',
  review: '',
  notes: '',
  state: '',
  googlePlaceId: '',
  photo: null,
}

const initialTacoState = {
  name: '',
  address: '',
  lat: '',
  lng: '',
  price: '$',
  type: '',
  rating: '',
  status: 'visited',
  review: '',
  notes: '',
  state: '',
  googlePlaceId: '',
  photo: null,
}

const initialFrozenState = {
  brand: '',
  product: '',
  price: '$',
  rating: '',
  notes: '',
  photo: null,
}

const stateFromFormattedAddress = address => {
  const match = String(address || '').match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:,|$)/)
  return match?.[1] || ''
}

function PhotoPicker({ value, onChange }) {
  const previewUrl = value?.preview ?? null

  const handleChange = event => {
    const file = event.target.files?.[0]
    if (!file) {
      if (value?.preview) URL.revokeObjectURL(value.preview)
      onChange(null)
      return
    }
    if (value?.preview) URL.revokeObjectURL(value.preview)
    const preview = URL.createObjectURL(file)
    onChange({ file, preview })
  }

  const clearPhoto = () => {
    if (value?.preview) URL.revokeObjectURL(value.preview)
    onChange(null)
  }

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl]
  )

  return (
    <div className="admin-photo-picker">
      <label className="admin-photo-picker__label">
        <span>Add a cover photo</span>
        <input type="file" accept="image/*" onChange={handleChange} />
      </label>
      {previewUrl ? (
        <div className="admin-photo-picker__preview">
          <img src={previewUrl} alt="Selected preview" loading="lazy" />
          <button type="button" onClick={clearPhoto}>
            Remove
          </button>
        </div>
      ) : (
        <p className="admin-photo-picker__hint">
          The image is processed locally, then saved through the authenticated admin service.
        </p>
      )}
    </div>
  )
}

function StatusSelector({ value, onChange, disabledGolden }) {
  return (
    <div className="admin-status">
      <p className="admin-section-title">Visited status</p>
      <div className="admin-status__options">
        {STATUS_OPTIONS.map(option => {
          const isGolden = option.value === 'golden'
          const disabled = isGolden && disabledGolden
          return (
            <label key={option.value} className={value === option.value ? 'admin-status__option active' : 'admin-status__option'}>
              <input
                type="radio"
                name="status"
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {disabledGolden && (
        <p className="admin-status__hint">Golden Slice is auto-selected when ratings reach 9 or higher.</p>
      )}
    </div>
  )
}

const createSessionToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function PlacesSuggestionInput({
  label,
  value,
  onChange,
  onSelect,
  placeholder = 'Search for a place',
}) {
  const [query, setQuery] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const sessionTokenRef = useRef(createSessionToken())
  const debounceRef = useRef()
  const containerRef = useRef(null)

  useEffect(() => {
    setQuery(value || '')
  }, [value])

  useEffect(() => {
    const handleClickAway = event => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClickAway)
    return () => document.removeEventListener('pointerdown', handleClickAway)
  }, [])

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

  const fetchPredictions = async input => {
    const trimmed = input.trim()
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        input: trimmed,
        sessiontoken: sessionTokenRef.current,
      })
      const res = await fetch(`/api/places/autocomplete?${params.toString()}`)
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error || 'Autocomplete request failed')
      }
      const payload = await res.json()
      const deduped = new Map()
      if (Array.isArray(payload?.predictions)) {
        payload.predictions.forEach(prediction => {
          if (!prediction?.place_id) return
          if (!deduped.has(prediction.place_id)) {
            deduped.set(prediction.place_id, prediction)
          }
        })
      }
      const items = Array.from(deduped.values())
      setSuggestions(items)
      setOpen(items.length > 0)
    } catch (err) {
      console.warn('[admin] autocomplete error', err)
      setError(err.message || 'Unable to fetch place suggestions.')
      setSuggestions([])
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = event => {
    const nextValue = event.target.value
    setQuery(nextValue)
    if (onChange) onChange(nextValue)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchPredictions(nextValue), 250)
  }

  const handleSelect = async suggestion => {
    if (!suggestion) return
    const description = suggestion.description
    setQuery(description)
    if (onChange) onChange(description)
    setOpen(false)
    setSuggestions([])

    let detailsPayload = null
    try {
      const params = new URLSearchParams({
        place_id: suggestion.place_id,
        sessiontoken: sessionTokenRef.current,
      })
      const res = await fetch(`/api/places/details?${params.toString()}`)
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error || 'Failed to fetch place details.')
      }
      const payload = await res.json()
      detailsPayload = {
        ...payload,
        lat: typeof payload.lat === 'number' ? payload.lat : null,
        lng: typeof payload.lng === 'number' ? payload.lng : null,
      }
    } catch (err) {
      console.warn('[admin] place details error', err)
      setError('Place selected, but coordinates may be missing — verify lat/lng manually.')
    } finally {
      sessionTokenRef.current = createSessionToken()
    }

    if (onSelect) {
      onSelect({ suggestion, details: detailsPayload })
    }
  }

  return (
    <div className="admin-autocomplete" ref={containerRef}>
      <label>
        <span>{label}</span>
        <div className={open ? 'admin-autocomplete__field open' : 'admin-autocomplete__field'}>
          <input
            value={query}
            onChange={handleChange}
            placeholder={placeholder}
            autoComplete="off"
            onFocus={() => {
              if (suggestions.length) setOpen(true)
            }}
          />
          {loading && <span className="admin-autocomplete__spinner" aria-hidden />}
        </div>
      </label>
      {open && suggestions.length > 0 && (
        <ul className="admin-autocomplete__suggestions">
          {suggestions.map(item => (
            <li key={item.place_id}>
              <button type="button" onClick={() => handleSelect(item)}>
                {item.description}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="admin-autocomplete__footer">
        <span className="admin-autocomplete__powered">Powered by Google</span>
        {error && <p className="admin-autocomplete__error">{error}</p>}
      </div>
    </div>
  )
}

export default function AdminForm() {
  const [authChecked, setAuthChecked] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')

  const [activeTab, setActiveTab] = useState('pizza')
  const [pizzaForm, setPizzaForm] = useState(initialPizzaState)
  const [tacoForm, setTacoForm] = useState(initialTacoState)
  const [frozenForm, setFrozenForm] = useState(initialFrozenState)
  const pizzaConfig = entityConfig('pizza')
  const tacoConfig = entityConfig('taco')

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const { open: openGlobalLoading, close: closeGlobalLoading, setVariant: setGlobalLoadingVariant } = useGlobalLoading()

  const pizzaStylesSorted = useMemo(
    () => ['Unknown', ...pizzaConfig.styleOptions.filter(style => style !== 'Unknown').sort()],
    [pizzaConfig.styleOptions]
  )
  const tacoTypesSorted = useMemo(() => [...tacoConfig.styleOptions].sort(), [tacoConfig.styleOptions])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/check', { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (!cancelled) setAuthed(Boolean(payload?.authorized))
      })
      .catch(() => {
        if (!cancelled) setAuthed(false)
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handlePasswordSubmit = async event => {
    event.preventDefault()
    setMessage('')
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: passwordInput }),
      })
      if (!response.ok) throw new Error('Incorrect password. Try again.')
      setPasswordInput('')
      setAuthed(true)
    } catch (error) {
      setMessage(error.message || 'Unable to sign in. Try again.')
    }
  }

  const handleTabChange = tab => {
    setActiveTab(tab)
    setMessage('')
    setGlobalLoadingVariant(tab === 'taco' ? 'taco' : 'pizza')
  }

  useEffect(() => {
    setGlobalLoadingVariant(activeTab === 'taco' ? 'taco' : 'pizza')
  }, [activeTab, setGlobalLoadingVariant])

  const withRatingEffects = (prev, value) => {
    const numeric = Number.parseFloat(value)
    if (!Number.isNaN(numeric) && numeric >= 9) {
      return 'golden'
    }
    if ((Number.isNaN(numeric) || numeric < 9) && prev === 'golden') {
      return 'visited'
    }
    return prev
  }

  const handlePizzaField = event => {
    const { name, value } = event.target
    setPizzaForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'rating') {
        next.status = withRatingEffects(prev.status, value)
      }
      return next
    })
  }

  const handleTacoField = event => {
    const { name, value } = event.target
    setTacoForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'rating') {
        next.status = withRatingEffects(prev.status, value)
      }
      return next
    })
  }

  const handleFrozenField = event => {
    const { name, value } = event.target
    setFrozenForm(prev => ({ ...prev, [name]: value }))
  }

  const handlePizzaCoordinates = coords => {
    setPizzaForm(prev => ({
      ...prev,
      lat: typeof coords?.lat === 'string' ? coords.lat : prev.lat,
      lng: typeof coords?.lng === 'string' ? coords.lng : prev.lng,
    }))
  }

  const handleTacoCoordinates = coords => {
    setTacoForm(prev => ({
      ...prev,
      lat: typeof coords?.lat === 'string' ? coords.lat : prev.lat,
      lng: typeof coords?.lng === 'string' ? coords.lng : prev.lng,
    }))
  }

  const normalizePrice = value => (PRICE_OPTIONS.includes(value) ? value : '$')

  const submitPlaceToServer = async ({ entity, payload, style, photo }) => {
    const preparedPhoto = photo?.file
      ? await prepareReviewPhotoUpload(photo.file, { prefix: entity })
      : null
    const response = await fetch('/api/admin/submitPlace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        entity,
        name: payload.name,
        address: payload.address,
        lat: payload.lat,
        lng: payload.lng,
        price: payload.price ?? payload.Price,
        status: payload.status,
        review: payload.review,
        rating: payload.rating ?? payload.Rating,
        notes: payload.notes ?? payload.Notes,
        state: payload.state,
        google_place_id: payload.googlePlaceId,
        style,
        brand: payload.Brand,
        product: payload.Type,
        photo: preparedPhoto,
      }),
    })
    const responsePayload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(responsePayload?.error || 'Failed to save place.')
    return responsePayload
  }

  const cleanupPhotoPreview = photoState => {
    if (photoState?.photo?.preview) {
      URL.revokeObjectURL(photoState.photo.preview)
    }
  }

  const submitPizza = async () => {
    const payload = {
      name: stripTags(pizzaForm.name),
      address: stripTags(pizzaForm.address),
      lat: Number.parseFloat(pizzaForm.lat),
      lng: Number.parseFloat(pizzaForm.lng),
      price: normalizePrice(pizzaForm.price),
      style: stripTags(pizzaForm.style),
      rating: pizzaForm.rating ? Number.parseFloat(pizzaForm.rating) : null,
      status: pizzaForm.status,
      review: stripTags(pizzaForm.review),
      notes: stripTags(pizzaForm.notes),
      state: pizzaForm.state,
      googlePlaceId: pizzaForm.googlePlaceId,
    }

    if (!payload.name || !payload.address || Number.isNaN(payload.lat) || Number.isNaN(payload.lng) || !payload.style) {
      setMessage('Name, address, coordinates, and style are required for pizza places.')
      return
    }

    setLoading(true)
    setGlobalLoadingVariant('pizza')
    openGlobalLoading('Saving pizza place…')
    try {
      const result = await submitPlaceToServer({ entity: 'pizza', payload, style: payload.style, photo: pizzaForm.photo })
      setMessage(result.photo?.error
        ? 'Pizza place saved, but photo upload failed. Try adding the photo from the review editor later.'
        : pizzaForm.photo?.file ? 'Pizza place added and photo uploaded!' : 'Pizza place added!')
      cleanupPhotoPreview(pizzaForm)
      setPizzaForm(initialPizzaState)
    } catch (err) {
      console.error('[admin] pizza submit error', err)
      setMessage(err.message || 'Save failed.')
    } finally {
      setLoading(false)
      closeGlobalLoading()
    }
  }

  const submitTaco = async () => {
    const payload = {
      name: stripTags(tacoForm.name),
      address: stripTags(tacoForm.address),
      lat: Number.parseFloat(tacoForm.lat),
      lng: Number.parseFloat(tacoForm.lng),
      price: normalizePrice(tacoForm.price),
      type: stripTags(tacoForm.type),
      rating: tacoForm.rating ? Number.parseFloat(tacoForm.rating) : null,
      status: tacoForm.status,
      review: stripTags(tacoForm.review),
      notes: stripTags(tacoForm.notes),
      state: tacoForm.state,
      googlePlaceId: tacoForm.googlePlaceId,
    }

    if (!payload.name || !payload.address || Number.isNaN(payload.lat) || Number.isNaN(payload.lng) || !payload.type) {
      setMessage('Name, address, coordinates, and taco type are required.')
      return
    }

    setLoading(true)
    setGlobalLoadingVariant('taco')
    openGlobalLoading('Saving taco spot…')
    try {
      const result = await submitPlaceToServer({ entity: 'taco', payload, style: payload.type, photo: tacoForm.photo })
      setMessage(result.photo?.error
        ? 'Taco spot saved, but photo upload failed. Try adding the photo from the review editor later.'
        : tacoForm.photo?.file ? 'Taco spot added and photo uploaded!' : 'Taco spot added!')
      cleanupPhotoPreview(tacoForm)
      setTacoForm(initialTacoState)
    } catch (err) {
      console.error('[admin] taco submit error', err)
      setMessage(err.message || 'Save failed.')
    } finally {
      setLoading(false)
      closeGlobalLoading()
    }
  }

  const submitFrozen = async () => {
    const payload = {
      Brand: stripTags(frozenForm.brand),
      Type: stripTags(frozenForm.product),
      Price: normalizePrice(frozenForm.price),
      Rating: frozenForm.rating ? Number.parseFloat(frozenForm.rating) : null,
      Notes: stripTags(frozenForm.notes),
    }

    if (!payload.Brand || !payload.Type) {
      setMessage('Brand and product name are required for frozen pizza.')
      return
    }

    setLoading(true)
    setGlobalLoadingVariant('pizza')
    openGlobalLoading('Logging frozen pizza…')
    try {
      const result = await submitPlaceToServer({ entity: 'frozen', payload, photo: frozenForm.photo })
      setMessage(result.photo?.error
        ? 'Frozen pizza logged, but photo upload failed. Add it later from the admin dashboard.'
        : frozenForm.photo?.file ? 'Frozen pizza logged and photo uploaded!' : 'Frozen pizza logged!')
      cleanupPhotoPreview(frozenForm)
      setFrozenForm(initialFrozenState)
    } catch (err) {
      console.error('[admin] frozen submit error', err)
      setMessage(err.message || 'Save failed.')
    } finally {
      setLoading(false)
      closeGlobalLoading()
    }
  }

  const handleSubmit = event => {
    event.preventDefault()
    setMessage('')
    if (activeTab === 'pizza') {
      submitPizza()
    } else if (activeTab === 'taco') {
      submitTaco()
    } else {
      submitFrozen()
    }
  }

  if (!authChecked) {
    return (
      <div className="admin-shell">
        <p>Checking admin access…</p>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="admin-shell">
        <form className="admin-login" onSubmit={handlePasswordSubmit}>
          <h2>Admin Access</h2>
          <p>Enter the site passphrase to unlock the control panel.</p>
          <input
            type="password"
            value={passwordInput}
            onChange={event => setPasswordInput(event.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
          <button type="submit">Unlock</button>
          {message && <p className="admin-login__error">{message}</p>}
        </form>
      </div>
    )
  }

  return (
    <div className="admin-panel">
      <header className="admin-panel__header">
        <h1>APizza Control Room</h1>
        <p>Log new discoveries, frozen gems, or taco triumphs — all from one cozy dashboard.</p>
      </header>

      <section className="admin-tabs">
        <button
          type="button"
          className={activeTab === 'pizza' ? 'admin-tabs__button active' : 'admin-tabs__button'}
          onClick={() => handleTabChange('pizza')}
        >
          🍕 Pizza Map
        </button>
        <button
          type="button"
          className={activeTab === 'frozen' ? 'admin-tabs__button active' : 'admin-tabs__button'}
          onClick={() => handleTabChange('frozen')}
        >
          🧊 Frozen Pizza
        </button>
        <button
          type="button"
          className={activeTab === 'taco' ? 'admin-tabs__button active' : 'admin-tabs__button'}
          onClick={() => handleTabChange('taco')}
        >
          🌮 Taco Map
        </button>
      </section>

      <form className="admin-form" onSubmit={handleSubmit}>
        {activeTab === 'pizza' && (
          <>
            <div className="admin-grid">
              <PlacesSuggestionInput
                label="Place name *"
                value={pizzaForm.name}
                onChange={name => setPizzaForm(prev => ({ ...prev, name }))}
                onSelect={({ suggestion, details }) => {
                  const nextName = details?.name || suggestion?.structured_formatting?.main_text || suggestion?.description || ''
                  const nextAddress =
                    details?.formatted_address ||
                    suggestion?.structured_formatting?.secondary_text ||
                    suggestion?.description ||
                    pizzaForm.address
                  setPizzaForm(prev => ({
                    ...prev,
                    name: nextName,
                    address: nextAddress,
                    state: stateFromFormattedAddress(nextAddress),
                    googlePlaceId: details?.place_id || suggestion?.place_id || '',
                  }))
                  if (details) {
                    const lat = typeof details.lat === 'number' ? details.lat.toString() : null
                    const lng = typeof details.lng === 'number' ? details.lng.toString() : null
                    handlePizzaCoordinates({ lat, lng })
                  }
                }}
                placeholder="Search by place name"
              />
              <label>
                <span>Style *</span>
                <select name="style" value={pizzaForm.style} onChange={handlePizzaField} required>
                  <option value="">Select a style</option>
                  {pizzaStylesSorted.map(style => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Price</span>
                <select name="price" value={pizzaForm.price} onChange={handlePizzaField}>
                  {PRICE_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rating (0-10)</span>
                <input
                  name="rating"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={pizzaForm.rating}
                  onChange={handlePizzaField}
                />
              </label>
            </div>

            <StatusSelector
              value={pizzaForm.status}
              onChange={next => setPizzaForm(prev => ({ ...prev, status: next }))}
              disabledGolden
            />

            <label>
              <span>Street address *</span>
              <input
                name="address"
                value={pizzaForm.address}
                onChange={handlePizzaField}
                placeholder="Street, city"
                required
              />
            </label>

            <div className="admin-grid">
              <label>
                <span>Latitude *</span>
                <input name="lat" value={pizzaForm.lat} onChange={handlePizzaField} placeholder="e.g. 42.279594" required />
              </label>
              <label>
                <span>Longitude *</span>
                <input name="lng" value={pizzaForm.lng} onChange={handlePizzaField} placeholder="-83.732124" required />
              </label>
            </div>

            <label>
              <span>Quick review</span>
              <textarea
                name="review"
                rows={3}
                value={pizzaForm.review}
                onChange={handlePizzaField}
                placeholder="What stood out? Crust, sauce, vibes?"
              />
            </label>

            <label>
              <span>Notes</span>
              <textarea
                name="notes"
                rows={3}
                value={pizzaForm.notes}
                onChange={handlePizzaField}
                placeholder="Any extra intel or menu hacks?"
              />
            </label>

            <PhotoPicker value={pizzaForm.photo} onChange={photo => setPizzaForm(prev => ({ ...prev, photo }))} />
          </>
        )}

        {activeTab === 'taco' && (
          <>
            <div className="admin-grid">
              <PlacesSuggestionInput
                label="Taqueria name *"
                value={tacoForm.name}
                onChange={name => setTacoForm(prev => ({ ...prev, name }))}
                onSelect={({ suggestion, details }) => {
                  const nextName = details?.name || suggestion?.structured_formatting?.main_text || suggestion?.description || ''
                  const nextAddress =
                    details?.formatted_address ||
                    suggestion?.structured_formatting?.secondary_text ||
                    suggestion?.description ||
                    tacoForm.address
                  setTacoForm(prev => ({
                    ...prev,
                    name: nextName,
                    address: nextAddress,
                    state: stateFromFormattedAddress(nextAddress),
                    googlePlaceId: details?.place_id || suggestion?.place_id || '',
                  }))
                  if (details) {
                    const lat = typeof details.lat === 'number' ? details.lat.toString() : null
                    const lng = typeof details.lng === 'number' ? details.lng.toString() : null
                    handleTacoCoordinates({ lat, lng })
                  }
                }}
                placeholder="Search by taqueria name"
              />
              <label>
                <span>Taco type *</span>
                <select name="type" value={tacoForm.type} onChange={handleTacoField} required>
                  <option value="">Select a type</option>
                  {tacoTypesSorted.map(type => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Price</span>
                <select name="price" value={tacoForm.price} onChange={handleTacoField}>
                  {PRICE_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rating (0-10)</span>
                <input
                  name="rating"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={tacoForm.rating}
                  onChange={handleTacoField}
                />
              </label>
            </div>

            <StatusSelector
              value={tacoForm.status}
              onChange={next => setTacoForm(prev => ({ ...prev, status: next }))}
              disabledGolden
            />

            <label>
              <span>Street address *</span>
              <input
                name="address"
                value={tacoForm.address}
                onChange={handleTacoField}
                placeholder="Street, city"
                required
              />
            </label>

            <div className="admin-grid">
              <label>
                <span>Latitude *</span>
                <input name="lat" value={tacoForm.lat} onChange={handleTacoField} placeholder="e.g. 42.3314" required />
              </label>
              <label>
                <span>Longitude *</span>
                <input name="lng" value={tacoForm.lng} onChange={handleTacoField} placeholder="-83.0458" required />
              </label>
            </div>

            <label>
              <span>Quick review</span>
              <textarea
                name="review"
                rows={3}
                value={tacoForm.review}
                onChange={handleTacoField}
                placeholder="Standout meats, salsas, or late-night vibes?"
              />
            </label>

            <label>
              <span>Notes</span>
              <textarea
                name="notes"
                rows={3}
                value={tacoForm.notes}
                onChange={handleTacoField}
                placeholder="Anything the map should know?"
              />
            </label>

            <PhotoPicker value={tacoForm.photo} onChange={photo => setTacoForm(prev => ({ ...prev, photo }))} />
          </>
        )}

        {activeTab === 'frozen' && (
          <>
            <div className="admin-grid">
              <label>
                <span>Brand *</span>
                <input name="brand" value={frozenForm.brand} onChange={handleFrozenField} required />
              </label>
              <label>
                <span>Product *</span>
                <input
                  name="product"
                  value={frozenForm.product}
                  onChange={handleFrozenField}
                  placeholder="e.g. Smokin' Sicilian Bessie's Revenge"
                  required
                />
              </label>
              <label>
                <span>Price</span>
                <select name="price" value={frozenForm.price} onChange={handleFrozenField}>
                  {PRICE_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rating (0-10)</span>
                <input
                  name="rating"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={frozenForm.rating}
                  onChange={handleFrozenField}
                />
              </label>
            </div>

            <label>
              <span>Tasting notes</span>
              <textarea
                name="notes"
                rows={4}
                value={frozenForm.notes}
                onChange={handleFrozenField}
                placeholder="Bake time tweaks, dip pairings, crust surprises…"
              />
            </label>

            <p className="admin-photo-picker__hint">
              Frozen pizza photos are not supported by the current database schema.
            </p>
          </>
        )}

        <button type="submit" className="admin-submit" disabled={loading}>
          {loading ? (
            <InlineSpinner size={20} variant={activeTab === 'taco' ? 'taco' : 'pizza'} label="Saving entry" />
          ) : (
            'Save entry'
          )}
        </button>
        {message && <p className="admin-message">{message}</p>}
      </form>
    </div>
  )
}
