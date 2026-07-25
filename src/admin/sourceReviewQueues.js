export const SOURCE_REVIEW_QUEUES = [
  {
    id: 'matches',
    label: 'Match existing',
    homeTitle: 'Match source records to existing places',
    detail: 'Confirm when a source record describes a place already on the map.',
    kind: 'ambiguous',
    readiness: 'link_review',
    countKey: 'matchExisting',
  },
  {
    id: 'duplicates',
    label: 'Check duplicates',
    homeTitle: 'Check possible duplicates',
    detail: 'Decide whether nearby records are the same place or genuinely new.',
    kind: 'likely_new',
    readiness: 'nearby_canonical_review',
    countKey: 'checkDuplicates',
  },
  {
    id: 'new',
    label: 'Approve new',
    homeTitle: 'Approve genuinely new places',
    detail: 'Review strong candidates that do not have a nearby map match.',
    kind: 'likely_new',
    readiness: 'candidate_ready',
    countKey: 'approveNew',
  },
  {
    id: 'incomplete',
    label: 'Incomplete',
    homeTitle: 'Review incomplete source records',
    detail: 'Dismiss or defer records that are missing usable identity or location data.',
    kind: 'likely_new',
    readiness: 'missing_required_data',
    countKey: 'incomplete',
  },
]

export const DEFAULT_SOURCE_REVIEW_QUEUE = SOURCE_REVIEW_QUEUES[0]

export const sourceReviewQueue = id =>
  SOURCE_REVIEW_QUEUES.find(queue => queue.id === id) || DEFAULT_SOURCE_REVIEW_QUEUE

export const sourceLabel = source => {
  const labels = {
    all_the_places: 'Official chain websites',
    fsq_os_places: 'Foursquare Open Source Places',
    osm: 'OpenStreetMap',
    overture_places: 'Overture Maps',
    wikidata: 'Wikidata',
  }
  return labels[source] || String(source || 'Unknown source').replace(/_/g, ' ')
}

export const normalizeReviewText = value =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')

export const valuesDiffer = (left, right) => {
  if (!left || !right) return false
  return normalizeReviewText(left) !== normalizeReviewText(right)
}

export const isExactOsmIdentityMatch = row =>
  row?.source === 'osm'
  && Boolean(row?.source_id)
  && String(row.source_id).trim() === String(row.nearest_current_google_place_id || '').trim()

export const canUpdateExactOsmPlace = row =>
  isExactOsmIdentityMatch(row)
  && valuesDiffer(row?.source_name || row?.source_data?.name, row?.nearest_place_name)
  && row?.nearest_status === 'unvisited'
  && row?.nearest_rating == null
  && !String(row?.nearest_notes || '').trim()
  && !String(row?.nearest_lifecycle_status || '').trim()

export const canRecordBusinessReplacement = row =>
  isExactOsmIdentityMatch(row)
  && valuesDiffer(row?.source_name || row?.source_data?.name, row?.nearest_place_name)
  && !canUpdateExactOsmPlace(row)
  && !String(row?.nearest_lifecycle_status || '').trim()

export const sourceAddress = row =>
  row?.source_data?.address
  || row?.source_data?.['addr:full']
  || [
    row?.source_data?.address_line,
    row?.source_data?.locality,
    row?.source_data?.region,
    row?.source_data?.postcode,
  ].filter(Boolean).join(', ')

export const sourcePhone = row =>
  row?.source_data?.phone || row?.source_data?.['contact:phone'] || row?.source_data?.tel || ''

export const sourceWebsite = row =>
  row?.source_data?.website
  || row?.source_data?.website_url
  || row?.source_data?.['contact:website']
  || ''

const normalizedPhone = value => String(value || '').replace(/\D/g, '').slice(-10)
const normalizedWebsite = value => {
  try {
    const url = new URL(String(value || ''))
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`
  } catch {
    return ''
  }
}

const normalizedAddress = value => normalizeReviewText(value)

export const deterministicMatchEvidence = row => {
  if (isExactOsmIdentityMatch(row)) {
    return {
      kind: 'osm_identity',
      title: 'Same OpenStreetMap record',
      detail: 'The source and map record share the exact OpenStreetMap ID. Check the business name for a replacement before linking.',
    }
  }

  if (row?.source !== 'all_the_places') return null

  const sourceUrl = normalizedWebsite(sourceWebsite(row))
  const canonicalUrl = normalizedWebsite(row?.nearest_website_url)
  const sourcePhoneValue = normalizedPhone(sourcePhone(row))
  const canonicalPhoneValue = normalizedPhone(row?.nearest_phone)
  const sourceAddressValue = normalizedAddress(sourceAddress(row))
  const canonicalAddressValue = normalizedAddress(row?.nearest_address)
  const websiteMatches = Boolean(sourceUrl && canonicalUrl && sourceUrl === canonicalUrl)
  const phoneMatches = Boolean(sourcePhoneValue && sourcePhoneValue.length === 10 && sourcePhoneValue === canonicalPhoneValue)
  const addressMatches = Boolean(sourceAddressValue && canonicalAddressValue && sourceAddressValue === canonicalAddressValue)
  const matchingDetails = [
    websiteMatches ? 'store page' : null,
    phoneMatches ? 'phone' : null,
    addressMatches ? 'address' : null,
  ].filter(Boolean)

  if (matchingDetails.length < 2) return null
  const namesDiffer = valuesDiffer(row?.source_name || row?.source_data?.name, row?.nearest_place_name)
  return {
    kind: 'official_identifiers',
    title: namesDiffer ? 'Exact store details agree; check for a replacement' : 'Exact store details agree',
    detail: `The official source matches the existing record on ${matchingDetails.join(', ')}. Confirm the name before linking.`,
  }
}

export const sourceCoordinates = row => {
  const lat = Number(row?.source_data?.lat ?? row?.source_data?.latitude)
  const lng = Number(row?.source_data?.lng ?? row?.source_data?.lon ?? row?.source_data?.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

export const mapsUrl = coordinates =>
  coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinates.lat},${coordinates.lng}`)}`
    : ''

export const safeExternalUrl = value => {
  try {
    const parsed = new URL(String(value || ''))
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch (err) {
    return ''
  }
}

export const humanReadiness = readiness => {
  const labels = {
    candidate_ready: 'Ready to approve',
    nearby_canonical_review: 'Possible duplicate',
    duplicate_accepted_source_coordinate: 'Duplicate source location',
    missing_required_data: 'Missing information',
    link_review: 'Needs match decision',
    replacement_candidate_ready: 'Ready to replace a historical place',
  }
  return labels[readiness] || String(readiness || 'Unknown').replace(/_/g, ' ')
}
