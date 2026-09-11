const express = require('express')
const { existsSync } = require('node:fs')
const { isAbsolute, join, resolve } = require('node:path')

function createPrivateHost({ api, webRoot, origin, release = 'unknown' }) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    throw new Error('ADMIN_PUBLIC_ORIGIN must be an HTTPS origin without a path.')
  }
  if (!isAbsolute(webRoot) || !existsSync(join(webRoot, 'index.html'))) {
    throw new Error('The private admin host requires a built website directory.')
  }
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')
  api.disable('x-powered-by')
  api.set('trust proxy', 'loopback')
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'same-origin')
    // The HTTPS proxy and direct loopback health checks are the only entrypoints.
    if (req.hostname !== url.hostname && req.hostname !== '127.0.0.1' && req.hostname !== 'localhost') {
      return res.status(421).json({ error: 'Unexpected host' })
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) {
      return res.status(403).json({ error: 'Same-origin request required' })
    }
    return next()
  })
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', release }))
  app.use(api)
  // Never let the SPA hide an unknown API endpoint or return a secret/config file.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
  app.use(express.static(webRoot, { dotfiles: 'deny', index: false }))
  app.get(['/admin/reviews', '/admin/reviews/*', '/', '/tacos', '/tacos/places/:id', '/places/:id'], (_req, res) => {
    res.sendFile(join(webRoot, 'index.html'))
  })
  app.use((_req, res) => res.status(404).send('Not found'))
  return app
}

if (require.main === module) {
  require('dotenv').config()
  for (const key of ['ADMIN_PORTAL_PASSWORD', 'ADMIN_SESSION_SECRET', 'ADMIN_PUBLIC_ORIGIN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    if (!process.env[key]) throw new Error(`Missing private admin setting: ${key}`)
  }
  if (process.env.NODE_ENV !== 'production') throw new Error('The private admin host requires NODE_ENV=production.')
  const app = createPrivateHost({
    api: require('./index.js'),
    webRoot: process.env.ADMIN_WEB_ROOT || resolve(__dirname, '../build'),
    origin: process.env.ADMIN_PUBLIC_ORIGIN,
    release: process.env.APP_RELEASE || 'unknown',
  })
  const server = app.listen(Number(process.env.PORT || 5050), '127.0.0.1', () => {
    console.log('Private admin host ready on loopback.')
  })
  const stop = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

module.exports = { createPrivateHost }
