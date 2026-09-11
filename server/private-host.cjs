const express = require('express')
const { existsSync, lstatSync, readFileSync } = require('node:fs')
const { isAbsolute, join, resolve } = require('node:path')
const { isIP } = require('node:net')
const { createServer } = require('node:https')
const { X509Certificate, createPrivateKey } = require('node:crypto')

function privateTlsSettings(env) {
  const keys = ['ADMIN_TLS_HOST', 'ADMIN_TLS_PORT', 'ADMIN_TLS_CERT', 'ADMIN_TLS_KEY']
  if (!keys.some(key => env[key])) return null
  if (!keys.every(key => env[key])) throw new Error('Private TLS settings must be supplied together.')
  const host = env.ADMIN_TLS_HOST
  const octets = host.split('.').map(Number)
  if (isIP(host) !== 4 || octets[0] !== 100 || octets[1] < 64 || octets[1] > 127) {
    throw new Error('Private TLS must bind a Tailscale IPv4 address, never a public or wildcard interface.')
  }
  const port = Number(env.ADMIN_TLS_PORT)
  const origin = new URL(env.ADMIN_PUBLIC_ORIGIN)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || String(port) !== origin.port) {
    throw new Error('Private TLS port must match ADMIN_PUBLIC_ORIGIN and be unprivileged.')
  }
  const read = (file, privateKey = false) => {
    if (!isAbsolute(file)) throw new Error('TLS files must have absolute paths.')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768 || (privateKey && (stat.mode & 0o077))) {
      throw new Error('TLS files must be bounded regular files with a private key readable only by its owner.')
    }
    return readFileSync(file)
  }
  const options = { cert: read(env.ADMIN_TLS_CERT), key: read(env.ADMIN_TLS_KEY, true), minVersion: 'TLSv1.2' }
  const certificate = new X509Certificate(options.cert)
  if (!certificate.checkHost(origin.hostname) || !certificate.checkPrivateKey(createPrivateKey(options.key))
      || Date.parse(certificate.validTo) <= Date.now() || Date.parse(certificate.validFrom) > Date.now()) {
    throw new Error('TLS certificate must be current, match the private hostname, and match its key.')
  }
  return { host, port, options }
}

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
  const tls = privateTlsSettings(process.env)
  const server = app.listen(Number(process.env.PORT || 5050), '127.0.0.1', () => {
    console.log('Private admin host ready on loopback.')
  })
  const listeners = [server]
  if (tls) {
    const httpsServer = createServer(tls.options, app)
    listeners.push(httpsServer)
    httpsServer.listen(tls.port, tls.host, () => console.log('Private admin HTTPS ready on the tailnet interface.'))
    // The host certificate-renewal job owns issuance. Reload valid renewed files
    // without restarting the API; a failed refresh never replaces the last key.
    setInterval(() => {
      try { httpsServer.setSecureContext(privateTlsSettings(process.env).options) }
      catch { console.error('Private HTTPS certificate refresh failed; retaining the last valid certificate.') }
    }, 60000).unref()
  }
  const stop = () => {
    Promise.all(listeners.map(listener => new Promise(resolve => listener.close(resolve)))).then(() => process.exit(0))
    setTimeout(() => process.exit(1), 10000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

module.exports = { createPrivateHost, privateTlsSettings }
