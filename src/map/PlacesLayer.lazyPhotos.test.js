import fs from 'node:fs'

const appSource = fs.readFileSync('src/App.js', 'utf8')
const layerSource = fs.readFileSync('src/map/PlacesLayer.js', 'utf8')

test('does not fetch every region photo before a popup is opened', () => {
  expect(appSource).toContain('Review photos are')
  expect(appSource).toContain('loaded lazily')
  expect(appSource).toContain('normalizePlaceData(stateData, {}, defaultPlaceType)')
})

test('loads popup photos through a single-place query', () => {
  expect(layerSource).toContain(".from('review-photos')")
  expect(layerSource).toContain(".eq('place_id', placeId)")
  expect(layerSource).toContain('popupPhotos[placeId]')
})
