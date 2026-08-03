export const placePrice = place => place?.price_range || place?.priceRange || place?.price || ''

export const placeRating = place => {
  const rawRating = place?.rating
  if (rawRating === null || rawRating === undefined || String(rawRating).trim() === '') return null
  const rating = Number(rawRating)
  // A zero in imported/public data means "not reviewed", not a score.
  return Number.isFinite(rating) && rating > 0 ? rating : null
}

export const placeLocation = place => {
  const parts = [place?.address, place?.city, place?.state].filter(Boolean)
  return [...new Set(parts)].join(' · ')
}
