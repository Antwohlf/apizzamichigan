// App-owned, read-only identity guidance. Decisions always remain human-gated.
export function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ')
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '').slice(-10)
}

export function normalizeUrl(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '')
}

function hasLatin(value) {
  return /[A-Za-z]/.test(String(value || ''))
}

function coordinates(row) {
  const lat = Number(row.source_data?.lat ?? row.source_data?.latitude)
  const lng = Number(row.source_data?.lng ?? row.source_data?.lon ?? row.source_data?.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

export function evidenceFor(row) {
  const sourceCoords = coordinates(row)
  const distance = row.nearest_distance_m == null ? null : Number(row.nearest_distance_m)
  const sourcePhone = digits(row.source_data?.phone || row.source_data?.['contact:phone'])
  const canonicalPhone = digits(row.nearest_phone)
  const sourceWebsite = normalizeUrl(row.source_data?.website || row.source_data?.['contact:website'])
  const canonicalWebsite = normalizeUrl(row.nearest_website_url)
  return {
    location_distance_m: Number.isFinite(distance) ? distance : null,
    location_is_close: Number.isFinite(distance) && distance <= 25,
    source_id_matches_canonical: row.source === 'osm' && row.source_id === row.nearest_current_google_place_id,
    source_brand_wikidata_id_matches_canonical: row.source === 'wikidata' && [
      row.nearest_brand_wikidata,
      row.nearest_osm_tags?.['brand:wikidata'],
    ].filter(Boolean).includes(row.source_id),
    source_operator_wikidata_id_matches_canonical: row.source === 'wikidata' && [
      row.nearest_operator_wikidata,
      row.nearest_osm_tags?.['operator:wikidata'],
    ].filter(Boolean).includes(row.source_id),
    names_match_normalized: normalizeText(row.source_name) === normalizeText(row.nearest_place_name),
    names_are_conflicting_latin_labels: hasLatin(row.source_name)
      && hasLatin(row.nearest_place_name)
      && normalizeText(row.source_name) !== normalizeText(row.nearest_place_name),
    source_phone_matches: Boolean(sourcePhone && sourcePhone === canonicalPhone),
    source_website_matches: Boolean(sourceWebsite && sourceWebsite === canonicalWebsite),
    source_has_address: Boolean(row.source_data?.address || row.source_data?.['addr:full']),
    canonical_has_address: Boolean(row.nearest_address),
    source_coordinates_present: Boolean(sourceCoords),
    canonical_status: row.nearest_status || null,
    canonical_has_personal_history: row.nearest_status !== 'unvisited' || row.nearest_rating != null || Boolean(String(row.nearest_notes || '').trim()),
  }
}

function samePlaceSuggestion(confidence, reason, supportingEvidence) {
  return {
    decision: 'same_place',
    confidence,
    reason,
    supporting_evidence: supportingEvidence,
    needs_human_review: true,
    decision_origin: 'deterministic',
  }
}

export function deterministicDecision(row, evidence) {
  if (evidence.source_brand_wikidata_id_matches_canonical && evidence.location_is_close) {
    if (evidence.names_are_conflicting_latin_labels) {
      return {
        decision: 'uncertain',
        confidence: 0.85,
        reason: 'The source brand identity and location agree, but the two Latin business names conflict; this may be stale data or a replacement.',
        supporting_evidence: ['matching brand Wikidata identity', 'matching location', 'conflicting business names'],
        needs_human_review: true,
        decision_origin: 'deterministic',
      }
    }
    return samePlaceSuggestion(
      0.95,
      'The source Wikidata ID matches the canonical brand identity and the locations coincide; confirm the name and business lifecycle before linking.',
      ['matching brand Wikidata identity', 'matching location'],
    )
  }

  if (evidence.source_operator_wikidata_id_matches_canonical && evidence.location_is_close) {
    return {
      decision: 'uncertain',
      confidence: 0.8,
      reason: 'The source Wikidata ID identifies the canonical operator, not necessarily this specific business; human review is required.',
      supporting_evidence: ['matching operator Wikidata identity', 'matching location'],
      needs_human_review: true,
      decision_origin: 'deterministic',
    }
  }

  // A specific official URL and phone number are stronger identity signals
  // than a translated, abbreviated, or stale business name. Keep the action
  // human-gated because the old record may still need lifecycle treatment.
  if (evidence.location_is_close && evidence.source_website_matches && evidence.source_phone_matches) {
    return samePlaceSuggestion(
      0.99,
      'The official website, phone number, and location agree; confirm whether this is the same business or a replacement before linking.',
      ['matching official website', 'matching phone number', 'matching location'],
    )
  }

  if (evidence.location_is_close && evidence.source_website_matches && !evidence.names_are_conflicting_latin_labels) {
    return samePlaceSuggestion(
      0.94,
      'The official website and location agree; confirm the business identity and lifecycle before linking.',
      ['matching official website', 'matching location'],
    )
  }

  if (evidence.location_is_close && evidence.source_phone_matches && evidence.names_match_normalized) {
    return samePlaceSuggestion(
      0.96,
      'The phone number, normalized name, and location agree; confirm before linking.',
      ['matching phone number', 'matching normalized name', 'matching location'],
    )
  }

  return null
}
