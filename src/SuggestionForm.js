// src/SuggestionForm.js
import React, { useState } from 'react'
import { supabase } from './supabaseClient'

// simple strip-tags sanitizer
const stripTags = str => str.replace(/<\/?[^>]+(>|$)/g, '').trim()

export default function SuggestionForm({ theme, isPizza }) {
  const [name,     setName]     = useState('')
  const [location, setLocation] = useState('')
  const [order,    setOrder]    = useState('')
  const [status,   setStatus]   = useState('idle') // 'idle' | 'submitting' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    // client-side validation
    if (!name || !location || !order) {
      setErrorMsg('All fields are required.')
      setStatus('error')
      return
    }

    setStatus('submitting')
    setErrorMsg('')

    // sanitize
    const clean = {
      name:     stripTags(name),
      location: stripTags(location),
      order:    stripTags(order),
    }

    // insert into Supabase
    const { error } = await supabase
      .from('suggestions')
      .insert([ clean ])

    if (error) {
      console.error('Insert error', error)
      setErrorMsg(error.message)
      setStatus('error')
    } else {
      setStatus('success')
      // reset form
      setName(''); setLocation(''); setOrder('')
    }
  }

  const submitLabel = 'Submit Suggestion'
  const questionLabel = isPizza ? 'What should I order?' : 'What should I try?'

  return (
    <div className="sidebar-container suggestion-form">
      <h2>Recommendations?</h2>

      {status === 'success' ? (
        <p>Thanks! Your suggestion has been received. {isPizza ? '🍕' : '🌮'}</p>
      ) : (
        <form onSubmit={handleSubmit}>
          {status === 'error' && (
            <p style={{ color: theme?.palette?.accent || 'salmon' }}>{errorMsg}</p>
          )}

          <label>
            Your Name:
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </label>
          <br/>

          <label>
            Location:
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              required
            />
          </label>
          <br/>

          <label>
            {questionLabel}
            <textarea
              value={order}
              onChange={e => setOrder(e.target.value)}
              required
            />
          </label>
          <br/>

          <button type="submit" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Submitting…' : submitLabel}
          </button>
        </form>
      )}
    </div>
  )
}
