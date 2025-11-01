const nodemailer = require('nodemailer')
const { isRateLimited } = require('./rateLimit')

const BUG_REPORT_RECIPIENTS =
  process.env.BUG_REPORT_RECIPIENTS || 'anthonywohlfeil@gmail.com,nickwohlfeil@gmail.com'
const BUG_REPORT_RATE_LIMIT = Number(process.env.BUG_REPORT_RATE_LIMIT || 5)
const BUG_REPORT_RATE_WINDOW_MS = Number(process.env.BUG_REPORT_RATE_WINDOW_MS || 5 * 60 * 1000)

let bugReportTransporter = null

function buildBugReportMapsUrl(selectedPlace = null, fallback = '') {
  if (!selectedPlace) {
    return fallback || ''
  }
  if (selectedPlace.google_place_id) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(selectedPlace.google_place_id)}`
  }
  if (selectedPlace.google_maps_url) {
    return selectedPlace.google_maps_url
  }
  if (fallback) {
    return fallback
  }
  const queryParts = []
  if (selectedPlace.name) {
    queryParts.push(selectedPlace.name)
  }
  if (selectedPlace.address) {
    queryParts.push(selectedPlace.address)
  } else {
    const cityState = [selectedPlace.city, selectedPlace.state].filter(Boolean).join(', ')
    if (cityState) {
      queryParts.push(cityState)
    }
  }
  if (!queryParts.length) {
    return ''
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts.join(' '))}`
}

function getBugReportTransporter() {
  if (bugReportTransporter) {
    return bugReportTransporter
  }
  const host = process.env.BUG_REPORT_SMTP_HOST
  const port = Number(process.env.BUG_REPORT_SMTP_PORT || 587)
  if (!host) {
    console.warn('[bug-report] BUG_REPORT_SMTP_HOST not configured')
    return null
  }
  const secureEnv = process.env.BUG_REPORT_SMTP_SECURE
  const secure = secureEnv ? secureEnv.toLowerCase() === 'true' : port === 465
  const user = process.env.BUG_REPORT_SMTP_USER
  const pass = process.env.BUG_REPORT_SMTP_PASS

  try {
    bugReportTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    })
    return bugReportTransporter
  } catch (error) {
    console.error('[bug-report] Failed to initialize mail transporter', error)
    bugReportTransporter = null
    return null
  }
}

function normalizeReporterEmail(value) {
  if (!value || typeof value !== 'string') return ''
  return value.trim()
}

function normalizeSelectedPlace(value) {
  if (!value || typeof value !== 'object') return null
  return {
    id: value.id ?? null,
    name: value.name ?? null,
    google_place_id: value.google_place_id ?? null,
    google_maps_url: value.google_maps_url ?? null,
    address: value.address ?? null,
    city: value.city ?? null,
    state: value.state ?? null,
  }
}

function parseBugReportPayload(body = {}) {
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const email = normalizeReporterEmail(body.email)
  const url = typeof body.url === 'string' ? body.url : ''
  const userAgent = typeof body.userAgent === 'string' ? body.userAgent : ''
  const viewport = typeof body.viewport === 'string' ? body.viewport : ''
  const timestamp =
    typeof body.timestamp === 'string' && body.timestamp ? body.timestamp : new Date().toISOString()
  const selectedPlace = normalizeSelectedPlace(body.selectedPlace)
  const mapsUrl = typeof body.mapsUrl === 'string' ? body.mapsUrl : ''
  return { description, email, url, userAgent, viewport, timestamp, selectedPlace, mapsUrl }
}

async function handleBugReport({ body, ip }) {
  const clientIp = ip || 'unknown'
  if (isRateLimited(`bug:${clientIp}`, BUG_REPORT_RATE_LIMIT, BUG_REPORT_RATE_WINDOW_MS)) {
    return {
      status: 429,
      body: { ok: false, error: 'Too many bug reports. Please try again in a few minutes.' },
    }
  }

  const { description, email, url, userAgent, viewport, timestamp, selectedPlace, mapsUrl } =
    parseBugReportPayload(body)

  if (!description || description.length < 10) {
    return {
      status: 400,
      body: { ok: false, error: 'Please include a brief description (at least 10 characters).' },
    }
  }

  const transporter = getBugReportTransporter()
  if (!transporter) {
    return {
      status: 500,
      body: { ok: false, error: 'Bug report email service is not configured. Please try again later.' },
    }
  }

  const recipients = BUG_REPORT_RECIPIENTS.split(',').map(item => item.trim()).filter(Boolean)
  if (!recipients.length) {
    console.error('[bug-report] BUG_REPORT_RECIPIENTS is empty')
    return { status: 500, body: { ok: false, error: 'Bug report recipients not configured.' } }
  }

  const mapsLink = mapsUrl || buildBugReportMapsUrl(selectedPlace, mapsUrl)

  const lines = [
    'A new bug report has been submitted:',
    '',
    'Description:',
    description,
    '',
    `Reporter email: ${email || 'Not provided'}`,
    `URL: ${url || 'Unknown'}`,
    `User agent: ${userAgent || 'Unknown'}`,
    `Viewport: ${viewport || 'Unknown'}`,
    `Timestamp: ${timestamp}`,
    `Client IP: ${clientIp}`,
  ]

  if (selectedPlace) {
    lines.push('', 'Selected place context:')
    lines.push(`Name: ${selectedPlace.name || 'Unknown'}`)
    lines.push(`ID: ${selectedPlace.id || 'Unknown'}`)
    lines.push(`Google place ID: ${selectedPlace.google_place_id || 'None provided'}`)
  } else {
    lines.push('', 'Selected place: none')
  }

  if (mapsLink) {
    lines.push(`Google Maps URL: ${mapsLink}`)
  }

  if (selectedPlace) {
    try {
      const serialized = JSON.stringify(selectedPlace, null, 2)
      lines.push('', 'Selected place payload:', serialized)
    } catch (error) {
      console.warn('[bug-report] Unable to serialize selectedPlace payload', error)
    }
  }

  const message = lines.join('\n')
  const subject = `APizzaMichigan Bug: ${description.slice(0, 60)}`
  const fromAddress =
    process.env.BUG_REPORT_FROM_EMAIL ||
    process.env.BUG_REPORT_SMTP_USER ||
    'no-reply@apizzamichigan.com'

  try {
    await transporter.sendMail({
      to: recipients,
      from: fromAddress,
      subject,
      text: message,
    })
    return { status: 200, body: { ok: true } }
  } catch (error) {
    console.error('[bug-report] Failed to send email', error)
    return {
      status: 500,
      body: { ok: false, error: 'Unable to send bug report email. Please try again later.' },
    }
  }
}

module.exports = {
  handleBugReport,
  buildBugReportMapsUrl,
}

