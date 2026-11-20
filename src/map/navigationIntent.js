// Loading a region must never override a newer gesture, search, or selection.
// movestart alone is insufficient: it also fires for our own fly-to animation.
const activeIntents = new WeakMap()
export const MAP_NAVIGATION_EVENT = 'apizza:navigation-intent'

export function beginMapNavigation(map) {
  activeIntents.get(map)?.cancel()
  map.fire?.(MAP_NAVIGATION_EVENT)
  let cancelled = false
  const element = map.getContainer?.()
  const inputEvents = ['pointerdown', 'touchstart', 'mousedown', 'wheel', 'keydown']
  const cancel = () => {
    cancelled = true
    dispose()
  }
  const onInput = event => {
    if (event.type === 'keydown' && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '=', '_'].includes(event.key)) return
    cancel()
  }
  const dispose = () => {
    inputEvents.forEach(type => element?.removeEventListener(type, onInput, true))
    map.off?.('dragstart', cancel)
    map.off?.('unload', cancel)
    map.off?.(MAP_NAVIGATION_EVENT, cancel)
    if (activeIntents.get(map) === intent) activeIntents.delete(map)
  }
  const intent = { cancel, dispose, isCurrent: () => !cancelled && activeIntents.get(map) === intent }
  activeIntents.set(map, intent)
  inputEvents.forEach(type => element?.addEventListener(type, onInput, { capture: true, passive: true }))
  map.on?.('dragstart', cancel)
  map.on?.('unload', cancel)
  map.on?.(MAP_NAVIGATION_EVENT, cancel)
  return intent
}

export const signalMapNavigation = map => map?.fire?.(MAP_NAVIGATION_EVENT)
