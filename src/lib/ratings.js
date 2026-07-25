export const RATING_SCALE = Object.freeze({
  minimum: 0,
  maximum: 10,
})

export function normalizeRating(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const rating = Number(value)
  return Number.isFinite(rating) && rating >= RATING_SCALE.minimum ? rating : null
}

export function isRatingWithinScale(value) {
  const rating = normalizeRating(value)
  return rating !== null && rating <= RATING_SCALE.maximum
}

export function isLegacyOutOfScaleRating(value) {
  const rating = normalizeRating(value)
  return rating !== null && rating > RATING_SCALE.maximum
}
