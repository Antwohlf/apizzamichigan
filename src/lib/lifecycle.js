export const normalizeLifecycleStatus = value => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized.startsWith('permanently closed') || normalized.startsWith('closed')) return 'closed'
  if (normalized.startsWith('replaced')) return 'replaced'
  if (normalized.startsWith('demolished')) return 'demolished'
  return null
}

export const isHistoricalLifecycle = value => Boolean(normalizeLifecycleStatus(value))

const LIFECYCLE_COPY = Object.freeze({
  closed: Object.freeze({
    label: 'Historical place',
    badge: 'Historical',
    message: 'This business is permanently closed. Its history remains part of the map.',
  }),
  replaced: Object.freeze({
    label: 'Replaced at this location',
    badge: 'Replaced',
    message: 'This business is no longer the current tenant at this address.',
  }),
  demolished: Object.freeze({
    label: 'Demolished location',
    badge: 'Demolished',
    message: 'This location has been demolished. Its history remains part of the map.',
  }),
})

export const lifecycleLabel = value => lifecycleCopy(value)?.label || null

export const lifecycleBadgeLabel = value => lifecycleCopy(value)?.badge || null

export const lifecycleCopy = status => {
  const normalized = normalizeLifecycleStatus(status)
  return normalized ? LIFECYCLE_COPY[normalized] || null : null
}

export const replacementCopy = (placeName, replacementId = null) => {
  if (placeName) return `Current place: ${placeName}`
  if (replacementId) return 'Current place linked below.'
  return 'No current place is linked yet.'
}
