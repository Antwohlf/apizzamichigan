import L from 'leaflet'
import { teardownPopup } from '../../components/map/renderPopup'

type Mode = 'hidden' | 'preview' | 'expanded'
type PopupTarget = { id: string; lat: number; lng: number; type: 'pizza' | 'taco' }

function isLeafletMap(map: any): map is L.Map {
  return Boolean(map && typeof map.setView === 'function' && typeof map.project === 'function')
}

function isMapboxMap(map: any): boolean {
  return Boolean(map && typeof map.easeTo === 'function' && typeof map.getCenter === 'function')
}

export class PopupController {
  private mode: Mode = 'hidden'
  private target: PopupTarget | null = null
  private container: HTMLElement | null = null
  private map: any
  private popup: any
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private isTouch: boolean =
    typeof window !== 'undefined' && typeof matchMedia === 'function'
      ? matchMedia('(pointer: coarse)').matches
      : false

  constructor(map: any) {
    this.map = map
    this.init()
  }

  private init() {
    if (typeof document === 'undefined') return
    this.container = document.createElement('div')
    this.container.className = 'marker-popup'
    this.container.dataset.mode = 'hidden'
    this.container.addEventListener('mouseenter', () => {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer)
        this.hideTimer = null
      }
    })
    this.container.addEventListener('mouseleave', () => {
      if (this.mode === 'preview') {
        this.hide(120)
      }
    })

    if (isLeafletMap(this.map)) {
      this.popup = L.popup({
        closeButton: false,
        autoPan: false,
        autoPanPaddingTopLeft: [20, 40],
        autoPanPaddingBottomRight: [20, 20],
        offset: [0, -32],
        className: 'marker-popup-shell',
      })
    } else if (isMapboxMap(this.map)) {
      const mapbox = (window as any)?.mapboxgl
      if (mapbox) {
        this.popup = new mapbox.Popup({ closeButton: false, offset: 16 })
      }
    }
  }

  private mount(target: PopupTarget) {
    if (!this.container) {
      this.init()
    }
    if (!this.container) return
    this.target = target
    if (isLeafletMap(this.map)) {
      this.popup
        .setLatLng([target.lat, target.lng])
        .setContent(this.container)
        .addTo(this.map)
    } else if (isMapboxMap(this.map) && this.popup) {
      this.popup.setLngLat([target.lng, target.lat]).setDOMContent(this.container).addTo(this.map)
    }
  }

  openPreview(target: PopupTarget, render: (node: HTMLElement) => void) {
    if (this.isTouch) return
    if (this.mode === 'expanded' && this.target?.id === target.id) return

    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    this.mode = 'preview'
    this.mount(target)
    if (!this.container) return
    this.container.dataset.mode = 'preview'
    render(this.container)
  }

  expand(target: PopupTarget, render: (node: HTMLElement) => void) {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    const prevTargetId = this.target?.id
    this.mode = 'expanded'
    this.mount(target)
    if (!this.container) return
    this.container.dataset.mode = 'expanded'
    render(this.container)

    console.assert(this.popupTargetIsUnique(), 'Exactly one popup must exist')
    console.assert(
      !prevTargetId || this.target?.id === target.id,
      'Expanding a new target should replace the previous popup'
    )

    if (isMapboxMap(this.map)) {
      ;(this.map as any).easeTo({ center: [target.lng, target.lat], duration: 500, offset: [0, -80] })
    }
  }

  hide(delayMs = 0) {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    const run = () => {
      this.mode = 'hidden'
      this.target = null
      if (this.container) {
        this.container.dataset.mode = 'hidden'
        teardownPopup(this.container)
      }
      try {
        this.popup?.remove()
      } catch (err) {
        console.warn('[PopupController] failed to remove popup', err)
      }
    }

    if (delayMs > 0) {
      this.hideTimer = setTimeout(run, delayMs)
    } else {
      run()
    }
  }

  isExpanded(id: string) {
    return this.mode === 'expanded' && this.target?.id === id
  }

  isPreview(id: string) {
    return this.mode === 'preview' && this.target?.id === id
  }

  private popupTargetIsUnique() {
    if (typeof document === 'undefined') return true
    const instances = document.querySelectorAll('.marker-popup')
    return instances.length <= 1
  }
}
