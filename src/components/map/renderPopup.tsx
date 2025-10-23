import { createRoot, type Root } from 'react-dom/client'

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
  getRoot(node).render(
    <div className="popup-card" data-mode="preview" role="dialog" aria-modal="false">
      <div className="title">{place.name}</div>
      <div className="meta">
        {place.price ? <span className="badge">{place.price}</span> : null}
        {place.status ? <span className="badge">{place.status}</span> : null}
      </div>
    </div>
  )
}

export function renderExpanded(node: HTMLElement, place: Place, onClose: () => void) {
  getRoot(node).render(
    <div className="popup-card" data-mode="expanded" role="dialog" aria-modal="true">
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
          rel="noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
        >
          Directions
        </a>
        {place.href ? (
          <a href={place.href} rel="noreferrer">
            View details
          </a>
        ) : null}
      </div>
    </div>
  )
}

export function teardownPopup(node: HTMLElement) {
  const root = roots.get(node)
  if (root) {
    root.unmount()
    roots.delete(node)
  }
}
