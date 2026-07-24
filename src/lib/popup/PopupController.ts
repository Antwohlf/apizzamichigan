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

export function popupVisibilityPanOffset({
  popupTop,
  popupBottom,
  popupLeft,
  popupRight,
  mapTop,
  mapBottom,
  mapLeft,
  mapRight,
  topPadding = 16,
  bottomPadding = 16,
  leftPadding = 16,
  rightPadding = 16,
}: {
  popupTop: number
  popupBottom: number
  popupLeft?: number
  popupRight?: number
  mapTop: number
  mapBottom: number
  mapLeft?: number
  mapRight?: number
  topPadding?: number
  bottomPadding?: number
  leftPadding?: number
  rightPadding?: number
}): [number, number] {
  const topBoundary = mapTop + topPadding
  const bottomBoundary = mapBottom - bottomPadding
  let x = 0
  let y = 0

  if (popupLeft !== undefined && popupRight !== undefined && mapLeft !== undefined && mapRight !== undefined) {
    const leftBoundary = mapLeft + leftPadding
    const rightBoundary = mapRight - rightPadding
    if (popupLeft < leftBoundary) x = popupLeft - leftBoundary
    else if (popupRight > rightBoundary) x = popupRight - rightBoundary
  }

  if (popupTop < topBoundary) y = -(topBoundary - popupTop)
  else if (popupBottom > bottomBoundary) y = popupBottom - bottomBoundary

  return [x, y]
}

export class PopupController {
  private mode: Mode = 'hidden'
  private target: PopupTarget | null = null
  private container: HTMLElement | null = null
  private map: any
  private popup: any
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private visibilityTimers: number[] = []
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

  private setExpandedState(expanded: boolean) {
    const container = isLeafletMap(this.map) || isMapboxMap(this.map)
      ? this.map.getContainer?.()
      : null
    container?.classList.toggle('map-popup-expanded', expanded)
    container?.parentElement?.classList.toggle('map-popup-expanded', expanded)
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

  private keepExpandedPopupVisible() {
    if (!isLeafletMap(this.map) || typeof window === 'undefined') return
    const mapElement = this.map.getContainer?.()
    const popupElement = (
      this.container?.querySelector('.popup-card[data-mode="expanded"]') ||
      document.querySelector('.marker-popup .popup-card[data-mode="expanded"]')
    ) as HTMLElement | null
    if (!mapElement || !popupElement || typeof this.map.panBy !== 'function') return

    const mapRect = mapElement.getBoundingClientRect()
    const popupRect = popupElement.getBoundingClientRect()
    const isSmallScreen = window.matchMedia?.('(max-width: 480px)').matches
    const offset = popupVisibilityPanOffset({
      popupTop: popupRect.top,
      popupBottom: popupRect.bottom,
      popupLeft: popupRect.left,
      popupRight: popupRect.right,
      mapTop: mapRect.top,
      mapBottom: mapRect.bottom,
      mapLeft: mapRect.left,
      mapRight: mapRect.right,
      topPadding: isSmallScreen ? 108 : 72,
      bottomPadding: 16,
      leftPadding: 8,
      rightPadding: 8,
    })
    if (offset[0] !== 0 || offset[1] !== 0) {
      this.map.panBy(offset, { animate: false })
    }
  }

  private clearVisibilityTimers() {
    this.visibilityTimers.forEach(timer => window.clearTimeout(timer))
    this.visibilityTimers = []
  }

  private scheduleVisibilityCheck(delay: number) {
    if (typeof window === 'undefined') return
    const timer = window.setTimeout(() => {
      this.visibilityTimers = this.visibilityTimers.filter(activeTimer => activeTimer !== timer)
      if (this.mode === 'expanded') this.keepExpandedPopupVisible()
    }, delay)
    this.visibilityTimers.push(timer)
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
    this.clearVisibilityTimers()
    const prevTargetId = this.target?.id
    this.mode = 'expanded'
    this.setExpandedState(true)
    this.mount(target)
    if (!this.container) return
    this.container.dataset.mode = 'expanded'
    render(this.container)

    // React renders the popup content after Leaflet positions its shell. Wait
    // one frame so mobile controls cannot cover the expanded card.
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => this.keepExpandedPopupVisible())
      // Leaflet may reposition the popup again after the first pan while the
      // marker layer settles. Recheck once after that layout pass.
      this.scheduleVisibilityCheck(180)
      // Search-result focus also runs a fly-to animation. Check once after
      // that animation so the card cannot finish underneath the map toolbar.
      this.scheduleVisibilityCheck(1000)
    }

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
      this.clearVisibilityTimers()
      this.target = null
      this.setExpandedState(false)
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
