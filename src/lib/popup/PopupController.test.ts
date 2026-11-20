import { PopupController, popupVisibilityPanOffset } from './PopupController'

jest.mock('../../components/map/renderPopup', () => ({ teardownPopup: jest.fn() }))
jest.mock('leaflet', () => ({
  popup: () => {
    let content: HTMLElement
    let pane: HTMLElement
    const shell = global.document.createElement('div')
    shell.className = 'marker-popup-shell'
    const popup = {
      setLatLng: () => popup,
      setContent: (node: HTMLElement) => { content = node; shell.appendChild(content); return popup },
      addTo: (map: any) => { pane = map.getPane(); pane.appendChild(shell); return popup },
      getElement: () => shell,
      getPane: () => pane,
      update: jest.fn(),
      remove: () => shell.remove(),
    }
    return popup
  },
}))

describe('popupVisibilityPanOffset', () => {
  test('moves a popup down when controls cover its top edge', () => {
    expect(popupVisibilityPanOffset({
      popupTop: 170,
      popupBottom: 360,
      mapTop: 154,
      mapBottom: 694,
      topPadding: 108,
    })).toEqual([0, -92])
  })

  test('moves a popup up when it extends below the map', () => {
    expect(popupVisibilityPanOffset({
      popupTop: 400,
      popupBottom: 720,
      mapTop: 154,
      mapBottom: 694,
      bottomPadding: 16,
    })).toEqual([0, 42])
  })

  test('does not move a popup already inside the usable map area', () => {
    expect(popupVisibilityPanOffset({
      popupTop: 270,
      popupBottom: 450,
      mapTop: 154,
      mapBottom: 694,
      topPadding: 108,
    })).toEqual([0, 0])
  })

  test('moves a popup right when it extends past the left edge', () => {
    expect(popupVisibilityPanOffset({
      popupTop: 270,
      popupBottom: 450,
      popupLeft: 20,
      popupRight: 340,
      mapTop: 154,
      mapBottom: 694,
      mapLeft: 24,
      mapRight: 390,
      leftPadding: 8,
      rightPadding: 8,
    })).toEqual([-12, 0])
  })

  test('moves a popup left when it extends past the right edge', () => {
    expect(popupVisibilityPanOffset({
      popupTop: 270,
      popupBottom: 450,
      popupLeft: 160,
      popupRight: 420,
      mapTop: 154,
      mapBottom: 694,
      mapLeft: 24,
      mapRight: 390,
      leftPadding: 8,
      rightPadding: 8,
    })).toEqual([38, 0])
  })
})

describe('popup visibility after map interaction', () => {
  let controller: PopupController
  let mapElement: HTMLElement
  let map: any
  let handlers: Record<string, Set<() => void>>
  let popupPane: HTMLElement
  const originalMatchMedia = window.matchMedia
  const target = { id: 'first', lat: 42.28, lng: -83.74, type: 'pizza' as const }
  const rect = (top: number, height: number) => ({
    top, bottom: top + height, left: 0, right: 390, width: 390, height,
    x: 0, y: top, toJSON: () => ({}),
  })
  const renderCard = (node: HTMLElement) => {
    node.innerHTML = '<article class="popup-card" data-mode="expanded">Selected place</article>'
    jest.spyOn(node.firstElementChild!, 'getBoundingClientRect').mockReturnValue(rect(80, 320))
  }
  const fireMapEvent = (name: string) => handlers[name]?.forEach(handler => handler())

  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(0), 16))
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
    mapElement = document.createElement('div')
    document.body.appendChild(mapElement)
    popupPane = document.createElement('div')
    popupPane.style.transform = 'translate3d(120px, 80px, 0)'
    mapElement.appendChild(popupPane)
    jest.spyOn(mapElement, 'getBoundingClientRect').mockReturnValue(rect(100, 600))
    handlers = {}
    map = {
      getContainer: () => mapElement,
      getPane: () => popupPane,
      setView: jest.fn(),
      project: jest.fn(),
      panBy: jest.fn(),
      on: jest.fn((name: string, handler: () => void) => {
        if (!handlers[name]) handlers[name] = new Set()
        handlers[name].add(handler)
      }),
      off: jest.fn((name: string, handler: () => void) => handlers[name]?.delete(handler)),
    }
    controller = new PopupController(map)
  })

  afterEach(() => {
    controller.hide()
    mapElement.remove()
    jest.restoreAllMocks()
    jest.useRealTimers()
    window.matchMedia = originalMatchMedia
  })

  test('keeps the initial card visible through a programmatic search fly-to', () => {
    controller.expand(target, renderCard)
    fireMapEvent('movestart')
    fireMapEvent('zoomstart')
    jest.advanceTimersByTime(16)
    expect(map.panBy).toHaveBeenCalledTimes(1)
    expect(map.panBy).toHaveBeenLastCalledWith([-8, -92], { animate: false })
    jest.advanceTimersByTime(1000)
    expect(map.panBy).toHaveBeenCalledTimes(3)
    expect(controller.isExpanded(target.id)).toBe(true)
  })

  test('a neighboring marker hover cannot replace an expanded selection during camera movement', () => {
    const renderNeighborPreview = jest.fn()
    controller.expand(target, renderCard)
    fireMapEvent('movestart')
    controller.openPreview({ ...target, id: 'neighbor' }, renderNeighborPreview)
    jest.advanceTimersByTime(1200)

    expect(renderNeighborPreview).not.toHaveBeenCalled()
    expect(controller.isExpanded()).toBe(true)
    expect(controller.isExpanded(target.id)).toBe(true)
    expect(controller.isExpanded('neighbor')).toBe(false)
    expect(mapElement.querySelector('.popup-card')).toHaveTextContent('Selected place')
  })

  test.each([120, 200])('passive marker blur/mouseout hide at %d ms cannot dismiss an expanded card', delay => {
    controller.expand(target, renderCard)
    controller.hide(delay)
    jest.advanceTimersByTime(1200)
    expect(controller.isExpanded(target.id)).toBe(true)
    expect(mapElement.querySelector('.popup-card')).not.toBeNull()
  })

  test('expanding a selection cancels a pending preview hide', () => {
    controller.openPreview({ ...target, id: 'neighbor' }, node => { node.textContent = 'Neighbor preview' })
    controller.hide(200)
    controller.expand(target, renderCard)
    jest.advanceTimersByTime(1200)
    expect(controller.isExpanded(target.id)).toBe(true)
    expect(mapElement.querySelector('.popup-card')).toHaveTextContent('Selected place')
  })

  test('explicit selection replaces the card and explicit close restores normal previews', () => {
    controller.expand(target, renderCard)
    controller.expand({ ...target, id: 'neighbor' }, node => { node.textContent = 'Explicit neighbor selection' })
    expect(controller.isExpanded('neighbor')).toBe(true)
    expect(controller.isExpanded(target.id)).toBe(false)
    expect(mapElement).toHaveTextContent('Explicit neighbor selection')

    controller.hide()
    expect(controller.isExpanded()).toBe(false)
    expect(mapElement.querySelector('.marker-popup')).toBeNull()
    controller.openPreview(target, node => { node.textContent = 'Normal preview' })
    expect(controller.isPreview(target.id)).toBe(true)
    expect(mapElement).toHaveTextContent('Normal preview')
  })

  test.each(['pointerdown', 'mousedown', 'touchstart', 'wheel'])('%s cancels remaining corrective pans', eventType => {
    controller.expand(target, renderCard)
    jest.advanceTimersByTime(16)
    mapElement.dispatchEvent(new Event(eventType, { bubbles: true }))
    jest.advanceTimersByTime(1200)
    expect(map.panBy).toHaveBeenCalledTimes(1)
    expect(controller.isExpanded(target.id)).toBe(true)
  })

  test('map navigation keys cancel corrections without treating Tab as navigation', () => {
    controller.expand(target, renderCard)
    mapElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    jest.advanceTimersByTime(16)
    expect(map.panBy).toHaveBeenCalledTimes(1)
    mapElement.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }))
    jest.advanceTimersByTime(1200)
    expect(map.panBy).toHaveBeenCalledTimes(1)
  })

  test('dragging immediately also cancels the first animation frame', () => {
    controller.expand(target, renderCard)
    fireMapEvent('dragstart')
    jest.advanceTimersByTime(1200)
    expect(map.panBy).not.toHaveBeenCalled()
    expect(controller.isExpanded(target.id)).toBe(true)
    expect(mapElement.querySelector('.popup-card')).not.toBeNull()
  })

  test.each([16, 1200])('late content cannot take the map back after user input at %d ms', elapsed => {
    controller.expand(target, renderCard)
    jest.advanceTimersByTime(elapsed)
    fireMapEvent('dragstart')
    map.panBy.mockClear()

    controller.expand(target, renderCard)
    jest.advanceTimersByTime(1200)
    expect(map.panBy).not.toHaveBeenCalled()

    controller.expand({ ...target, id: 'second' }, renderCard)
    jest.advanceTimersByTime(16)
    expect(map.panBy).toHaveBeenCalledTimes(1)
    expect(controller.isExpanded('second')).toBe(true)
  })

  test('hiding the popup cancels frames, timers, and interaction listeners', () => {
    controller.expand(target, renderCard)
    controller.hide()
    jest.advanceTimersByTime(1200)
    expect(map.panBy).not.toHaveBeenCalled()
    expect(handlers.dragstart.size).toBe(0)
    expect(mapElement.querySelector('.popup-card')).toBeNull()
    expect(controller.isExpanded(target.id)).toBe(false)
  })

  test('does not pan a map hidden behind the Places panel', () => {
    jest.spyOn(mapElement, 'getBoundingClientRect').mockReturnValue(rect(0, 0))
    controller.expand(target, renderCard)
    jest.advanceTimersByTime(1200)
    expect(map.panBy).not.toHaveBeenCalled()
  })

  test('anchors the mobile sheet outside the transformed map pane without panning', () => {
    const query = { matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }
    window.matchMedia = jest.fn(() => query) as any
    controller.expand(target, renderCard)
    const layer = mapElement.querySelector('.marker-popup-mobile-layer')
    const shell = mapElement.querySelector('.marker-popup-shell')
    expect(layer?.parentElement).toBe(mapElement)
    expect(shell?.parentElement).toBe(layer)
    expect(shell).toHaveClass('marker-popup-shell--mobile')
    expect(popupPane.children).toHaveLength(0)
    jest.advanceTimersByTime(1200)
    expect(map.panBy).not.toHaveBeenCalled()
  })

  test('restores desktop placement and cleans up media listeners and the mobile layer', () => {
    const listeners = new Set<() => void>()
    const query = {
      matches: true,
      addEventListener: jest.fn((_name: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: jest.fn((_name: string, listener: () => void) => listeners.delete(listener)),
    }
    window.matchMedia = jest.fn(() => query) as any
    controller.expand(target, renderCard)
    jest.advanceTimersByTime(1200)
    const shell = mapElement.querySelector('.marker-popup-shell')

    query.matches = false
    listeners.forEach(listener => listener())
    expect(shell?.parentElement).toBe(popupPane)
    expect(shell).not.toHaveClass('marker-popup-shell--mobile')
    expect(mapElement.querySelector('.marker-popup-mobile-layer')).toBeNull()
    jest.advanceTimersByTime(1)
    expect(map.panBy).toHaveBeenCalledTimes(1)

    query.matches = true
    listeners.forEach(listener => listener())
    expect(mapElement.querySelectorAll('.marker-popup-mobile-layer')).toHaveLength(1)
    controller.hide()
    expect(listeners.size).toBe(0)
    expect(mapElement.querySelector('.marker-popup-mobile-layer')).toBeNull()
    expect(mapElement.querySelector('.marker-popup-shell')).toBeNull()
  })
})
