import { createRoot, type Root } from 'react-dom/client'
import ReviewGallery from '../ReviewGallery'
import { buildGoogleMapsUrl } from '../../lib/buildGoogleMapsUrl'
import { lifecycleCopy, normalizeLifecycleStatus, replacementCopy } from '../../lib/lifecycle'
import { normalizeRating } from '../../lib/ratings'
import { formatHours, formatHoursEntries, normalizePhone, phoneHref } from '../../lib/placeContact'
import { entityConfig, normalizeEntityStyle } from '../../config/entityConfig'

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
  phone?: string | null
  website_url?: string | null
  websiteUrl?: string | null
  menu_url?: string | null
  menuUrl?: string | null
  hours?: unknown
  href?: string | null
  city?: string | null
  state?: string | null
  style?: string | null
  google_place_id?: string | null
  google_maps_url?: string | null
  lifecycle_status?: string | null
  lifecycleStatus?: string | null
  lifecycle_replaced_by_id?: string | number | null
  lifecycleReplacedById?: string | number | null
  lifecycle_replaced_by_name?: string | null
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

export function displayPopupStyle(place: Place) {
  const raw = String(place.style || '').trim()
  if (!raw) return null
  const normalized = normalizeEntityStyle(place.type, raw)
  return normalized && normalized !== 'Unknown' ? normalized : null
}

function displayStatus(place: Place) {
  const raw = String(place.status || '').trim()
  if (!raw) return null
  const normalized = raw.toLowerCase()
  if (normalized.startsWith('visited')) return 'Anthony reviewed'
  if (normalized.startsWith('golden')) return null
  return raw
}

function isFavoritedPlace(place: Place) {
  if (typeof place.favorited === 'boolean') return place.favorited
  return String(place.status || '').trim().toLowerCase().startsWith('golden')
}

function displayLifecycle(place: Place) {
  return lifecycleCopy(place.lifecycle_status || place.lifecycleStatus)
}

function replacementId(place: Place) {
  return place.lifecycle_replaced_by_id ?? place.lifecycleReplacedById ?? null
}

function replacementLabel(place: Place) {
  if (normalizeLifecycleStatus(place.lifecycle_status || place.lifecycleStatus) !== 'replaced') return null
  return replacementCopy(
    place.lifecycle_replaced_by_name,
    replacementId(place),
    place.name,
  )
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
  const prefix = entityConfig(place.type).placeRoute
  return `${prefix}/${encodeURIComponent(place.id)}`
}

function officialWebsite(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch (error) {
    return null
  }
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
  const isGolden = isFavoritedPlace(place)
  const price = displayPrice(place)
  const style = displayPopupStyle(place)
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
        {style ? <span className="badge badge--style">{style}</span> : null}
        {status ? <span className="badge badge--status">{status}</span> : null}
        {lifecycle ? <span className="badge badge--status">{lifecycle.badge}</span> : null}
        {isGolden ? <span className="badge badge--golden">Anthony&apos;s Pick</span> : null}
      </div>
    </div>
  )
}

export function renderExpanded(
  node: HTMLElement,
  place: Place,
  onClose: () => void,
  onDetailsNavigate?: () => void,
) {
  const isGolden = isFavoritedPlace(place)
  const price = displayPrice(place)
  const style = displayPopupStyle(place)
  const status = displayStatus(place)
  const lifecycle = displayLifecycle(place)
  const location = displayLocation(place)
  const website = officialWebsite(place.website_url || place.websiteUrl)
  const menu = officialWebsite(place.menu_url || place.menuUrl)
  const hours = formatHours(place.hours) || null
  const hourEntries = formatHoursEntries(place.hours)
  const phone = normalizePhone(place.phone)
  const phoneUrl = phoneHref(phone)
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
        {(style || price || status || lifecycle || isGolden) ? (
          <div className="popup-card__chips">
            {style ? <span className="badge badge--style">{style}</span> : null}
            {price ? <span className="badge">{price}</span> : null}
            {status ? <span className="badge badge--status">{status}</span> : null}
            {lifecycle ? <span className="badge badge--status">{lifecycle.badge}</span> : null}
            {isGolden ? <span className="badge badge--golden">Anthony&apos;s Pick</span> : null}
          </div>
        ) : null}
        {lifecycle ? (
          <div className="popup-card__lifecycle">
            {lifecycle.message}
            {replacementLabel(place) ? (
              <span className="popup-card__replacement-name"> {replacementLabel(place)}.</span>
            ) : null}
            {replacementId(place) ? (
              <a
                href={internalDetailHref({ ...place, id: String(replacementId(place)) })}
                onClick={event => {
                  onDetailsNavigate?.()
                  stopPopupEvent(event)
                }}
                onMouseDown={stopPopupEvent}
                onPointerDown={stopPopupEvent}
              >
                View current place
              </a>
            ) : null}
          </div>
        ) : null}
        {normalizeRating(place.rating) !== null ? (
          <div className="rating">★ {normalizeRating(place.rating)!.toFixed(1)}</div>
        ) : null}
        {location ? (
          <div className="addr">
            {location}
          </div>
        ) : null}
        {phone ? (
          <div className="addr">
            {phoneUrl ? <a href={phoneUrl} onClick={stopPopupEvent}>{phone}</a> : phone}
          </div>
        ) : null}
        {hours ? (
          hourEntries.length ? (
            <div className="addr popup-card__hours">
              <strong>Hours</strong>
              <ul aria-label="Opening hours">
                {hourEntries.map(({ label, value }, index) => (
                  <li key={`${label}-${index}`}>
                    {label ? <strong>{label}</strong> : null}<span>{value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <div className="addr">Hours: {hours}</div>
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
            onClick={event => {
              onDetailsNavigate?.()
              stopPopupEvent(event)
            }}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            View place details
          </a>
        ) : (
          <a
            href={internalDetailHref(place)}
            className="popup-link--details"
            onClick={event => {
              onDetailsNavigate?.()
              stopPopupEvent(event)
            }}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            View place details
          </a>
        )}
        {phoneUrl ? (
          <a
            href={phoneUrl}
            className="popup-link--primary"
            onClick={stopPopupEvent}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            Call restaurant
          </a>
        ) : null}
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="popup-link--details"
            onClick={stopPopupEvent}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            Official website
          </a>
        ) : null}
        {menu ? (
          <a
            href={menu}
            target="_blank"
            rel="noopener noreferrer"
            className="popup-link--details"
            onClick={stopPopupEvent}
            onMouseDown={stopPopupEvent}
            onPointerDown={stopPopupEvent}
          >
            Menu
          </a>
        ) : null}
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
          className="popup-link--primary"
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
