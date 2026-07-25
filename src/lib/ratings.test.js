import { isLegacyOutOfScaleRating, isRatingWithinScale, normalizeRating, RATING_SCALE } from './ratings'

test('normalizes numeric and numeric-string ratings while rejecting empty values', () => {
  expect(normalizeRating(8)).toBe(8)
  expect(normalizeRating('9.5')).toBe(9.5)
  expect(normalizeRating(0)).toBe(0)
  expect(normalizeRating('')).toBeNull()
  expect(normalizeRating('not a rating')).toBeNull()
})

test('defines the normal editorial scale without rewriting legacy scores', () => {
  expect(RATING_SCALE).toEqual({ minimum: 0, maximum: 10 })
  expect(isRatingWithinScale(0)).toBe(true)
  expect(isRatingWithinScale(10)).toBe(true)
  expect(isRatingWithinScale(10.1)).toBe(false)
  expect(isLegacyOutOfScaleRating(11)).toBe(true)
  expect(normalizeRating(11)).toBe(11)
})
