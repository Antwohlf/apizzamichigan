'use strict'

const PLACE_ENTITIES = new Set(['pizza', 'taco'])
const ALL_ENTITIES = new Set([...PLACE_ENTITIES, 'frozen'])

const text = (value, maxLength = 4000) => {
  if (value == null) return ''
  return String(value).trim().slice(0, maxLength)
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function normalizeAdminPlaceSubmission(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid submission payload')
  const entity = text(body.entity, 20).toLowerCase()
  if (!ALL_ENTITIES.has(entity)) throw badRequest('Entity must be pizza, taco, or frozen')

  if (entity === 'frozen') {
    const brand = text(body.brand ?? body.Brand, 200)
    const product = text(body.product ?? body.Type, 200)
    if (!brand || !product) throw badRequest('Brand and product name are required')
    return {
      entity,
      table: 'frozen_pizzas',
      row: {
        Brand: brand,
        Type: product,
        Price: text(body.price ?? body.Price, 8) || '$',
        Rating: Number.isFinite(body.rating ?? body.Rating) ? Number(body.rating ?? body.Rating) : null,
        Notes: text(body.notes ?? body.Notes) || null,
      },
    }
  }

  const name = text(body.name, 300)
  const address = text(body.address, 500)
  const style = text(body.style, 200)
  const lat = body.lat
  const lng = body.lng
  if (!name || !address || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180 || !style) {
    throw badRequest('Missing required fields')
  }

  const row = {
    name,
    address,
    state: text(body.state, 20) || null,
    website_url: text(body.website_url ?? body.url, 2000) || null,
    google_place_id: text(body.google_place_id, 300) || null,
    price: text(body.price, 8) || null,
    status: text(body.status, 30) || 'unvisited',
    notes: [text(body.review), text(body.notes)].filter(Boolean).join('\n\n') || null,
    rating: Number.isFinite(body.rating) ? Number(body.rating) : null,
    lat,
    lng,
    style,
  }

  return { entity, table: null, row }
}

function normalizePreparedPhoto(photo) {
  if (photo == null) return null
  if (typeof photo !== 'object' || Array.isArray(photo)) throw badRequest('Invalid photo payload')
  const path = text(photo.path, 512)
  const dataBase64 = text(photo.dataBase64, 12 * 1024 * 1024)
  const mimeType = text(photo.mimeType, 100) || 'image/webp'
  if (!path || !dataBase64) throw badRequest('Photo data is missing')
  if (mimeType !== 'image/webp') throw badRequest('Review photos must be uploaded as WebP')
  return { path, dataBase64, mimeType }
}

module.exports = {
  normalizeAdminPlaceSubmission,
  normalizePreparedPhoto,
}
