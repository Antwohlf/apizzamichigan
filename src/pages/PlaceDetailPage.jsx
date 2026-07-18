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

const photoUrl = storagePath => {
  if (!storagePath) return null
  const { data } = supabase.storage.from('review-photos').getPublicUrl(storagePath)
  return data?.publicUrl || null
}

export default function PlaceDetailPage({ themeKey = ThemeKeys.PIZZA }) {
  const { id } = useParams()
  const { theme } = useTheme()
  const [place, setPlace] = useState(null)
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

      const { data: photoRows } = await supabase
        .from('review-photos')
        .select('id, storage_path, sort_order')
        .eq('place_id', id)
        .order('sort_order', { ascending: true })
      if (!active) return
      setPhotos((photoRows || []).map(photo => ({
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
        {typeof place.rating === 'number' ? <p className="place-detail__rating">★ {place.rating.toFixed(1)}</p> : null}
        {photos.length ? <ReviewGallery photos={photos} placeName={place.name} /> : null}
        <div className="place-detail__actions">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          {place.website_url ? <a href={place.website_url} target="_blank" rel="noopener noreferrer">Official website</a> : null}
        </div>
      </article>
    </main>
  )
}
