import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTheme } from '../themes/ThemeProvider'
import { ThemeKeys } from '../themes/siteTheme'
import { supabase } from '../supabaseClient'
import { buildGoogleMapsUrl } from '../lib/buildGoogleMapsUrl'
import ReviewGallery from '../components/ReviewGallery'
import '../styles/place-detail.css'

const TABLES = {
  [ThemeKeys.PIZZA]: 'pizza_places',
  [ThemeKeys.TACO]: 'taco_places',
}

export function normalizeLifecycleStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized.startsWith('closed')) return 'closed'
  if (normalized.startsWith('replaced')) return 'replaced'
  if (normalized.startsWith('demolished')) return 'demolished'
  return null
}

export function lifecycleCopy(status) {
  if (status === 'closed') {
    return {
      label: 'Historical place',
      message: 'This business is permanently closed. Its history remains part of the map.',
    }
  }
  if (status === 'replaced') {
    return {
      label: 'Replaced at this location',
      message: 'This business is no longer the current tenant at this address.',
    }
  }
  if (status === 'demolished') {
    return {
      label: 'Historical place',
      message: 'This location has been demolished. Its history remains part of the map.',
    }
  }
  return null
}

export function replacementCopy(placeName) {
  return placeName
    ? `Current place: ${placeName}`
    : 'The current place is linked below.'
}

const photoUrl = storagePath => {
  if (!storagePath) return null
  const { data } = supabase.storage.from('review-photos').getPublicUrl(storagePath)
  return data?.publicUrl || null
}

export default function PlaceDetailPage({ themeKey = ThemeKeys.PIZZA }) {
  const { id } = useParams()
  const { theme } = useTheme()
  const [place, setPlace] = useState(null)
  const [replacementPlace, setReplacementPlace] = useState(null)
  const [photos, setPhotos] = useState([])
  const [state, setState] = useState('loading')

  useEffect(() => {
    let active = true
    const table = TABLES[themeKey] || TABLES[ThemeKeys.PIZZA]

    async function load() {
      setState('loading')
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
      if (!active) return
      if (error || !data) {
        setState('error')
        return
      }
      setPlace(data)
      setReplacementPlace(null)

      const replacementId = data.lifecycle_replaced_by_id || data.lifecycleReplacedById
      const replacementRequest = replacementId
        ? supabase
          .from(table)
          .select('id, name, address, city, state')
          .eq('id', replacementId)
          .maybeSingle()
        : Promise.resolve({ data: null })

      const [photoResult, replacementResult] = await Promise.all([
        supabase
          .from('review-photos')
          .select('id, storage_path, sort_order')
          .eq('place_id', id)
          .order('sort_order', { ascending: true }),
        replacementRequest,
      ])
      if (!active) return
      setReplacementPlace(replacementResult?.data || null)
      setPhotos((photoResult?.data || []).map(photo => ({
        id: photo.id,
        publicUrl: photoUrl(photo.storage_path),
        sortOrder: photo.sort_order,
      })).filter(photo => photo.publicUrl))
      setState('ready')
    }

    load().catch(() => active && setState('error'))
    return () => { active = false }
  }, [id, themeKey])

  if (state === 'loading') return <div className="place-detail-state">Loading place details...</div>
  if (state === 'error' || !place) {
    return (
      <main className="place-detail-state">
        <h1>Place not found</h1>
        <Link to={themeKey === ThemeKeys.TACO ? '/tacos' : '/'}>Back to the map</Link>
      </main>
    )
  }

  const location = [place.address, place.city, place.state].filter(Boolean).join(', ')
  const mapsUrl = buildGoogleMapsUrl({ ...place, type: themeKey === ThemeKeys.TACO ? 'taco' : 'pizza' })
  const lifecycleStatus = normalizeLifecycleStatus(place.lifecycle_status || place.lifecycleStatus)
  const lifecycle = lifecycleCopy(lifecycleStatus)
  const replacementId = place.lifecycle_replaced_by_id || place.lifecycleReplacedById
  const replacementHref = replacementId
    ? `${themeKey === ThemeKeys.TACO ? '/tacos/places' : '/places'}/${encodeURIComponent(String(replacementId))}`
    : null

  return (
    <main className="place-detail" style={{ '--detail-accent': theme.palette.accent }}>
      <header className="place-detail__header">
        <Link className="place-detail__back" to={themeKey === ThemeKeys.TACO ? '/tacos' : '/'}>Back to map</Link>
        <span className="place-detail__eyebrow">{theme.brandName}</span>
      </header>
      <article className="place-detail__card">
        <div className="place-detail__hero">
          <div>
            <h1>{place.name}</h1>
            {location ? <p className="place-detail__location">{location}</p> : null}
          </div>
          <div className="place-detail__badges">
            {place.style ? <span>{place.style}</span> : null}
            {(place.price_range || place.price) ? <span>{place.price_range || place.price}</span> : null}
            {place.status ? <span>{String(place.status).toLowerCase() === 'visited' ? 'Anthony reviewed' : place.status}</span> : null}
          </div>
        </div>
        {lifecycle ? (
          <section className={`place-detail__lifecycle place-detail__lifecycle--${lifecycleStatus}`} aria-label={lifecycle.label}>
            <strong>{lifecycle.label}</strong>
            <p>{lifecycle.message}</p>
            {replacementHref ? (
              <div className="place-detail__replacement">
                <strong>{replacementCopy(replacementPlace?.name)}</strong>
                <Link to={replacementHref}>View current place</Link>
              </div>
            ) : null}
          </section>
        ) : null}
        {typeof place.rating === 'number' ? <p className="place-detail__rating">★ {place.rating.toFixed(1)}</p> : null}
        {photos.length ? <ReviewGallery photos={photos} placeName={place.name} /> : null}
        {(place.phone || place.website_url || location) ? (
          <dl className="place-detail__facts">
            {location ? <><dt>Address</dt><dd>{location}</dd></> : null}
            {place.phone ? <><dt>Phone</dt><dd><a href={`tel:${place.phone}`}>{place.phone}</a></dd></> : null}
          </dl>
        ) : null}
        <div className="place-detail__actions">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          {place.website_url ? <a href={place.website_url} target="_blank" rel="noopener noreferrer">Official website</a> : null}
        </div>
      </article>
    </main>
  )
}
