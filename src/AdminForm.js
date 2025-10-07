// src/AdminForm.js
import React, { useState } from 'react'
import { supabase } from './supabaseClient'

// strip out any HTML tags
const stripTags = str => str.replace(/<[^>]*>/g, '').trim()

export default function AdminForm() {
  const [authed, setAuthed] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const ADMIN_PASS = 'mypizza123'

  // toggle mode between map and frozen pizza
  const [mode, setMode] = useState('map')

  // common fields
  const [name, setName]     = useState('')
  const [style, setStyle]   = useState('')
  const [price, setPrice]   = useState('$')
  const [review, setReview] = useState('')
  const [rating, setRating] = useState('')

  // map-specific fields
  const [address, setAddress]   = useState('')
  const [lat, setLat]           = useState('')
  const [lng, setLng]           = useState('')
  const [geoError, setGeoError] = useState('')
  const [status, setStatus]     = useState('unvisited')

  // handler to check admin password
  const handlePasswordSubmit = () => {
    if (passwordInput === ADMIN_PASS) setAuthed(true)
    else alert('Incorrect password')
  }

  // geocode address via Google Geocode API
  const handleGeocode = async () => {
    if (!address) return
    try {
      const encoded = encodeURIComponent(address)
      const key = process.env.REACT_APP_GOOGLE_GEOCODE_KEY
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${key}`
      )
      const js = await res.json()
      if (js.status === 'OK') {
        setLat(js.results[0].geometry.location.lat)
        setLng(js.results[0].geometry.location.lng)
        setGeoError('')
      } else {
        setGeoError('Geocode failed: ' + js.status)
      }
    } catch {
      setGeoError('Error fetching geo')
    }
  }

  // save handler for inserting into Supabase
  const handleSave = async () => {
    // validate required common fields
    if (!name || !style || !price || !rating) {
      alert('Please fill in all required fields.')
      return
    }
    if (mode === 'map' && (!address || !lat || !lng)) {
      alert('Please generate valid coordinates for the address.')
      return
    }

    // sanitize input
    const allowedStatuses = ['visited', 'unvisited', 'golden']
    const clean = {
      name: stripTags(name),
      style: stripTags(style),
      price,
      review: stripTags(review),
      rating: parseInt(rating, 10),
      status: allowedStatuses.includes(status) ? status : 'unvisited'
    }

    let table, payload
    if (mode === 'map') {
      table = 'pizza_places'
      payload = {
        ...clean,
        address: stripTags(address),
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      }
    } else {
      table = 'frozen_pizzas'
      payload = {
        Brand: clean.name,
        Type: clean.style,
        Price: clean.price,
        Rating: clean.rating,
        Notes: clean.review
      }
    }

    const { error } = await supabase.from(table).insert([payload])
    if (error) {
      console.error(error)
      alert('Save failed: ' + error.message)
    } else {
      alert((mode === 'map' ? 'Place' : 'Frozen pizza') + ' added!')
      // reset all fields
      setName('')
      setStyle('')
      setPrice('$')
      setReview('')
      setRating('')
      setAddress('')
      setLat('')
      setLng('')
      setStatus('unvisited')
    }
  }

  // not authenticated view
  if (!authed) {
    return (
      <div className="admin-form-container">
        <h2>Admin Login</h2>
        <input
          type="password"
          placeholder="Password"
          value={passwordInput}
          onChange={e => setPasswordInput(e.target.value)}
        />
        <button onClick={handlePasswordSubmit}>Login</button>
      </div>
    )
  }

  // authenticated form view
  return (
    <div className="admin-form">
      <h2>Add New {mode === 'map' ? 'Pizza Place' : 'Frozen Pizza'}</h2>

      {/* mode toggle buttons */}
      <div
        style={{
          display: 'inline-flex',
          margin: '1rem 0',
          background: '#222',
          borderRadius: 4,
          overflow: 'hidden'
        }}
      >
        {['map', 'frozen'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              cursor: 'pointer',
              background: mode === m ? '#FFA500' : 'transparent',
              color: mode === m ? '#FFF' : '#888',
              fontWeight: mode === m ? 700 : 400
            }}
          >
            {m === 'map' ? 'Map Pizza' : 'Frozen Pizza'}
          </button>
        ))}
      </div>

      {/* common inputs */}
      <label htmlFor="admin-name">
        Name:
        <input
          id="admin-name"
          name="name"
          autoComplete="organization"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </label>
      <label htmlFor="admin-style">
        Style:
        <input
          id="admin-style"
          name="style"
          value={style}
          onChange={e => setStyle(e.target.value)}
        />
      </label>
      <label htmlFor="admin-price">
        Price:
        <select
          id="admin-price"
          name="price"
          value={price}
          onChange={e => setPrice(e.target.value)}
        >
          <option value="$">$</option>
          <option value="$$">$$</option>
          <option value="$$$">$$$</option>
          <option value="$$$$">$$$$</option>
        </select>
      </label>

      {/* map-specific address & coords */}
      {mode === 'map' && (
        <>
          <label htmlFor="admin-status">
            Status:
            <select
              id="admin-status"
              name="status"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              <option value="visited">Visited</option>
              <option value="unvisited">Unvisited</option>
              <option value="golden">Favorites</option>
            </select>
          </label>
          <label htmlFor="admin-address">
            Address:
            <input
              id="admin-address"
              name="address"
              autoComplete="street-address"
              value={address}
              onChange={e => setAddress(e.target.value)}
            />
          </label>
          <button type="button" onClick={handleGeocode}>
            Generate Coordinates
          </button>
          {geoError && <small style={{ color: 'salmon' }}>{geoError}</small>}

          <label htmlFor="admin-lat">
            Lat:
            <input id="admin-lat" name="lat" value={lat} readOnly />
          </label>
          <label htmlFor="admin-lng">
            Lng:
            <input id="admin-lng" name="lng" value={lng} readOnly />
          </label>
        </>
      )}

      {/* review/notes & rating */}
      <label htmlFor="admin-notes">
        Review / Notes:
        <textarea
          id="admin-notes"
          name="review"
          value={review}
          onChange={e => setReview(e.target.value)}
        />
      </label>
      <label htmlFor="admin-rating">
        Rating:
        <input
          id="admin-rating"
          name="rating"
          type="number"
          min="1" max="10"
          value={rating}
          onChange={e => setRating(e.target.value)}
        />
      </label>

      <button onClick={handleSave}>Save</button>
    </div>
  )
}
