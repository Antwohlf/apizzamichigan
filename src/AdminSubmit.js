import React, { useEffect, useMemo, useState } from 'react'
import { pizzaStyles } from './data/pizzaStyles'
import { TACO_TYPES } from './data/tacoTypes'
import { geocodeAddress } from './lib/geocode'
import ReviewPhotoUploader from './components/ReviewPhotoUploader'
import InlineSpinner from './components/ui/InlineSpinner'
import { useGlobalLoading } from './hooks/useGlobalLoading'

const initialForm = {
  entity: 'pizza',
  name: '',
  address: '',
  city: '',
  url: '',
  style: '',
  rating: '',
  notes: '',
  lat: '',
  lng: '',
}

export default function AdminSubmit() {
  const [authChecked, setAuthChecked] = useState(false)
  const [isAuthed, setIsAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [message, setMessage] = useState('')
  const [photoPreviews, setPhotoPreviews] = useState([])
  const { open: openGlobalLoading, close: closeGlobalLoading, setVariant: setGlobalLoadingVariant } = useGlobalLoading()

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/admin/check', { credentials: 'include' })
        if (!res.ok) throw new Error('unauthorized')
        const data = await res.json()
        if (data?.authorized) {
          setIsAuthed(true)
        }
      } catch (err) {
        setIsAuthed(false)
      } finally {
        setAuthChecked(true)
      }
    }
    checkAuth()
  }, [])

  const stylesForEntity = useMemo(
    () => (form.entity === 'pizza' ? pizzaStyles : TACO_TYPES),
    [form.entity]
  )

  const handleLogin = async e => {
    e.preventDefault()
    setLoginError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        throw new Error('Invalid password')
      }
      setIsAuthed(true)
      setPassword('')
    } catch (err) {
      setLoginError('Access denied. Double-check the password.')
    }
  }

  const handleInputChange = e => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleEntityChange = e => {
    const entity = e.target.value
    setForm(prev => ({ ...prev, entity, style: '' }))
  }

  const handleGeocode = async () => {
    setMessage('')
    const addressLine = form.city ? `${form.address}, ${form.city}` : form.address
    if (!addressLine) {
      setMessage('Enter an address before geocoding.')
      return
    }
    try {
      setGeocoding(true)
      const geo = await geocodeAddress(addressLine)
      setForm(prev => ({ ...prev, lat: geo.lat.toFixed(6), lng: geo.lng.toFixed(6) }))
      setMessage('Geocode complete — review coordinates before submitting.')
    } catch (err) {
      setMessage(err.message || 'Unable to geocode this address.')
    } finally {
      setGeocoding(false)
    }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setMessage('')
    if (!form.name || !form.address || !form.lat || !form.lng || !form.style) {
      setMessage('Name, address, coordinates, and style/type are required.')
      return
    }

    const payload = {
      entity: form.entity,
      name: form.name,
      address: form.address,
      city: form.city || null,
      url: form.url || null,
      style: form.style,
      rating: form.rating ? Number(form.rating) : null,
      notes: form.notes || null,
      lat: Number(form.lat),
      lng: Number(form.lng),
    }

    setSubmitting(true)
    setGlobalLoadingVariant(form.entity === 'taco' ? 'taco' : 'pizza')
    openGlobalLoading('Submitting listing…')
    try {
      const res = await fetch('/api/admin/submitPlace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error || 'Submission failed')
      }
      setMessage('Success! The place will appear on the map after the next refresh.')
      setForm(initialForm)
      setPhotoPreviews([])
    } catch (err) {
      setMessage(err.message || 'Submission failed')
    } finally {
      setSubmitting(false)
      closeGlobalLoading()
    }
  }

  if (!authChecked) {
    return (
      <div className="admin-shell">
        <p>Checking admin access…</p>
      </div>
    )
  }

  if (!isAuthed) {
    return (
      <div className="admin-shell">
        <form
          onSubmit={handleLogin}
          style={{
            display: 'grid',
            gap: '1rem',
            padding: '2rem',
            background: '#202224',
            borderRadius: 8,
            width: 320,
          }}
        >
          <h2 style={{ textAlign: 'center', margin: 0 }}>Admin Access</h2>
          <p style={{ color: '#c7c7c7', fontSize: '0.9rem', margin: 0 }}>
            Enter the admin portal password to continue.
          </p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            style={{ padding: '0.75rem', borderRadius: 4, border: '1px solid #2b2f31', background: '#181a1b', color: '#fff' }}
          />
          {loginError && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{loginError}</div>}
          <button
            type="submit"
            style={{ padding: '0.75rem', borderRadius: 4, border: 'none', background: '#f97316', color: '#fff', fontWeight: 600 }}
          >
            Unlock
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="admin-shell" style={{ backgroundColor: '#181a1b' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          gap: '1rem',
          background: '#202224',
          padding: '2rem',
          borderRadius: 10,
          width: 'min(640px, 95vw)',
        }}
      >
        <h2 style={{ margin: 0, color: '#f97316' }}>Submit a New Listing</h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fff' }}>
            <input type="radio" value="pizza" checked={form.entity === 'pizza'} onChange={handleEntityChange} />
            Pizza
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fff' }}>
            <input type="radio" value="taco" checked={form.entity === 'taco'} onChange={handleEntityChange} />
            Taco
          </label>
        </div>

        <input name="name" value={form.name} onChange={handleInputChange} placeholder="Name *" required style={inputStyle} />
        <input name="address" value={form.address} onChange={handleInputChange} placeholder="Street Address *" required style={inputStyle} />
        <input name="city" value={form.city} onChange={handleInputChange} placeholder="City" style={inputStyle} />
        <input name="url" value={form.url} onChange={handleInputChange} placeholder="Website URL" style={inputStyle} />

        <select name="style" value={form.style} onChange={handleInputChange} required style={inputStyle}>
          <option value="">{form.entity === 'pizza' ? 'Select Pizza Style *' : 'Select Taco Type *'}</option>
          {stylesForEntity.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <input
          name="rating"
          value={form.rating}
          onChange={handleInputChange}
          placeholder="Rating (optional)"
          type="number"
          min="0"
          max="10"
          step="0.1"
          style={inputStyle}
        />
        <textarea
          name="notes"
          value={form.notes}
          onChange={handleInputChange}
          placeholder="Notes"
          rows={3}
          style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ color: '#fff', fontWeight: 600 }}>Optional Place Photos</label>
          <ReviewPhotoUploader onUploaded={setPhotoPreviews} />
          {photoPreviews.length > 0 && (
            <p style={{ fontSize: '0.85rem', color: '#fbbf24', margin: 0 }}>
              Photos are stored locally for preview. Upload support can be wired to Supabase when ready.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <input
            name="lat"
            value={form.lat}
            onChange={handleInputChange}
            placeholder="Latitude *"
            required
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            name="lng"
            value={form.lng}
            onChange={handleInputChange}
            placeholder="Longitude *"
            required
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>

        <button
          type="button"
          onClick={handleGeocode}
          disabled={geocoding}
          style={{
            padding: '0.75rem',
            borderRadius: 4,
            border: '1px solid #2b2f31',
            background: '#181a1b',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {geocoding ? (
            <InlineSpinner size={18} variant={form.entity === 'taco' ? 'taco' : 'pizza'} label="Geocoding address" />
          ) : (
            'Geocode Address'
          )}
        </button>

        {message && (
          <div style={{ color: '#fbbf24', fontSize: '0.95rem' }}>{message}</div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '0.9rem',
            borderRadius: 4,
            border: 'none',
            background: '#f97316',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {submitting ? (
            <InlineSpinner size={20} variant={form.entity === 'taco' ? 'taco' : 'pizza'} label="Submitting listing" />
          ) : (
            'Submit Listing'
          )}
        </button>
      </form>
    </div>
  )
}

const inputStyle = {
  padding: '0.75rem',
  borderRadius: 4,
  border: '1px solid #2b2f31',
  background: '#181a1b',
  color: '#fff',
}
