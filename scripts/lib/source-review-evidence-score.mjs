const SIGNALS = [
  ['location', 'matching location'],
  ['phone', 'matching phone'],
  ['website', 'matching official website'],
  ['normalizedName', 'equivalent normalized name'],
  ['sourceIdentity', 'matching source identity'],
]

export function scoreIdentityEvidence(input = {}) {
  const signals = Object.fromEntries(SIGNALS.map(([key]) => [key, Boolean(input[key])]))
  const supportingEvidence = SIGNALS.filter(([key]) => signals[key]).map(([, label]) => label)
  const score = supportingEvidence.length
  const continuityEvidence = signals.phone || signals.website || signals.sourceIdentity
  const replacementRisk = input.normalizedRelationship === 'different' || input.replacementRisk === true
  const meetsThreshold = score >= 3
  // A replacement can reuse the same phone, website, and address. Never
  // auto-approve it; lifecycle treatment requires an explicit decision.
  const autoApprove = meetsThreshold && !replacementRisk && Boolean(input.location)

  return {
    score,
    maxScore: SIGNALS.length,
    signals,
    supportingEvidence,
    replacementRisk,
    continuityEvidence,
    autoApprove,
    route: autoApprove ? 'auto_accept' : 'human_review',
  }
}

export function scoreFromPlaceRecords(source, candidate, normalization = {}) {
  const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizeAddress = (value) => String(value || '')
    .toLowerCase()
    .replace(/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/gi, '')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sameAddress = (left, right) => {
    if (!left || !right) return false
    return left === right
  }
  const sourceWebsite = compact(source?.website)
  const candidateWebsite = compact(candidate?.website)
  const sourcePhone = compact(source?.phone)
  const candidatePhone = compact(candidate?.phone)
  const sourceAddress = normalizeAddress(source?.address)
  const candidateAddress = normalizeAddress(candidate?.address)

  return scoreIdentityEvidence({
    location: sameAddress(sourceAddress, candidateAddress),
    phone: Boolean(sourcePhone && candidatePhone && sourcePhone === candidatePhone),
    website: Boolean(sourceWebsite && candidateWebsite && sourceWebsite === candidateWebsite),
    normalizedName: normalization.relationship === 'equivalent',
    sourceIdentity: Boolean(source?.sourceIdentity && candidate?.sourceIdentity && source.sourceIdentity === candidate.sourceIdentity),
    normalizedRelationship: normalization.relationship,
  })
}
