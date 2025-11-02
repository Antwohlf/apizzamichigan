const { handleAutocomplete } = require('../_lib/places')
const { getClientIp, sendJson } = require('../_lib/request')

module.exports = async function autocompleteHandler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const input = (req.query?.input || '').toString()
  const sessionToken = (req.query?.sessiontoken || '').toString()
  const result = await handleAutocomplete({
    input,
    sessionToken,
    ip: getClientIp(req),
  })

  sendJson(res, result.status, result.body)
}

