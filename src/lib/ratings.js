export function normalizeRating(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const rating = Number(value)
  return Number.isFinite(rating) && rating > 0 ? rating : null
}
