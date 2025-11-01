const { handleBugReport } = require('./_lib/bugReport')
const { getClientIp, parseJsonBody, sendJson } = require('./_lib/request')

module.exports = async function bugReportHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  let body = null
  try {
    body = await parseJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Invalid JSON payload' })
    return
  }

  const result = await handleBugReport({
    body,
    ip: getClientIp(req),
  })

  sendJson(res, result.status, result.body)
}

