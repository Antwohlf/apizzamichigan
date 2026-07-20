import { createRoot, type Root } from 'react-dom/client'
import ReviewGallery from '../ReviewGallery'
import { buildGoogleMapsUrl } from '../../lib/buildGoogleMapsUrl'

type ReviewPhoto = {
  id?: string | number
  path?: string | null
  publicUrl?: string | null
  url?: string | null
  sortOrder?: number | null
}

type Place = {
  id: string
  name: string
  lat: number
  lng: number
  type: 'pizza' | 'taco'
  price?: string | null
  price_range?: string | null
  priceRange?: string | null
  status?: string | null
  rating?: number | null
  address?: string | null
  href?: string | null
  city?: string | null
  state?: string | null
  style?: string | null
  google_place_id?: string | null
  google_maps_url?: string | null
  lifecycle_status?: string | null
  lifecycleStatus?: string | null
  lifecycle_replaced_by_id?: string | number | null
  favorited?: boolean | null
  photos?: Array<ReviewPhoto | string> | null
}

const roots = new WeakMap<HTMLElement, Root>()

const stopPopupEvent = (event: React.SyntheticEvent) => {
  event.stopPropagation()
  event.nativeEvent?.stopImmediatePropagation?.()
}

function displayPrice(place: Place) {
  return place.price_range || place.priceRange || place.price || null
}

function displayStatus(place: Place) {
  const raw = String(place.status || '').trim()
  if (!raw) return null
  const normalized = raw.toLowerCase()
  if (normalized.startsWith('visited')) return 'Anthony reviewed'
  if (normalized.startsWith('golden')) return 'Golden'
  return raw
}

function displayLifecycle(place: Place) {
  const raw = String(place.lifecycle_status || place.lifecycleStatus || '').trim().toLowerCase()
  if (raw === 'closed' || raw.startsWith('closed')) return 'Historical location'
  if (raw === 'replaced' || raw.startsWith('replaced')) return 'Replaced by a newer business'
  if (raw === 'demolished' || raw.startsWith('demolished')) return 'Demolished location'
  return null
}

function displayLocation(place: Place) {
  const cityState = [place.city, place.state].filter(Boolean).join(', ')
  if (!place.address) return cityState || null
  if (place.city && !place.address.toLowerCase().includes(place.city.toLowerCase())) {
    return `${place.address}, ${place.city}`
  }
  return place.address
}

function internalDetailHref(place: Place) {
  const prefix = place.type === 'taco' ? '/tacos/places' : '/places'
  return `${prefix}/${encodeURIComponent(place.id)}`
}

function getRoot(node: HTMLElement) {
  let root = roots.get(node)
  if (!root) {
    root = createRoot(node)
    roots.set(node, root)
  }
  return root
}

export function renderPreview(node: HTMLElement, place: Place) {
  const isGolden = place.type === 'taco' && Boolean(place.favorited)
  const price = displayPrice(place)
  const status = displayStatus(place)
  const lifecycle = displayLifecycle(place)
  const classNames = ['popup-card']
  if (isGolden) {
    classNames.push('popup-card--favorited', 'golden-glow')
  }
  getRoot(node).render(
    <div
      className={classNames.join(' ')}
      data-mode="preview"
      role="dialog"
      aria-modal="false"
      data-favorited={isGolden ? 'true' : 'false'}
    >
      <div className="title">{place.name}</div>
      <div className="meta">
        {price ? <span className="badge">{price}</span> : null}
        {place.style ? <span className="badge badge--style">{place.style}</span> : null}
        {status ? <span className="badge badge--status">{status}</span> : null}
        {lifecycle ? <span className="badge badge--status">{lifecycle}</span> : null}
        {isGolden ? <span className="badge badge--golden">Golden</span> : null}
      </div>
    </div>
  )
}

export function renderExpanded(node: HTMLElement, place: Place, onClose: () => void) {
  const isGolden = place.type === 'taco' && Boolean(place.favorited)
  const price = displayPrice(place)
  const status = displayStatus(place)
  const lifecycle = displayLifecycle(place)
  const location = displayLocation(place)
  const photos = Array.isArray(place.photos) ? place.photos.filter(Boolean) : []
  const classNames = ['popup-card']
  if (isGolden) {
    classNames.push('popup-card--favorited', 'golden-glow')
  }
  getRoot(node).render(
    <div
      className={classNames.join(' ')}
      data-mode="expanded"
      role="dialog"
      aria-modal="true"
      aria-label={`${place.name} details`}
      data-favorited={isGolden ? 'true' : 'false'}
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <button
        className="close"
        onClick={event => {
          stopPopupEvent(event)
          onClose()
        }}
        onMouseDown={stopPopupEvent}
        onPointerDown={stopPopupEvent}
        aria-label="Close"
      >
        ×
      </button>
      <div className="popup-card__body">
        <div className="title">{place.name}</div>
        {(place.style || price || status || lifecycle) ? (
          <div className="popup-card__chips">
            {place.style ? <span className="badge badge--style">{place.style}</span> : null}
            {price ? <span className="badge">{price}</span> : null}
            {status ? <span className="badge badge--status">{status}</span> : null}
            {lifecycle ? <span className="badge badge--status">{lifecycle}</span> : null}
          </div>
        ) : null}
        {lifecycle ? (
          <div className="popup-card__lifecycle">
            {lifecycle}.
            {place.lifecycle_replaced_by_id ? (
              <a
                href={internalDetailHref({ ...place, id: String(place.lifecycle_replaced_by_id) })}
                onClick={stopPopupEvent}
                onMouseDown={stopPopupEvent}
                onPointerDown={stopPopupEvent}
              >
                View current place
              </a>
            ) : null}
          </div>
        ) : null}
        {typeof place.rating === 'number' ? (
          <div className="rating">★ {place.rating.toFixed(1)}</div>
        ) : null}
        {location ? (
          <div className="addr">
            {location}
          </div>
        ) : null}
        {photos.length ? (
          <div className="review-gallery-wrap">
            <ReviewGallery photos={photos} placeName={place.name} />
          </div>
        ) : null}
      </div>
      <div className="actions">
        {place.href ? (
          <a
            href={place.href}
            className="popup-link--details"
            onClick={stopPopupEvent}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            View place details
          </a>
        ) : (
          <a
            href={internalDetailHref(place)}
            className="popup-link--details"
            onClick={stopPopupEvent}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            View place details
          </a>
        )}
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
          onClick={stopPopupEvent}
          onMouseDown={stopPopupEvent}
          onPointerDown={stopPopupEvent}
        >
          Directions
        </a>
        <a
          href={buildGoogleMapsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="popup-link--details"
          onClick={stopPopupEvent}
          onMouseDown={stopPopupEvent}
          onPointerDown={stopPopupEvent}
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  )
}

export function teardownPopup(node: HTMLElement) {
  const root = roots.get(node)
  if (root) {
    try {
      root.render(null)
    } catch (err) {
      // swallow errors triggered if React is already committing unmount
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[renderPopup] failed to render null during teardown', err)
      }
    }
  }
}
