const EMPTY_CONTACT_PATTERN = /^(?:n\/a|na|none|null|unknown|not available)$/i

export function normalizePhone(value) {
  const phone = String(value || '').trim()
  if (!phone || EMPTY_CONTACT_PATTERN.test(phone)) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits || /^0+$/.test(digits)) return null
  return phone
}

export function phoneHref(value) {
  const phone = normalizePhone(value)
  return phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : null
}

export function formatHours(hours) {
  if (!hours) return ''
  if (typeof hours === 'string') return hours.trim().replace(/^raw:\s*/i, '')
  if (Array.isArray(hours)) return hours.filter(Boolean).join(' · ')
  if (typeof hours === 'object') {
    const entries = Object.entries(hours)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    if (entries.length === 1 && String(entries[0][0]).toLowerCase() === 'raw') {
      return formatHours(entries[0][1])
    }
    return entries
      .filter(([day]) => String(day).toLowerCase() !== 'raw')
      .map(([day, value]) => `${day}: ${value}`)
      .join(' · ')
  }
  return ''
}

export function formatHoursEntries(hours) {
  if (!hours || typeof hours !== 'object') return []
  if (Array.isArray(hours)) {
    return hours
      .filter(value => value !== null && value !== undefined && String(value).trim())
      .map(value => ({ label: '', value: String(value).trim() }))
  }

  const entries = Object.entries(hours)
    .filter(([day, value]) => String(day).toLowerCase() !== 'raw' && value !== null && value !== undefined && String(value).trim())
  if (entries.length === 1 && Object.keys(hours).some(key => String(key).toLowerCase() === 'raw')) return []
  return entries.map(([label, value]) => ({ label: String(label), value: String(value).trim() }))
}
