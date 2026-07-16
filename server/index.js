require('dotenv').config()

const express = require('express')
const cookieParser = require('cookie-parser')
const { existsSync, readdirSync, readFileSync, statSync } = require('fs')
const { join, resolve } = require('path')
const pg = require('pg')
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
const FALLBACK_SUPABASE_URL = 'https://htahyiuvqmalfpbgiizx.supabase.co'
const MAX_REVIEW_PHOTOS = 10
const MAX_REVIEW_PHOTO_BYTES = 8 * 1024 * 1024
const SOURCE_REVIEW_DIR = process.env.SOURCE_REVIEW_DIR || 'reports/source-review'
const SOURCE_REVIEW_QUEUE_CSV = process.env.SOURCE_REVIEW_QUEUE_CSV || 'reports/source-review-queue.csv'
let reviewPhotosTableAvailable = true

const ADMIN_PASSWORD = process.env.ADMIN_PORTAL_PASSWORD
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL
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
app.use(express.json({ limit: '12mb' }))
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

const localPostgresConfig = () => ({
  host: process.env.PGHOST || process.env.LOCAL_DB_HOST || 'localhost',
  port: parseInt(process.env.PGPORT || process.env.LOCAL_DB_PORT || '5432', 10),
  database: process.env.PGDATABASE || process.env.LOCAL_DB_NAME || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.LOCAL_DB_USER || process.env.USER,
  password: process.env.PGPASSWORD || process.env.LOCAL_DB_PASSWORD || '',
})

const normalizeCount = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function readSourceReviewReports(entity, inputDir = SOURCE_REVIEW_DIR) {
  const absDir = resolve(process.cwd(), inputDir)
  const result = {
    available: existsSync(absDir),
    inputDir,
    totals: { inputRows: 0, matched: 0, ambiguous: 0, likelyNew: 0, accepted: 0 },
    reports: [],
    errors: [],
  }

  if (!result.available) return result

  for (const file of readdirSync(absDir).filter(name => name.endsWith('-review.json')).sort()) {
    try {
      const report = JSON.parse(readFileSync(join(absDir, file), 'utf8'))
      if (report.entity && report.entity !== entity) continue
      const counts = report.counts || {}
      const row = {
        file,
        source: report.source || '',
        sourceLabel: report.source_label || report.source || '',
        generatedAt: report.generated_at || null,
        inputRows: normalizeCount(counts.inputRowsInspected),
        matched: normalizeCount(counts.matchedExistingPlaces),
        ambiguous: normalizeCount(counts.ambiguousReviewCandidates ?? report.ambiguous?.length),
        likelyNew: normalizeCount(counts.likelyNewUnmatchedCandidates ?? report.likely_new?.length),
        accepted: normalizeCount(counts.acceptedForPlaceSourcesImport),
      }
      result.reports.push(row)
      result.totals.inputRows += row.inputRows
      result.totals.matched += row.matched
      result.totals.ambiguous += row.ambiguous
      result.totals.likelyNew += row.likelyNew
      result.totals.accepted += row.accepted
    } catch (error) {
      result.errors.push({ file, error: error?.message || 'Unable to read report' })
    }
  }

  return result
}

function readSourceReviewQueueCsv(csvPath = SOURCE_REVIEW_QUEUE_CSV) {
  const absPath = resolve(process.cwd(), csvPath)
  if (!existsSync(absPath)) {
    return { available: false, path: csvPath, reviewRows: 0, updatedAt: null }
  }

  const text = readFileSync(absPath, 'utf8').trim()
  const lines = text ? text.split(/\r?\n/) : []
  const stat = statSync(absPath)
  return {
    available: true,
    path: csvPath,
    reviewRows: Math.max(0, lines.length - 1),
    updatedAt: stat.mtime.toISOString(),
  }
}

async function readLocalSourceProvenance(entity) {
  const client = new pg.Client(localPostgresConfig())
  try {
    await client.connect()
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('place_sources', 'source_review_queue')
    `)
    const tables = new Set(tableCheck.rows.map(row => row.table_name))

    if (!tables.has('place_sources')) {
      return {
        available: false,
        reason: 'place_sources table is not present in local Postgres.',
        sourceCounts: [],
        matchMethods: [],
        reviewQueue: { available: tables.has('source_review_queue'), statusCounts: [], sourceCounts: [] },
      }
    }

    const queueQueries = tables.has('source_review_queue')
      ? [
          client.query(`
            SELECT review_kind, status, COUNT(*)::int AS rows
            FROM source_review_queue
            WHERE entity_type = $1
            GROUP BY review_kind, status
            ORDER BY review_kind, status
          `, [entity]),
          client.query(`
            SELECT source, review_kind, status, COUNT(*)::int AS rows
            FROM source_review_queue
            WHERE entity_type = $1
            GROUP BY source, review_kind, status
            ORDER BY source, review_kind, status
          `, [entity]),
        ]
      : [Promise.resolve({ rows: [] }), Promise.resolve({ rows: [] })]

    const [sourceCounts, matchMethods, reviewQueueStatus, reviewQueueSources] = await Promise.all([
      client.query(`
        SELECT
          source,
          COUNT(*)::int AS rows,
          COUNT(DISTINCT place_id)::int AS places,
          MAX(retrieved_at) AS latest_retrieved_at,
          MAX(updated_at) AS latest_updated_at
        FROM place_sources
        WHERE entity_type = $1
        GROUP BY source
        ORDER BY source
      `, [entity]),
      client.query(`
        SELECT
          source,
          COALESCE(match_method, 'unknown') AS match_method,
          COUNT(*)::int AS rows
        FROM place_sources
        WHERE entity_type = $1
        GROUP BY source, COALESCE(match_method, 'unknown')
        ORDER BY source, rows DESC, match_method
      `, [entity]),
      ...queueQueries,
    ])

    return {
      available: true,
      database: localPostgresConfig().database,
      localOnly: true,
      sourceCounts: sourceCounts.rows,
      matchMethods: matchMethods.rows,
      reviewQueue: {
        available: tables.has('source_review_queue'),
        statusCounts: reviewQueueStatus.rows,
        sourceCounts: reviewQueueSources.rows,
      },
    }
  } catch (error) {
    return {
      available: false,
      reason: error?.message || 'Unable to read local source provenance.',
      sourceCounts: [],
      matchMethods: [],
    }
  } finally {
    try {
      await client.end()
    } catch (error) {
      // Connection may never have opened; nothing to clean up.
    }
  }
}

async function withLocalPostgres(work) {
  const client = new pg.Client(localPostgresConfig())
  try {
    await client.connect()
    return await work(client)
  } finally {
    try {
      await client.end()
    } catch (error) {
      // Connection may never have opened; nothing to clean up.
    }
  }
}

async function sourceReviewQueueExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'source_review_queue'
    ) AS exists
  `)
  return Boolean(result.rows[0]?.exists)
}

const safeInteger = (value, fallback, { min = 0, max = 1000 } = {}) => {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

const allowedSourceReviewStatuses = new Set(['pending', 'accepted', 'linked', 'rejected', 'ignored'])
const allowedSourceReviewKinds = new Set(['ambiguous', 'likely_new'])
const SOURCE_REVIEW_ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
}

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

async function insertReviewPhotoRows(placeId, paths) {
  const { count, error: countError } = await serviceClient
    .from(REVIEW_PHOTO_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('place_id', placeId)

  if (countError) {
    if (countError?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      const error = new Error('Review photos table is not available. Create the table to enable uploads.')
      error.status = 503
      throw error
    }
    throw countError
  }

  const baseOrder = typeof count === 'number' ? count : 0
  if (baseOrder + paths.length > MAX_REVIEW_PHOTOS) {
    const error = new Error(`Review photo limit is ${MAX_REVIEW_PHOTOS} per place.`)
    error.status = 400
    throw error
  }

  const inserts = paths.map((path, index) => ({
    place_id: placeId,
    storage_path: path,
    sort_order: baseOrder + index + 1,
  }))

  const { error: insertError } = await serviceClient.from(REVIEW_PHOTO_TABLE).insert(inserts)
  if (insertError) {
    if (insertError?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      const error = new Error('Review photos table is not available. Create the table to enable uploads.')
      error.status = 503
      throw error
    }
    throw insertError
  }
}

function isSafeStoragePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 512 &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    /^[A-Za-z0-9/_-]+\.webp$/.test(path)
  )
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
    const reviewFields = 'id, name, notes, rating, status, style, address, state, price, price_range, google_place_id'

    const { data: reviews, error } = await serviceClient
      .from(table)
      .select(reviewFields)
      .or('notes.not.is.null,rating.not.is.null')
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

    await insertReviewPhotoRows(placeId, paths)

    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] create review photo error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to save review photo.' })
  }
})

app.post('/api/admin/reviews/:id/photos/upload', requireAdminAuth, async (req, res) => {
  const placeId = req.params.id
  const files = Array.isArray(req.body?.files) ? req.body.files : []
  const uploadedPaths = []

  try {
    if (!placeId) {
      return res.status(400).json({ error: 'Missing review identifier.' })
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'No photos provided.' })
    }
    if (!reviewPhotosTableAvailable) {
      return res.status(503).json({ error: 'Review photos table is not configured yet.' })
    }

    const storage = getStorageClient()
    for (const file of files) {
      const storagePath = file?.path
      const encoded = file?.dataBase64
      const mimeType = file?.mimeType || 'image/webp'
      if (!isSafeStoragePath(storagePath)) {
        return res.status(400).json({ error: 'Invalid photo storage path.' })
      }
      if (mimeType !== 'image/webp') {
        return res.status(400).json({ error: 'Review photos must be uploaded as WebP.' })
      }
      if (typeof encoded !== 'string' || encoded.length === 0) {
        return res.status(400).json({ error: 'Photo data is missing.' })
      }

      const buffer = Buffer.from(encoded, 'base64')
      if (buffer.length === 0 || buffer.length > MAX_REVIEW_PHOTO_BYTES) {
        return res.status(413).json({ error: 'Photo is too large after processing.' })
      }

      const { error: uploadError } = await storage.upload(storagePath, buffer, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
      })
      if (uploadError) {
        throw uploadError
      }
      uploadedPaths.push(storagePath)
    }

    await insertReviewPhotoRows(placeId, uploadedPaths)
    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await getStorageClient().remove(uploadedPaths)
      } catch (cleanupError) {
        console.warn('[admin] failed to clean up uploaded review photos', cleanupError)
      }
    }
    console.error('[admin] upload review photo error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to upload review photo.' })
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

app.get('/api/admin/source-provenance', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'

  try {
    const [database, reviewArtifacts, reviewQueueCsv] = await Promise.all([
      readLocalSourceProvenance(entity),
      Promise.resolve(readSourceReviewReports(entity)),
      Promise.resolve(readSourceReviewQueueCsv()),
    ])

    return res.json({
      data: {
        entity,
        generatedAt: new Date().toISOString(),
        localOnly: true,
        syncPolicy: 'Source evidence stays local until a public/admin provenance feature requires a Supabase table.',
        database,
        reviewArtifacts,
        reviewQueueCsv,
      },
    })
  } catch (error) {
    console.error('[admin] source provenance error', error)
    return res.status(500).json({ error: 'Failed to load source provenance.' })
  }
})

app.get('/api/admin/source-review-queue', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
  const status = (req.query?.status || 'pending').toString()
  const kind = (req.query?.kind || '').toString()
  const source = (req.query?.source || '').toString().trim().slice(0, 80)
  const reportFile = (req.query?.reportFile || '').toString().trim().slice(0, 160)
  const search = (req.query?.search || '').toString().trim().slice(0, 120)
  const limit = safeInteger(req.query?.limit, 50, { min: 1, max: 100 })
  const offset = safeInteger(req.query?.offset, 0, { min: 0, max: 1000000 })

  if (!allowedSourceReviewStatuses.has(status)) {
    return res.status(400).json({ error: 'Invalid source review status.' })
  }
  if (kind && !allowedSourceReviewKinds.has(kind)) {
    return res.status(400).json({ error: 'Invalid source review kind.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        return { available: false, data: [], total: 0 }
      }

      const filters = ['entity_type = $1', 'status = $2']
      const values = [entity, status]
      if (kind) {
        values.push(kind)
        filters.push(`review_kind = $${values.length}`)
      }
      if (source) {
        values.push(source)
        filters.push(`source = $${values.length}`)
      }
      if (reportFile) {
        values.push(reportFile)
        filters.push(`report_file = $${values.length}`)
      }
      if (search) {
        values.push(`%${search.toLowerCase()}%`)
        filters.push(`(
          lower(COALESCE(source_name, '')) LIKE $${values.length}
          OR lower(COALESCE(source_id, '')) LIKE $${values.length}
          OR lower(COALESCE(source_url, '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'address', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'addr:full', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'website', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'phone', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'locality', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'region', '')) LIKE $${values.length}
          OR lower(COALESCE(nearest_place_name, '')) LIKE $${values.length}
          OR lower(COALESCE(nearest_google_place_id, '')) LIKE $${values.length}
          OR lower(COALESCE(review_reason, '')) LIKE $${values.length}
          OR lower(COALESCE(report_file, '')) LIKE $${values.length}
        )`)
      }
      const where = filters.join(' AND ')
      const countResult = await client.query(`SELECT COUNT(*)::int AS total FROM source_review_queue WHERE ${where}`, values)
      const total = countResult.rows[0]?.total || 0
      values.push(limit, offset)
      const rows = await client.query(`
        SELECT
          id,
          entity_type,
          review_kind,
          source,
          source_id,
          source_name,
          source_url,
          source_data,
          nearest_place_id,
          nearest_google_place_id,
          nearest_place_name,
          nearest_distance_m,
          nearest_name_score,
          review_reason,
          status,
          decision,
          canonical_place_id,
          reviewer_notes,
          reviewed_at,
          reviewed_by,
          report_file,
          report_generated_at,
          imported_at,
          updated_at
        FROM source_review_queue
        WHERE ${where}
        ORDER BY
          CASE review_kind WHEN 'ambiguous' THEN 0 ELSE 1 END,
          nearest_distance_m NULLS LAST,
          source_name NULLS LAST,
          id
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `, values)

      return { available: true, data: rows.rows, total }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review queue fetch error', error)
    return res.status(500).json({ error: 'Failed to load source review queue.' })
  }
})

app.patch('/api/admin/source-review-queue/:id', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const status = (req.body?.status || '').toString()
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null
  const canonicalPlaceId = req.body?.canonicalPlaceId == null || req.body?.canonicalPlaceId === ''
    ? null
    : safeInteger(req.body.canonicalPlaceId, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })

  if (!id) {
    return res.status(400).json({ error: 'Invalid source review queue id.' })
  }
  if (!allowedSourceReviewStatuses.has(status) || status === 'pending') {
    return res.status(400).json({ error: 'Invalid source review decision status.' })
  }
  if (status === 'linked' && !canonicalPlaceId) {
    return res.status(400).json({ error: 'Link decisions require a canonical place id.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      const current = await client.query(`
        SELECT id, entity_type, review_kind, source_name, source_id
        FROM source_review_queue
        WHERE id = $1
      `, [id])

      const row = current.rows[0]
      if (!row) {
        const error = new Error('Source review queue row not found.')
        error.status = 404
        throw error
      }

      if (status === 'accepted' && row.review_kind !== 'likely_new') {
        const error = new Error('Accept new is only valid for likely-new source rows. Link, reject, or ignore ambiguous rows.')
        error.status = 400
        throw error
      }

      if (status === 'linked') {
        const tableName = SOURCE_REVIEW_ENTITY_TABLES[row.entity_type]
        if (!tableName) {
          const error = new Error('Unsupported source review entity type.')
          error.status = 400
          throw error
        }
        const canonical = await client.query(`SELECT id FROM ${tableName} WHERE id = $1 LIMIT 1`, [canonicalPlaceId])
        if (!canonical.rows[0]) {
          const error = new Error(`Canonical ${row.entity_type} place id ${canonicalPlaceId} was not found.`)
          error.status = 400
          throw error
        }
      }

      const result = await client.query(`
        UPDATE source_review_queue
        SET
          status = $2,
          decision = $2,
          canonical_place_id = $3,
          reviewer_notes = $4,
          reviewed_at = NOW(),
          reviewed_by = 'admin',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, status, canonicalPlaceId, reviewerNotes])

      return { data: result.rows[0] }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review queue update error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to update source review row.' })
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
