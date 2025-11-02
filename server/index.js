require('dotenv').config()

const express = require('express')
const cookieParser = require('cookie-parser')
const { createClient } = require('@supabase/supabase-js')
const { handleBugReport } = require('../api/_lib/bugReport')
const { handleAutocomplete, handlePlaceDetails } = require('../api/_lib/places')
const { getClientIp } = require('../api/_lib/request')

const app = express()
// Note: 5000 is commonly hijacked by AirPlay Receiver on macOS.
// Use 5050 by default to avoid the AirTunes 403 you observed.
const PORT = process.env.PORT || 5050
const COOKIE_NAME = 'admin_auth'
const REVIEW_PHOTO_BUCKET = 'review-photos'
const SUGGESTED_PLACES_TABLE = 'suggested_places'
const LOCATIONS_TABLE = 'locations'
const REVIEW_PHOTO_TABLE = 'review-photos'
let reviewPhotosTableAvailable = true

const ADMIN_PASSWORD = process.env.ADMIN_PORTAL_PASSWORD
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let serviceClient = null
if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
} else {
  console.warn('[admin] Supabase service client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
}

app.use(cookieParser())
app.use(express.json())
app.set('trust proxy', true)

function requireAdminAuth(req, res, next) {
  if (!req.cookies?.[COOKIE_NAME]) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!serviceClient) {
    return res.status(500).json({ error: 'Supabase service role not configured' })
  }
  return next()
}

const getPlaceTable = (entity = 'pizza') =>
  entity === 'taco' ? 'taco_places' : 'pizza_places'

const getStorageClient = () => {
  if (!serviceClient?.storage) {
    throw new Error('Supabase storage client unavailable')
  }
  return serviceClient.storage.from(REVIEW_PHOTO_BUCKET)
}

async function fetchPhotosForPlace(placeId) {
  if (!reviewPhotosTableAvailable) {
    return []
  }

  try {
    const storage = getStorageClient()
    const { data, error } = await serviceClient
      .from(REVIEW_PHOTO_TABLE)
      .select('id, place_id, storage_path, sort_order')
      .eq('place_id', placeId)
      .order('sort_order', { ascending: true })

    if (error) {
      throw error
    }

    return (data || []).map(photo => {
      const { data: publicData, error: publicError } = storage.getPublicUrl(photo.storage_path)
      if (publicError) {
        console.warn('[admin] Unable to resolve public URL for photo', photo.id, publicError)
      }
      return {
        id: photo.id,
        path: photo.storage_path,
        sortOrder: photo.sort_order,
        publicUrl: publicData?.publicUrl ?? null,
      }
    })
  } catch (error) {
    if (error?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      return []
    }
    throw error
  }
}

app.post('/api/bug-report', async (req, res) => {
  const result = await handleBugReport({
    body: req.body,
    ip: getClientIp(req),
  })
  return res.status(result.status).json(result.body)
})

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' })
  }

  const { password } = req.body || {}
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  res.cookie(COOKIE_NAME, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
  })
  return res.json({ authorized: true })
})

app.get('/api/admin/check', (req, res) => {
  const authorized = Boolean(req.cookies?.[COOKIE_NAME])
  if (!authorized) return res.status(401).json({ authorized: false })
  return res.json({ authorized: true })
})

app.post('/api/admin/submitPlace', async (req, res) => {
  if (!req.cookies?.[COOKIE_NAME]) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!serviceClient) {
    return res.status(500).json({ error: 'Supabase service role not configured' })
  }

  const {
    entity,
    name,
    address,
    city,
    url,
    style,
    rating,
    notes,
    lat,
    lng,
  } = req.body || {}

  if (!['pizza', 'taco'].includes(entity)) {
    return res.status(400).json({ error: 'Entity must be pizza or taco' })
  }
  if (!name || !address || typeof lat !== 'number' || typeof lng !== 'number' || !style) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const row = {
    name,
    address,
    city: city || null,
    url: url || null,
    notes: notes || null,
    rating: typeof rating === 'number' ? rating : null,
    lat,
    lng,
  }

  if (entity === 'pizza') {
    row.style = style
  } else {
    row.type = style
  }

  const table = entity === 'pizza' ? 'pizza_places' : 'taco_places'

  try {
    const { data, error } = await serviceClient.from(table).insert(row).select('*').single()
    if (error) throw error
    return res.json({ data })
  } catch (error) {
    console.error('[admin] submit error', error)
    return res.status(500).json({ error: 'Failed to submit place' })
  }
})

app.get('/api/admin/reviews', requireAdminAuth, async (req, res) => {
  try {
    const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
    const table = getPlaceTable(entity)

    const { data: reviews, error } = await serviceClient
      .from(table)
      .select('id, name, review, notes, rating, status, style, type')
      .order('name', { ascending: true })

    if (error) {
      throw error
    }

    const placeIds = (reviews || []).map(row => row.id).filter(Boolean)
    let photosByPlace = {}

    if (placeIds.length > 0 && reviewPhotosTableAvailable) {
      const storage = getStorageClient()
      const { data: photoRows, error: photosError } = await serviceClient
        .from(REVIEW_PHOTO_TABLE)
        .select('id, place_id, storage_path, sort_order')
        .in('place_id', placeIds)
        .order('sort_order', { ascending: true })

      if (photosError) {
        if (photosError?.code === 'PGRST205') {
          reviewPhotosTableAvailable = false
        } else {
          throw photosError
        }
      } else if (Array.isArray(photoRows)) {
        photosByPlace = photoRows.reduce((acc, photo) => {
          const { data: publicData, error: publicError } = storage.getPublicUrl(photo.storage_path)
          if (publicError) {
            console.warn('[admin] Unable to resolve public URL for photo', photo.id, publicError)
          }
          const mapped = {
            id: photo.id,
            path: photo.storage_path,
            sortOrder: photo.sort_order,
            publicUrl: publicData?.publicUrl ?? null,
          }
          if (!acc[photo.place_id]) {
            acc[photo.place_id] = [mapped]
          } else {
            acc[photo.place_id].push(mapped)
          }
          return acc
        }, {})
      }
    }

    const payload = (reviews || []).map(review => ({
      ...review,
      photos: photosByPlace[review.id] || [],
    }))

    return res.json({ data: payload })
  } catch (error) {
    console.error('[admin] reviews fetch error', error)
    return res.status(500).json({ error: 'Failed to load reviews.' })
  }
})

app.post('/api/admin/reviews/:id/photos', requireAdminAuth, async (req, res) => {
  try {
    const placeId = req.params.id
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter(Boolean) : []
    if (!placeId) {
      return res.status(400).json({ error: 'Missing review identifier.' })
    }
    if (paths.length === 0) {
      return res.status(400).json({ error: 'No photo paths provided.' })
    }
    if (!reviewPhotosTableAvailable) {
      return res.status(503).json({ error: 'Review photos table is not configured yet.' })
    }

    const { count, error: countError } = await serviceClient
      .from(REVIEW_PHOTO_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('place_id', placeId)

    if (countError) {
      if (countError?.code === 'PGRST205') {
        reviewPhotosTableAvailable = false
        return res.status(503).json({ error: 'Review photos table is not available. Create the table to enable uploads.' })
      }
      throw countError
    }

    const baseOrder = typeof count === 'number' ? count : 0
    const inserts = paths.map((path, index) => ({
      place_id: placeId,
      storage_path: path,
      sort_order: baseOrder + index + 1,
    }))

    const { error: insertError } = await serviceClient.from(REVIEW_PHOTO_TABLE).insert(inserts)
    if (insertError) {
      if (insertError?.code === 'PGRST205') {
        reviewPhotosTableAvailable = false
        return res.status(503).json({ error: 'Review photos table is not available. Create the table to enable uploads.' })
      }
      throw insertError
    }

    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] create review photo error', error)
    return res.status(500).json({ error: 'Failed to save review photo.' })
  }
})

app.patch('/api/admin/reviews/:id/photos/reorder', requireAdminAuth, async (req, res) => {
  try {
    const placeId = req.params.id
    const order = Array.isArray(req.body?.order) ? req.body.order : []
    if (!placeId) {
      return res.status(400).json({ error: 'Missing review identifier.' })
    }
    if (order.length === 0) {
      return res.status(400).json({ error: 'Photo order payload is empty.' })
    }
    if (!reviewPhotosTableAvailable) {
      return res.status(503).json({ error: 'Review photos table is not configured yet.' })
    }

    const updates = order.map((photoId, index) =>
      serviceClient
        .from(REVIEW_PHOTO_TABLE)
        .update({ sort_order: index + 1 })
        .eq('id', photoId)
        .eq('place_id', placeId)
    )

    const results = await Promise.all(updates)
    const failed = results.find(result => result?.error)
    if (failed?.error) {
      if (failed.error?.code === 'PGRST205') {
        reviewPhotosTableAvailable = false
        return res.status(503).json({ error: 'Review photos table is not available. Create the table to enable uploads.' })
      }
      throw failed.error
    }

    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] reorder review photos error', error)
    return res.status(500).json({ error: 'Failed to update photo order.' })
  }
})

app.delete('/api/admin/review-photos/:photoId', requireAdminAuth, async (req, res) => {
  const photoId = req.params.photoId
  if (!photoId) {
    return res.status(400).json({ error: 'Photo id required' })
  }
  if (!reviewPhotosTableAvailable) {
    return res.status(503).json({ error: 'Review photos table is not configured yet.' })
  }

  try {
    const { data: photo, error } = await serviceClient
      .from(REVIEW_PHOTO_TABLE)
      .select('id, place_id, storage_path')
      .eq('id', photoId)
      .single()

    if (error) {
      const notFound =
        error?.code === 'PGRST116' ||
        error?.message?.toLowerCase().includes('no rows') ||
        error?.message?.toLowerCase().includes('not found')
      if (error?.code === 'PGRST205') {
        reviewPhotosTableAvailable = false
        return res.status(503).json({ error: 'Review photos table is not available. Create the table to enable uploads.' })
      }
      if (notFound) {
        return res.status(404).json({ error: 'Photo not found' })
      }
      throw error
    }

    const storage = getStorageClient()
    const { error: storageError } = await storage.remove([photo.storage_path])
    if (storageError && storageError?.message !== 'not found') {
      console.warn('[admin] failed to remove storage object', photo.storage_path, storageError)
    }

    const { error: deleteError } = await serviceClient.from(REVIEW_PHOTO_TABLE).delete().eq('id', photoId)
    if (deleteError) {
      throw deleteError
    }

    const photos = await fetchPhotosForPlace(photo.place_id)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] delete review photo error', error)
    return res.status(500).json({ error: 'Failed to delete review photo.' })
  }
})

app.get('/api/admin/suggestions', requireAdminAuth, async (req, res) => {
  try {
    const statusParam = (req.query?.status || 'pending').toString()
    const statusFilters = statusParam
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)

    const entityParam = (req.query?.entity || '').toString().trim()

    let query = serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .select('*')
      .order('created_at', { ascending: false })

    if (statusFilters.length > 0) {
      query = query.in('status', statusFilters)
    }
    if (entityParam) {
      query = query.eq('entity', entityParam)
    }

    const { data, error } = await query
    if (error) {
      if (error.code === 'PGRST205') {
        // Unified suggestions table not present; return empty to avoid 500s.
        return res.json({ data: [] })
      }
      throw error
    }

    return res.json({ data })
  } catch (error) {
    console.error('[admin] suggestions fetch error', error)
    return res.status(500).json({ error: 'Failed to load suggestions.' })
  }
})

app.post('/api/admin/suggestions/:id/approve', requireAdminAuth, async (req, res) => {
  const suggestionId = req.params.id
  if (!suggestionId) {
    return res.status(400).json({ error: 'Suggestion id required' })
  }

  try {
    const { data: suggestion, error } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .select('*')
      .eq('id', suggestionId)
      .single()

    if (error) {
      if (error?.code === 'PGRST116') {
        return res.status(404).json({ error: 'Suggestion not found' })
      }
      throw error
    }

    if (suggestion.status === 'approved') {
      return res.status(400).json({ error: 'Suggestion already approved' })
    }

    const locationPayload = {
      entity: suggestion.entity,
      name: suggestion.name,
      formatted_address: suggestion.formatted_address || suggestion.location_text || null,
      lat: suggestion.lat,
      lng: suggestion.lng,
      google_place_id: suggestion.google_place_id,
      source: 'user-suggestion',
      status: 'pending',
      recommendation: suggestion.recommendation || null,
    }

    const { data: location, error: insertError } = await serviceClient
      .from(LOCATIONS_TABLE)
      .insert(locationPayload)
      .select('*')
      .single()

    if (insertError) {
      throw insertError
    }

    const { data: updatedSuggestion, error: updateError } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        location_id: location?.id ?? null,
      })
      .eq('id', suggestionId)
      .select('*')
      .single()

    if (updateError) {
      throw updateError
    }

    return res.json({ data: updatedSuggestion, location })
  } catch (error) {
    console.error('[admin] approve suggestion error', error)
    return res.status(500).json({ error: 'Failed to approve suggestion.' })
  }
})

app.post('/api/admin/suggestions/:id/reject', requireAdminAuth, async (req, res) => {
  const suggestionId = req.params.id
  if (!suggestionId) {
    return res.status(400).json({ error: 'Suggestion id required' })
  }

  const reason =
    req.body && typeof req.body.reason === 'string'
      ? req.body.reason.trim().slice(0, 500)
      : null

  try {
    const { data: suggestion, error } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .select('id, status')
      .eq('id', suggestionId)
      .single()

    if (error) {
      if (error?.code === 'PGRST116') {
        return res.status(404).json({ error: 'Suggestion not found' })
      }
      throw error
    }

    if (suggestion.status === 'rejected') {
      return res.status(400).json({ error: 'Suggestion already rejected' })
    }

    const { data: updatedSuggestion, error: updateError } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .update({
        status: 'rejected',
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
      })
      .eq('id', suggestionId)
      .select('*')
      .single()

    if (updateError) {
      throw updateError
    }

    return res.json({ data: updatedSuggestion })
  } catch (error) {
    console.error('[admin] reject suggestion error', error)
    return res.status(500).json({ error: 'Failed to reject suggestion.' })
  }
})

app.get('/api/places/autocomplete', async (req, res) => {
  const result = await handleAutocomplete({
    input: (req.query?.input || '').toString(),
    sessionToken: (req.query?.sessiontoken || '').toString(),
    ip: getClientIp(req),
  })
  return res.status(result.status).json(result.body)
})

app.get('/api/places/details', async (req, res) => {
  const result = await handlePlaceDetails({
    placeId: (req.query?.place_id || '').toString(),
    sessionToken: (req.query?.sessiontoken || '').toString(),
    ip: getClientIp(req),
  })
  return res.status(result.status).json(result.body)
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Admin server listening on port ${PORT}`)
  })
}

module.exports = app
