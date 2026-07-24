import { popupVisibilityPanOffset } from './PopupController'

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
