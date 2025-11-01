import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildGoogleMapsUrl } from '../../lib/buildGoogleMapsUrl'

function buildMetadata(selectedPlace) {
  if (typeof window === 'undefined') {
    return {
      url: '',
      userAgent: '',
      viewport: '',
      timestamp: '',
      selectedPlace: null,
      mapsUrl: '',
    }
  }

  const viewport = `${window.innerWidth || 0}x${window.innerHeight || 0}`
  const timestamp = new Date().toISOString()
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const selected = selectedPlace
    ? {
        id: selectedPlace.id ?? null,
        name: selectedPlace.name ?? null,
        google_place_id: selectedPlace.google_place_id ?? null,
        google_maps_url: selectedPlace.google_maps_url ?? null,
        address: selectedPlace.address ?? null,
        city: selectedPlace.city ?? null,
        state: selectedPlace.state ?? null,
      }
    : null

  return {
    url: window.location.href,
    userAgent,
    viewport,
    timestamp,
    selectedPlace: selected,
    mapsUrl: selected ? buildGoogleMapsUrl(selected) : '',
  }
}

export function BugReportModal({ onClose, onSuccess, onError, selectedPlace }) {
  const modalRef = useRef(null)
  const firstFieldRef = useRef(null)
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [metadata, setMetadata] = useState(() => buildMetadata(selectedPlace))

  useEffect(() => {
    setMetadata(buildMetadata(selectedPlace))
  }, [selectedPlace])

  useEffect(() => {
    const node = modalRef.current
    if (!node) return

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'Tab') {
        const focusable = node.querySelectorAll(
          'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault()
            last.focus()
          }
        } else if (document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    node.addEventListener('keydown', handleKeyDown)
    return () => node.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    firstFieldRef.current?.focus?.()
  }, [])

  const handleOverlayClick = event => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleSubmit = async event => {
    event.preventDefault()
    setSubmitError('')

    const trimmed = description.trim()
    if (trimmed.length < 10) {
      setDescriptionError('Please describe the bug in at least 10 characters.')
      firstFieldRef.current?.focus?.()
      return
    }
    setDescriptionError('')

    setSubmitting(true)
    try {
      const payload = {
        description: trimmed,
        email: email.trim() || null,
        url: metadata.url,
        userAgent: metadata.userAgent,
        viewport: metadata.viewport,
        timestamp: metadata.timestamp,
        selectedPlace: metadata.selectedPlace,
        mapsUrl: metadata.mapsUrl,
      }

      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data?.ok) {
        const message = data?.error || 'Failed to submit bug report.'
        setSubmitError(message)
        onError?.(message)
        return
      }

      onSuccess?.()
      setDescription('')
      setEmail('')
    } catch (error) {
      const message = error?.message || 'Failed to submit bug report.'
      setSubmitError(message)
      onError?.(message)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPlaceSummary = useMemo(() => {
    if (!metadata.selectedPlace) return null
    const entries = [
      metadata.selectedPlace.name ? `Name: ${metadata.selectedPlace.name}` : null,
      metadata.selectedPlace.id ? `ID: ${metadata.selectedPlace.id}` : null,
      metadata.selectedPlace.google_place_id
        ? `Google place ID: ${metadata.selectedPlace.google_place_id}`
        : null,
    ].filter(Boolean)
    if (entries.length === 0) return null
    return entries.join(' · ')
  }, [metadata.selectedPlace])

  return (
    <div className="bug-report-backdrop" onClick={handleOverlayClick}>
      <div
        className="bug-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        ref={modalRef}
      >
        <div className="bug-report-header">
          <h2 id="bug-report-title">Report a bug</h2>
          <button type="button" onClick={onClose} className="bug-report-close" aria-label="Close dialog">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="bug-report-form">
          <label htmlFor="bug-description" className="bug-report-label">
            What went wrong? <span className="bug-report-required">(required)</span>
          </label>
          <textarea
            id="bug-description"
            ref={firstFieldRef}
            value={description}
            onChange={event => {
              setDescription(event.target.value)
              if (descriptionError) {
                setDescriptionError('')
              }
              if (submitError) {
                setSubmitError('')
              }
            }}
            minLength={10}
            required
            rows={4}
            placeholder="Tell us what happened, what you expected, and any steps to reproduce."
          />
          {descriptionError ? <p className="bug-report-error">{descriptionError}</p> : null}

          <label htmlFor="bug-email" className="bug-report-label optional">
            Contact email (optional)
          </label>
          <input
            id="bug-email"
            type="email"
            value={email}
            onChange={event => {
              setEmail(event.target.value)
              if (submitError) {
                setSubmitError('')
              }
            }}
            placeholder="you@example.com"
            autoComplete="email"
          />

          <fieldset className="bug-report-meta" aria-live="polite">
            <legend>Captured details</legend>
            <dl>
              <div>
                <dt>URL</dt>
                <dd>{metadata.url}</dd>
              </div>
              <div>
                <dt>User agent</dt>
                <dd>{metadata.userAgent}</dd>
              </div>
              <div>
                <dt>Viewport</dt>
                <dd>{metadata.viewport}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{metadata.timestamp}</dd>
              </div>
              {selectedPlaceSummary ? (
                <div>
                  <dt>Selected place</dt>
                  <dd>{selectedPlaceSummary}</dd>
                </div>
              ) : null}
            </dl>
          </fieldset>

          {submitError ? <p className="bug-report-error">{submitError}</p> : null}

          <div className="bug-report-actions">
            <button type="button" onClick={onClose} className="bug-report-button-secondary">
              Cancel
            </button>
            <button type="submit" className="bug-report-button-primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
