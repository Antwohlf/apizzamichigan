require('dotenv').config()

const express = require('express')
const cookieParser = require('cookie-parser')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const PORT = process.env.PORT || 5000
const COOKIE_NAME = 'admin_auth'

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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Admin server listening on port ${PORT}`)
  })
}

module.exports = app
