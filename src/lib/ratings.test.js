import { normalizeRating } from './ratings'

test('normalizes numeric and numeric-string ratings while rejecting empty values', () => {
  expect(normalizeRating(8)).toBe(8)
  expect(normalizeRating('9.5')).toBe(9.5)
  expect(normalizeRating(0)).toBeNull()
  expect(normalizeRating('')).toBeNull()
  expect(normalizeRating('not a rating')).toBeNull()
})
