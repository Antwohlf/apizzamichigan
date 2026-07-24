import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTheme } from '../themes/ThemeProvider'
import { ThemeKeys } from '../themes/siteTheme'
import { supabase } from '../supabaseClient'
import { buildGoogleMapsUrl } from '../lib/buildGoogleMapsUrl'
import ReviewGallery from '../components/ReviewGallery'
import { publicPlaceDetailSelectForTable, publicPlaceLegacyDetailSelectForTable, publicPizzaPlaceDetailSelect } from '../lib/publicPlaceFields'
import { mapReturnPath, readMapReturnState } from '../map/mapReturnState'
import { entityConfigForTheme, normalizeEntityStyle } from '../config/entityConfig'
import { lifecycleCopy, normalizeLifecycleStatus, replacementCopy } from '../lib/lifecycle'
import { readSupabase } from '../lib/supabaseRead'
import { normalizeRating } from '../lib/ratings'
import { isLegacyPublicSchema, markLegacyPublicSchema } from '../lib/publicSchemaCapabilities'
import '../styles/place-detail.css'

export const PUBLIC_PLACE_DETAIL_SELECT = publicPizzaPlaceDetailSelect

export function isMissingPublicColumnError(error) {
  const message = String(error?.message || error?.details || error || '').toLowerCase()
  return (
    (message.includes('column') && message.includes('does not exist')) ||
    (message.includes('could not find') && message.includes('column') && message.includes('schema cache'))
  )
}

export { lifecycleCopy, normalizeLifecycleStatus, replacementCopy }

export const displayPlaceRating = value => normalizeRating(value)

export function formatHours(hours) {
  if (!hours) return ''
  if (typeof hours === 'string') return hours.trim()
  if (Array.isArray(hours)) return hours.filter(Boolean).join(' · ')
  if (typeof hours === 'object') {
    return Object.entries(hours)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([day, value]) => `${day}: ${value}`)
      .join(' · ')
  }
  return ''
}

function normalizeLocationPart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function addressContainsPart(address, part) {
  const normalizedAddress = normalizeLocationPart(address)
  const normalizedPart = normalizeLocationPart(part)
  if (!normalizedAddress || !normalizedPart) return false
  return ` ${normalizedAddress} `.includes(` ${normalizedPart} `)
}

export function formatPlaceLocation({ address, city, state } = {}) {
  const parts = [address, city, state].map(value => String(value || '').trim()).filter(Boolean)
  if (!parts.length) return ''
  if (!address) return parts.join(', ')
  return parts.filter((part, index) => index === 0 || !addressContainsPart(address, part)).join(', ')
}

export function displayPlaceStyle(style, themeKey = ThemeKeys.PIZZA) {
  const normalized = normalizeEntityStyle(entityConfigForTheme(themeKey).entity, style)
  return normalized && normalized !== 'Unknown' ? normalized : ''
}

export function displayEditorialStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized.startsWith('golden')) return "Anthony's Pick"
  if (normalized.startsWith('visited')) return 'Anthony reviewed'
  return ''
}

async function readOptionalDetailData(queryFactory, label) {
  try {
    return await readSupabase(queryFactory)
  } catch (error) {
    // Photos and successor metadata improve a detail page but are not part of
    // the canonical record. Keep the page usable when either side table is
    // unavailable or briefly fails.
    console.warn(`[PlaceDetailPage] Optional ${label} lookup failed:`, error)
    return { data: null, error }
  }
}

const photoUrl = storagePath => {
  if (!storagePath) return null
  const { data } = supabase.storage.from('review-photos').getPublicUrl(storagePath)
  return data?.publicUrl || null
}

export default function PlaceDetailPage({ themeKey = ThemeKeys.PIZZA }) {
  const { id } = useParams()
  const { theme } = useTheme()
  const entity = entityConfigForTheme(themeKey)
  const table = entity.table
  const [place, setPlace] = useState(null)
  const [replacementPlace, setReplacementPlace] = useState(null)
  const [photos, setPhotos] = useState([])
  const [state, setState] = useState('loading')
  const [returnPath] = useState(() => mapReturnPath(readMapReturnState(), entity.publicRoute))

  useEffect(() => {
    let active = true
    async function load() {
      setState('loading')
      const placeSelect = isLegacyPublicSchema(supabase.from, table)
        ? publicPlaceLegacyDetailSelectForTable(table)
        : publicPlaceDetailSelectForTable(table)
      let placeResult = await readSupabase(() => supabase
        .from(table)
        .select(placeSelect)
        .eq('id', id)
        .maybeSingle())

      // Search already supports older public schemas. Direct links need the
      // same compatibility so a missing lifecycle migration does not make a
      // valid place appear to be missing.
      if (placeResult.error && isMissingPublicColumnError(placeResult.error)) {
        markLegacyPublicSchema(supabase.from, table)
        placeResult = await readSupabase(() => supabase
          .from(table)
          .select(publicPlaceLegacyDetailSelectForTable(table))
          .eq('id', id)
          .maybeSingle())
      }

      const { data, error } = placeResult
      if (!active) return
      if (error || !data) {
        setState('error')
        return
      }
      setPlace(data)
      setReplacementPlace(null)

      const replacementId = data.lifecycle_replaced_by_id || data.lifecycleReplacedById
      const replacementRequest = replacementId
        ? readOptionalDetailData(() => supabase
          .from(table)
          .select('id, name, address, state')
          .eq('id', replacementId)
          .maybeSingle(), 'replacement')
        : Promise.resolve({ data: null })

      const [photoResult, replacementResult] = await Promise.all([
        readOptionalDetailData(() => supabase
          .from('review-photos')
          .select('id, storage_path, sort_order')
          .eq('place_id', id)
          .order('sort_order', { ascending: true }), 'photo'),
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
  }, [id, table, themeKey])

  if (state === 'loading') {
    return (
      <main className="place-detail-state place-detail-state--loading" aria-busy="true">
        <div className="place-detail-skeleton" role="status" aria-live="polite">
          <span className="place-detail-skeleton__eyebrow">{theme.brandName}</span>
          <span className="place-detail-skeleton__title" />
          <span className="place-detail-skeleton__line" />
          <span className="place-detail-skeleton__line place-detail-skeleton__line--short" />
          <p>Loading place details...</p>
        </div>
      </main>
    )
  }
  if (state === 'error' || !place) {
    return (
      <main className="place-detail-state">
        <h1>Place not found</h1>
        <Link to={entity.publicRoute}>Back to the map</Link>
      </main>
    )
  }

  const location = formatPlaceLocation(place)
  const mapsUrl = buildGoogleMapsUrl({ ...place, type: entity.entity })
  const lifecycleStatus = normalizeLifecycleStatus(place.lifecycle_status || place.lifecycleStatus)
  const lifecycle = lifecycleCopy(lifecycleStatus)
  const displayStyle = displayPlaceStyle(place.style, themeKey)
  const editorialStatus = displayEditorialStatus(place.status)
  const replacementId = place.lifecycle_replaced_by_id || place.lifecycleReplacedById
  const replacementHref = replacementId
    ? `${entity.placeRoute}/${encodeURIComponent(String(replacementId))}`
    : null

  return (
    <main className="place-detail" style={{ '--detail-accent': theme.palette.accent }}>
      <header className="place-detail__header">
        <Link className="place-detail__back" to={returnPath}>Back to map</Link>
        <span className="place-detail__eyebrow">{theme.brandName}</span>
      </header>
      <article className="place-detail__card">
        <div className="place-detail__hero">
          <div>
            <h1>{place.name}</h1>
            {location ? <p className="place-detail__location">{location}</p> : null}
          </div>
          <div className="place-detail__badges">
            {displayStyle ? <span>{displayStyle}</span> : null}
            {(place.price_range || place.price) ? <span>{place.price_range || place.price}</span> : null}
            {editorialStatus ? <span>{editorialStatus}</span> : null}
          </div>
        </div>
        {lifecycle ? (
          <section className={`place-detail__lifecycle place-detail__lifecycle--${lifecycleStatus}`} aria-label={lifecycle.label}>
            <strong>{lifecycle.label}</strong>
            <p>{lifecycle.message}</p>
            {lifecycleStatus === 'replaced' ? (
              <div className="place-detail__replacement">
                <strong>{replacementCopy(replacementPlace?.name, replacementId)}</strong>
                {replacementHref ? <Link to={replacementHref}>View current place</Link> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {displayPlaceRating(place.rating) !== null ? <p className="place-detail__rating">★ {displayPlaceRating(place.rating).toFixed(1)}</p> : null}
        {photos.length ? <ReviewGallery photos={photos} placeName={place.name} /> : null}
        {(place.phone || place.website_url || place.menu_url || place.hours || location) ? (
          <dl className="place-detail__facts">
            {location ? <><dt>Address</dt><dd>{location}</dd></> : null}
            {place.phone ? <><dt>Phone</dt><dd><a href={`tel:${place.phone}`}>{place.phone}</a></dd></> : null}
            {formatHours(place.hours) ? <><dt>Hours</dt><dd>{formatHours(place.hours)}</dd></> : null}
          </dl>
        ) : null}
        <div className="place-detail__actions">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          {place.website_url ? <a href={place.website_url} target="_blank" rel="noopener noreferrer">Official website</a> : null}
          {place.menu_url ? <a href={place.menu_url} target="_blank" rel="noopener noreferrer">View menu</a> : null}
        </div>
      </article>
    </main>
  )
}
