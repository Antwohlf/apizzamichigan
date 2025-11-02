const { IncomingMessage, ServerResponse } = require('http')

function getClientIp(req) {
  if (!req) return 'unknown'
  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = req.headers?.['x-real-ip']
  if (typeof realIp === 'string' && realIp.length) {
    return realIp.trim()
  }
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.connection?.socket?.remoteAddress ||
    'unknown'
  )
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (!(req instanceof IncomingMessage)) {
      resolve('')
      return
    }
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function parseJsonBody(req) {
  if (!req) return null
  if (req.body && typeof req.body === 'object') {
    return req.body
  }
  const raw = await readRequestBody(req)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    error.message = 'Invalid JSON payload'
    throw error
  }
}

function sendJson(res, statusCode, payload) {
  if (!(res instanceof ServerResponse)) {
    throw new Error('Response object required')
  }
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload ?? {}))
}

module.exports = {
  getClientIp,
  parseJsonBody,
  sendJson,
  readRequestBody,
}

