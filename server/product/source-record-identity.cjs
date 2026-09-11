// OSM queue records carry an osm: prefix; place_sources stores the raw OSM ID.
// Derive both forms together so reviewed imports and duplicate checks agree.
function sourceRecordIdentity(source, rawId) {
  const namespace = String(source || '').trim()
  let sourceId = String(rawId || '').trim()
  if (namespace === 'osm') sourceId = sourceId.replace(/^(?:osm:)+/, '')
  return {
    sourceId: sourceId || null,
    googlePlaceId: namespace && sourceId ? `${namespace}:${sourceId}` : null,
  }
}

module.exports = { sourceRecordIdentity }
