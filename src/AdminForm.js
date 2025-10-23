import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { pizzaStyles } from './data/pizzaStyles'
import { TACO_TYPES } from './data/tacoTypes'
import { uploadReviewPhoto, REVIEW_PHOTO_BUCKET } from './utils/uploadPhoto'
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
          Photos stay local for now. Upload support can be wired to Supabase when ready.
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
  const [authed, setAuthed] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const ADMIN_PASS = 'mypizza123'

  const [activeTab, setActiveTab] = useState('pizza')
  const [pizzaForm, setPizzaForm] = useState(initialPizzaState)
  const [tacoForm, setTacoForm] = useState(initialTacoState)
  const [frozenForm, setFrozenForm] = useState(initialFrozenState)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const { open: openGlobalLoading, close: closeGlobalLoading, setVariant: setGlobalLoadingVariant } = useGlobalLoading()

  const pizzaStylesSorted = useMemo(
    () => ['Traditional', ...pizzaStyles.filter(style => style !== 'Traditional').sort()],
    []
  )
  const tacoTypesSorted = useMemo(() => [...TACO_TYPES].sort(), [])

  const handlePasswordSubmit = event => {
    event.preventDefault()
    setMessage('')
    if (passwordInput.trim() === ADMIN_PASS) {
      setAuthed(true)
    } else {
      setMessage('Incorrect password. Try again.')
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

  const uploadPlacePhoto = async (file, { entity, recordId }) => {
    const { path } = await uploadReviewPhoto(file, {
      reviewId: recordId,
      prefix: `${entity}/${recordId}`,
    })

    const { data: publicData, error: publicError } = supabase.storage
      .from(REVIEW_PHOTO_BUCKET)
      .getPublicUrl(path)

    if (publicError) {
      throw new Error(publicError.message || 'Unable to create public URL')
    }

    return { path, publicUrl: publicData?.publicUrl || null }
  }

  const appendPhotoToRow = async ({ table, id, storedUrl, existingPhotos = [] }) => {
    if (!storedUrl) return
    const photosArray = Array.isArray(existingPhotos) ? existingPhotos.filter(Boolean) : []
    const nextPhotos = [...photosArray, storedUrl]

    const { error } = await supabase.from(table).update({ photos: nextPhotos }).eq('id', id)
    if (error) {
      // Fallback to single url column if array column is unavailable
      const fallback = await supabase.from(table).update({ photo_url: storedUrl }).eq('id', id)
      if (fallback.error) {
        throw error
      }
    }
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
    }

    if (!payload.name || !payload.address || Number.isNaN(payload.lat) || Number.isNaN(payload.lng) || !payload.style) {
      setMessage('Name, address, coordinates, and style are required for pizza places.')
      return
    }

    setLoading(true)
    setGlobalLoadingVariant('pizza')
    openGlobalLoading('Saving pizza place…')
    try {
      const { data: inserted, error } = await supabase
        .from('pizza_places')
        .insert([payload])
        .select('id, photos')
        .single()

      if (error) throw error

      if (pizzaForm.photo?.file && inserted?.id) {
        try {
          const { publicUrl, path } = await uploadPlacePhoto(pizzaForm.photo.file, {
            entity: 'pizza',
            recordId: inserted.id,
          })
          const storedUrl = publicUrl || path
          if (storedUrl) {
            await appendPhotoToRow({
              table: 'pizza_places',
              id: inserted.id,
              storedUrl,
              existingPhotos: inserted.photos,
            })
          }
        } catch (photoError) {
          console.error('[admin] pizza photo upload failed', photoError)
          setMessage('Pizza place saved, but photo upload failed. Try adding the photo from the review editor later.')
          cleanupPhotoPreview(pizzaForm)
          setPizzaForm(initialPizzaState)
          return
        }
      }

      setMessage('Pizza place added and photo uploaded!')
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
    }

    if (!payload.name || !payload.address || Number.isNaN(payload.lat) || Number.isNaN(payload.lng) || !payload.type) {
      setMessage('Name, address, coordinates, and taco type are required.')
      return
    }

    setLoading(true)
    setGlobalLoadingVariant('taco')
    openGlobalLoading('Saving taco spot…')
    try {
      const { data: inserted, error } = await supabase
        .from('taco_places')
        .insert([payload])
        .select('id, photos')
        .single()

      if (error) throw error

      if (tacoForm.photo?.file && inserted?.id) {
        try {
          const { publicUrl, path } = await uploadPlacePhoto(tacoForm.photo.file, {
            entity: 'taco',
            recordId: inserted.id,
          })
          const storedUrl = publicUrl || path
          if (storedUrl) {
            await appendPhotoToRow({
              table: 'taco_places',
              id: inserted.id,
              storedUrl,
              existingPhotos: inserted.photos,
            })
          }
        } catch (photoError) {
          console.error('[admin] taco photo upload failed', photoError)
          setMessage('Taco spot saved, but photo upload failed. Try adding the photo from the review editor later.')
          cleanupPhotoPreview(tacoForm)
          setTacoForm(initialTacoState)
          return
        }
      }

      setMessage('Taco spot added and photo uploaded!')
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
      const { data: inserted, error } = await supabase
        .from('frozen_pizzas')
        .insert([payload])
        .select('id, photos, photo_url')
        .single()

      if (error) throw error

      if (frozenForm.photo?.file && inserted?.id) {
        try {
          const { publicUrl, path } = await uploadPlacePhoto(frozenForm.photo.file, {
            entity: 'frozen',
            recordId: inserted.id,
          })
          const storedUrl = publicUrl || path
          if (storedUrl) {
            try {
              await appendPhotoToRow({
                table: 'frozen_pizzas',
                id: inserted.id,
                storedUrl,
                existingPhotos: inserted.photos,
              })
            } catch (attachError) {
              // If both photos array and photo_url fail, surface but do not fail the entire flow.
              console.warn('[admin] frozen photo attach fallback', attachError)
              const fallbackUpdate = await supabase
                .from('frozen_pizzas')
                .update({ photo_path: storedUrl })
                .eq('id', inserted.id)
              if (fallbackUpdate.error) {
                console.warn('[admin] frozen photo_path fallback failed', fallbackUpdate.error)
              }
            }
          }
        } catch (photoError) {
          console.error('[admin] frozen photo upload failed', photoError)
          setMessage('Frozen pizza logged, but photo upload failed. Add it later from the admin dashboard.')
          cleanupPhotoPreview(frozenForm)
          setFrozenForm(initialFrozenState)
          return
        }
      }

      setMessage('Frozen pizza logged and photo uploaded!')
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

            <PhotoPicker value={frozenForm.photo} onChange={photo => setFrozenForm(prev => ({ ...prev, photo }))} />
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
