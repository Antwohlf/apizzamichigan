const DEFAULT_STALE_HOURS = 36

export function classifyBackupFreshness({ ageMinutes, staleHours = DEFAULT_STALE_HOURS } = {}) {
  const thresholdHours = Number(staleHours)
  const thresholdMinutes = Number.isFinite(thresholdHours) && thresholdHours > 0
    ? thresholdHours * 60
    : DEFAULT_STALE_HOURS * 60

  const normalizedAge = typeof ageMinutes === 'number' || typeof ageMinutes === 'string'
    ? Number(ageMinutes)
    : NaN

  if (!Number.isFinite(normalizedAge) || normalizedAge < 0) {
    return {
      state: 'unknown',
      fresh: false,
      thresholdHours: thresholdMinutes / 60,
      detail: 'backup age could not be determined',
    }
  }

  const age = normalizedAge
  if (age > thresholdMinutes) {
    return {
      state: 'stale',
      fresh: false,
      thresholdHours: thresholdMinutes / 60,
      detail: `latest backup is ${age.toFixed(1)} minutes old; threshold is ${thresholdMinutes / 60} hours`,
    }
  }

  return {
    state: 'fresh',
    fresh: true,
    thresholdHours: thresholdMinutes / 60,
    detail: null,
  }
}
