const { handlePlaceDetails } = require('../_lib/places')
const { getClientIp, sendJson } = require('../_lib/request')

module.exports = async function placeDetailsHandler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const placeId = (req.query?.place_id || '').toString()
  const sessionToken = (req.query?.sessiontoken || '').toString()
  const result = await handlePlaceDetails({
    placeId,
    sessionToken,
    ip: getClientIp(req),
  })

  sendJson(res, result.status, result.body)
}

