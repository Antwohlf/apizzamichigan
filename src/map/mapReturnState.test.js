import { consumeMapReturnState, mapReturnPath, readMapReturnState, saveMapReturnState } from './mapReturnState'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

describe('map return state', () => {
  test('round-trips the map viewport and shareable search URL', () => {
    const storage = createStorage()
    expect(saveMapReturnState({
      pathname: '/',
      search: '?q=Anthony%27s+Pizza&picks=1',
      center: { lat: 42.28, lng: -83.74 },
      zoom: 12,
    }, storage)).toBe(true)

    const state = readMapReturnState(storage)
    expect(state).toEqual({
      pathname: '/',
      search: '?q=Anthony%27s+Pizza&picks=1',
      center: { lat: 42.28, lng: -83.74 },
      zoom: 12,
    })
    expect(mapReturnPath(state)).toBe('/?q=Anthony%27s+Pizza&picks=1')
  })

  test('consumes valid state once', () => {
    const storage = createStorage()
    saveMapReturnState({ center: { lat: 1, lng: 2 }, zoom: 6 }, storage)
    expect(consumeMapReturnState(storage)).not.toBeNull()
    expect(consumeMapReturnState(storage)).toBeNull()
  })

  test('does not restore a view into a different site route', () => {
    const storage = createStorage()
    saveMapReturnState({ pathname: '/', center: { lat: 1, lng: 2 }, zoom: 6 }, storage)
    expect(consumeMapReturnState(storage, '/tacos')).toBeNull()
    expect(consumeMapReturnState(storage, '/')).toEqual(expect.objectContaining({
      pathname: '/',
      center: { lat: 1, lng: 2 },
      zoom: 6,
    }))
  })

  test('rejects incomplete or malformed state', () => {
    const storage = createStorage()
    storage.setItem('apizza-map-return-state', JSON.stringify({ center: { lat: 1 }, zoom: 6 }))
    expect(readMapReturnState(storage)).toBeNull()
    expect(saveMapReturnState({ center: { lat: 1, lng: 2 }, zoom: '6' }, storage)).toBe(false)
  })

  test('uses the caller-provided route when no return state exists', () => {
    expect(mapReturnPath(null, '/tacos')).toBe('/tacos')
  })
})
