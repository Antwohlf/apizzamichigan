export const SOURCE_REVIEW_BRANDS = [
  {
    reportPattern: /dominos_pizza_us-review\.json$/i,
    label: "Domino's",
    nearestPattern: /^(Domino|Domoino|Domiono)/i,
  },
  {
    reportPattern: /papa_murphys-review\.json$/i,
    label: "Papa Murphy's",
    nearestPattern: /^Papa Murph/i,
  },
  {
    reportPattern: /pizza_hut_us-review\.json$/i,
    label: 'Pizza Hut',
    nearestPattern: /^Pizza Hut/i,
  },
  {
    reportPattern: /papa_johns-review\.json$/i,
    label: "Papa John's",
    nearestPattern: /^Papa Johns?$/i,
  },
  {
    reportPattern: /little_caesars_us-review\.json$/i,
    label: 'Little Caesars',
    nearestPattern: /^Little Caesars/i,
  },
  {
    reportPattern: /marcos-review\.json$/i,
    label: "Marco's Pizza",
    nearestPattern: /^Marco/i,
  },
  {
    reportPattern: /california_pizza_kitchen-review\.json$/i,
    label: 'California Pizza Kitchen',
    nearestPattern: /^Cal+ifornia Pizza Kit?chen/i,
  },
  {
    reportPattern: /and_pizza-review\.json$/i,
    label: '&pizza',
    nearestPattern: /^&\s*Pizza$/i,
  },
  {
    reportPattern: /round_table_pizza-review\.json$/i,
    label: 'Round Table Pizza',
    nearestPattern: /^Round Table Pizza/i,
  },
  {
    reportPattern: /foxs_pizza-review\.json$/i,
    label: "Fox's Pizza",
    nearestPattern: /^Fox'?s Pizza/i,
  },
  {
    reportPattern: /mod_pizza-review\.json$/i,
    label: 'MOD Pizza',
    nearestPattern: /^MOD Pizza/i,
  },
  {
    reportPattern: /simple_simons_pizza_us-review\.json$/i,
    label: "Simple Simon's Pizza",
    nearestPattern: /^Simple Simons Pizza/i,
  },
  {
    reportPattern: /bc_pizza-review\.json$/i,
    label: 'BC Pizza',
    nearestPattern: /^B\.?C\.? Pizza|^BC Pizza/i,
  },
]

export const sourceReviewBrand = row =>
  SOURCE_REVIEW_BRANDS.find(brand => brand.reportPattern.test(String(row?.report_file || ''))) || null

export const brandMatchState = row => {
  const brand = sourceReviewBrand(row)
  if (!brand || row?.review_kind !== 'ambiguous' || !row?.nearest_place_name) return null
  return {
    label: brand.label,
    matchesNearest: brand.nearestPattern.test(String(row.nearest_place_name || '')),
  }
}

export const reviewRecommendation = row => {
  const readiness = row?.review_readiness || ''
  const distance = Number(row?.nearest_distance_m)
  const score = Number(row?.nearest_name_score)
  const brandState = brandMatchState(row)

  if (row?.review_kind === 'likely_new') {
    if (readiness === 'candidate_ready') {
      return {
        label: 'Accept candidate',
        tone: '#86efac',
        detail: 'Has enough source identity and no nearby canonical row inside the duplicate radius.',
      }
    }
    if (readiness === 'nearby_canonical_review') {
      return {
        label: 'Check duplicate',
        tone: '#fbbf24',
        detail: 'A nearby canonical row exists; compare carefully before accepting as new.',
      }
    }
    if (readiness === 'missing_required_data') {
      return {
        label: 'Reject or ignore',
        tone: '#fca5a5',
        detail: 'Missing source identity or coordinates needed for a future reviewed-new import.',
      }
    }
  }

  if (row?.review_kind === 'ambiguous') {
    if (brandState?.matchesNearest && Number.isFinite(distance) && distance <= 25) {
      return {
        label: 'Brand link',
        tone: '#7dd3fc',
        detail: `The ${brandState.label} source report points to a nearby ${brandState.label} canonical row. Link after a quick source/coordinate check.`,
      }
    }
    if (brandState && !brandState.matchesNearest && Number.isFinite(distance) && distance <= 25) {
      return {
        label: 'Brand conflict',
        tone: '#fca5a5',
        detail: `The source report is ${brandState.label}, but the nearest canonical row is ${row.nearest_place_name || 'another brand'}. Do not bulk-link; compare on the map and usually leave for likely-new/reject review.`,
      }
    }
    if (Number.isFinite(distance) && distance <= 75 && Number.isFinite(score) && score >= 0.6) {
      return {
        label: 'Likely link',
        tone: '#7dd3fc',
        detail: 'Near the canonical row with a usable name score; verify before linking.',
      }
    }
    if (Number.isFinite(distance) && distance <= 150) {
      return {
        label: 'Compare nearby',
        tone: '#fbbf24',
        detail: 'Near a canonical row, but the name evidence is weak enough to need manual comparison.',
      }
    }
  }

  return {
    label: 'Manual review',
    tone: '#cbd5e1',
    detail: 'Use source links, coordinates, and nearest canonical context before deciding.',
  }
}

export const reviewActionCopy = row => {
  const kind = row?.review_kind || ''
  const readiness = row?.readiness || ''
  const status = row?.status || 'pending'

  if (kind === 'ambiguous' && status === 'pending') {
    return {
      title: 'Link ambiguous source rows',
      detail: 'Resolve possible duplicates first. Linking writes reviewed evidence to place_sources.',
      tone: '#7dd3fc',
      filter: { kind, status, readiness: readiness || 'link_review' },
    }
  }

  if (kind === 'likely_new' && status === 'pending' && readiness === 'nearby_canonical_review') {
    return {
      title: 'Compare likely-new duplicates',
      detail: 'Nearby canonical rows exist. Link, reject, or ignore these before accepting new places.',
      tone: '#fbbf24',
      filter: { kind, status, readiness },
    }
  }

  if (kind === 'likely_new' && status === 'pending' && readiness === 'candidate_ready') {
    return {
      title: 'Accept likely-new candidates',
      detail: 'Stage strong likely-new rows for a later reviewed-new import preflight.',
      tone: '#fb923c',
      filter: { kind, status, readiness },
    }
  }

  if (kind === 'likely_new' && status === 'pending' && readiness === 'missing_required_data') {
    return {
      title: 'Reject or ignore incomplete rows',
      detail: 'These lack source identity or coordinates needed for reviewed-new import.',
      tone: '#fca5a5',
      filter: { kind, status, readiness },
    }
  }

  if (kind === 'likely_new' && status === 'accepted') {
    return {
      title: 'Preflight accepted likely-new rows',
      detail: 'Accepted rows are review metadata until import preflight confirms they are still safe.',
      tone: '#86efac',
      filter: { kind, status, readiness: '' },
    }
  }

  return {
    title: `${kind || 'Review'} ${status}`,
    detail: 'Open this bucket and decide row by row.',
    tone: '#cbd5e1',
    filter: { kind, status, readiness },
  }
}

export const reviewBucketPlan = row => {
  const ambiguous = Number(row?.ambiguous) || 0
  const likelyNew = Number(row?.likelyNew) || 0
  const source = row?.source || ''
  const reportFile = row?.reportFile || ''

  if (ambiguous > 0) {
    return {
      title: 'Resolve ambiguous links',
      detail: 'Compare nearest canonical rows before accepting any likely-new candidates from this source.',
      tone: '#7dd3fc',
      rows: ambiguous,
      filter: { source, reportFile, kind: 'ambiguous', status: 'pending', readiness: 'link_review' },
    }
  }

  if (likelyNew > 0) {
    return {
      title: 'Review likely-new candidates',
      detail: 'Accept only source rows that look like real missing places; accepted rows still require import preflight.',
      tone: '#fb923c',
      rows: likelyNew,
      filter: { source, reportFile, kind: 'likely_new', status: 'pending', readiness: '' },
    }
  }

  return null
}

export const reviewBucketPriority = row => {
  const ambiguous = Number(row?.ambiguous) || 0
  const likelyNew = Number(row?.likelyNew) || 0
  if (ambiguous > 0) return 1000000 + ambiguous
  if (likelyNew > 0) return likelyNew
  return 0
}

export const buildReviewWorklist = (reportCounts = [], { limit = 10 } = {}) => {
  const buckets = (Array.isArray(reportCounts) ? reportCounts : [])
    .filter(row => row?.status === 'pending')
    .reduce((acc, row) => {
      const key = `${row.source || ''}\n${row.report_file || row.reportFile || ''}`
      const current = acc.get(key) || {
        source: row.source || '',
        reportFile: row.report_file || row.reportFile || '',
        ambiguous: 0,
        likelyNew: 0,
      }
      if (row.review_kind === 'ambiguous') {
        current.ambiguous += Number(row.rows) || 0
      } else if (row.review_kind === 'likely_new') {
        current.likelyNew += Number(row.rows) || 0
      }
      acc.set(key, current)
      return acc
    }, new Map())

  return Array.from(buckets.values())
    .map(row => ({ ...row, plan: reviewBucketPlan(row), priority: reviewBucketPriority(row) }))
    .filter(row => row.plan)
    .sort((a, b) => (
      b.priority - a.priority
      || b.ambiguous - a.ambiguous
      || b.likelyNew - a.likelyNew
      || String(a.source).localeCompare(String(b.source))
      || String(a.reportFile).localeCompare(String(b.reportFile))
    ))
    .slice(0, limit)
}

export const reviewQueuePressureSummary = reportCounts => {
  const [next] = buildReviewWorklist(reportCounts, { limit: 1 })
  if (!next) {
    return {
      title: 'No pending review backlog',
      detail: 'There are no pending source review buckets in the current local queue.',
      tone: '#86efac',
      rows: 0,
      filter: { kind: '', status: 'pending', readiness: '' },
    }
  }

  return {
    title: next.plan.title,
    detail: `${next.source || 'unknown source'}${next.reportFile ? ` / ${next.reportFile}` : ''}: ${next.plan.detail}`,
    tone: next.plan.tone,
    rows: next.plan.rows,
    filter: next.plan.filter,
  }
}

export const canonicalContextLines = row => {
  if (!row?.nearest_place_id && !row?.nearest_place_name) {
    return ['No nearby canonical row']
  }

  const lines = []
  const identity = [row.nearest_place_name, row.nearest_state].filter(Boolean).join(' · ')
  if (identity) {
    lines.push(identity)
  }
  if (row.nearest_address) {
    lines.push(row.nearest_address)
  }

  const lat = Number(row.nearest_lat)
  const lng = Number(row.nearest_lng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    lines.push(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
  }

  const statusParts = [
    row.nearest_status ? `status ${row.nearest_status}` : '',
    row.nearest_phone ? 'phone present' : '',
    row.nearest_website_url ? 'website present' : '',
  ].filter(Boolean)
  if (statusParts.length) {
    lines.push(statusParts.join(' · '))
  }

  return lines.length ? lines : ['Canonical row exists, but has little display context']
}

export const decisionCanonicalContextLines = row => {
  if (!row?.canonical_place_id) {
    return []
  }

  const lines = []
  const identity = [row.decision_canonical_name, row.decision_canonical_state].filter(Boolean).join(' · ')
  if (identity) {
    lines.push(identity)
  }
  if (row.decision_canonical_address) {
    lines.push(row.decision_canonical_address)
  }

  const lat = Number(row.decision_canonical_lat)
  const lng = Number(row.decision_canonical_lng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    lines.push(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
  }

  const statusParts = [
    row.decision_canonical_status ? `status ${row.decision_canonical_status}` : '',
    row.decision_canonical_phone ? 'phone present' : '',
    row.decision_canonical_website_url ? 'website present' : '',
  ].filter(Boolean)
  if (statusParts.length) {
    lines.push(statusParts.join(' · '))
  }

  return lines.length ? lines : [`Canonical id ${row.canonical_place_id}`]
}

export const reviewLifecycleCopy = row => {
  const kind = row?.review_kind || ''
  const status = row?.status || 'pending'
  const readiness = row?.review_readiness || row?.readiness || ''

  if (status === 'pending' && kind === 'ambiguous') {
    return {
      label: 'Pending link decision',
      detail: 'Choose Link only when the source row truly describes an existing canonical place.',
      tone: '#7dd3fc',
    }
  }

  if (status === 'pending' && kind === 'likely_new') {
    if (readiness === 'candidate_ready') {
      return {
        label: 'Pending accept decision',
        detail: 'Accepting only stages this row for reviewed-new import preflight; it does not create a place.',
        tone: '#fb923c',
      }
    }
    return {
      label: 'Pending review',
      detail: 'Review duplicate risk or missing data before accepting this as a new-place candidate.',
      tone: '#fbbf24',
    }
  }

  if (status === 'accepted' && kind === 'likely_new') {
    return {
      label: 'Accepted for preflight',
      detail: 'This is review metadata waiting for reviewed-new import. No canonical place exists until preflight imports it.',
      tone: '#86efac',
    }
  }

  if (status === 'linked') {
    return {
      label: row?.canonical_place_id ? `Linked to canonical ${row.canonical_place_id}` : 'Linked',
      detail: row?.review_kind === 'likely_new'
        ? 'Reviewed-new import created or linked a local canonical row and attached source evidence.'
        : 'Reviewed source evidence is attached to an existing canonical row.',
      tone: '#22c55e',
    }
  }

  if (status === 'rejected') {
    return {
      label: 'Rejected',
      detail: 'This source row should not become canonical evidence unless it is deliberately reopened later.',
      tone: '#fca5a5',
    }
  }

  if (status === 'ignored') {
    return {
      label: 'Ignored',
      detail: 'This source row is set aside without creating canonical data or source evidence.',
      tone: '#cbd5e1',
    }
  }

  return {
    label: status,
    detail: 'Review state is recorded locally in source_review_queue.',
    tone: '#cbd5e1',
  }
}
