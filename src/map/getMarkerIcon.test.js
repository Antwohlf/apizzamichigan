import { getMarkerIcon } from './getMarkerIcon'

describe('getMarkerIcon', () => {
  test('marks historical places without changing their status icon', () => {
    const icon = getMarkerIcon('pizza', 'visited', 'replaced')

    expect(icon.options.iconUrl).toBeTruthy()
    expect(icon.options.className).toContain('pizza-marker')
    expect(icon.options.className).toContain('place-marker--historical')
  })

  test('keeps current places free of the historical marker state', () => {
    const icon = getMarkerIcon('taco', 'golden', null)

    expect(icon.options.className).toContain('taco-marker--golden')
    expect(icon.options.className).not.toContain('place-marker--historical')
  })
})
