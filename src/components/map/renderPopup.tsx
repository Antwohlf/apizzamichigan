import { createRoot, type Root } from 'react-dom/client'
import { buildGoogleMapsUrl } from '../../lib/buildGoogleMapsUrl'

type Place = {
  id: string
  name: string
  lat: number
  lng: number
  type: 'pizza' | 'taco'
  price?: string | null
  status?: string | null
  rating?: number | null
  address?: string | null
  href?: string | null
  city?: string | null
  state?: string | null
  google_place_id?: string | null
  google_maps_url?: string | null
  favorited?: boolean | null
}

const roots = new WeakMap<HTMLElement, Root>()

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
        {place.price ? <span className="badge">{place.price}</span> : null}
        {place.status ? <span className="badge">{place.status}</span> : null}
        {isGolden ? <span className="badge badge--golden">Golden</span> : null}
      </div>
    </div>
  )
}

export function renderExpanded(node: HTMLElement, place: Place, onClose: () => void) {
  const isGolden = place.type === 'taco' && Boolean(place.favorited)
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
      data-favorited={isGolden ? 'true' : 'false'}
    >
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="title">{place.name}</div>
      {typeof place.rating === 'number' ? (
        <div className="rating">★ {place.rating.toFixed(1)}</div>
      ) : null}
      {place.address ? <div className="addr">{place.address}</div> : null}
      <div className="actions">
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
        >
          Directions
        </a>
        <a
          href={buildGoogleMapsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="popup-link--details"
        >
          View details
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
