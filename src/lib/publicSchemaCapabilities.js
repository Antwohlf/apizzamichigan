const schemaModes = new Map()
let sourceIdentity = null

function syncSource(identity) {
  if (identity === sourceIdentity) return
  sourceIdentity = identity
  schemaModes.clear()
}

export function isLegacyPublicSchema(source, table) {
  syncSource(source)
  return schemaModes.get(table) === 'legacy'
}

export function markLegacyPublicSchema(source, table) {
  syncSource(source)
  schemaModes.set(table, 'legacy')
}
