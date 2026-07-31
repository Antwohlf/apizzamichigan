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

  test('treats a missing status as unvisited rather than reviewed', () => {
    const missingStatus = getMarkerIcon('pizza')
    const explicitUnvisited = getMarkerIcon('pizza', 'unvisited')

    expect(missingStatus.options.iconUrl).toBe(explicitUnvisited.options.iconUrl)
  })

})
