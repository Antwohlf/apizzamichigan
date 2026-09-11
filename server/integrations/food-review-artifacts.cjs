const { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } = require('node:fs')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')
const contract = require('../../contracts/food-review-artifacts.v1.json')

const APP_ROOT = resolve(__dirname, '../..')
const filenamePattern = new RegExp(contract.filenamePattern)
const emptyTotals = () => Object.fromEntries(Object.keys(contract.countFields).map(key => [key, 0]))
const plain = value => value && typeof value === 'object' && !Array.isArray(value)

function inside(parent, child) {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function checkedDirectory(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid_directory')
  // Reject symlinks anywhere in the configured path, not only the last segment.
  if (realpathSync(path) !== resolve(path)) throw new Error('invalid_directory')
  return path
}

function readBoundedJson(path, remainingBytes) {
  const before = lstatSync(path)
  const limit = Math.min(contract.maxFileBytes, remainingBytes)
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) throw new Error('invalid_file')
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > limit || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('invalid_file')
    const bytes = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, null)
      if (!read) break
      count += read
    }
    const after = fstatSync(fd)
    if (count !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('changing_file')
    return { text: bytes.subarray(0, count).toString('utf8'), bytes: count }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function projectReport(document, file, entity, nowMs) {
  if (!plain(document) || !contract.entities.includes(document.entity)) throw new Error('missing_entity')
  if (document.entity !== entity) return null
  if (!contract.sources.includes(document.source) || !plain(document.counts)) throw new Error('invalid_report')
  const timestamp = typeof document.generated_at === 'string' ? Date.parse(document.generated_at) : NaN
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== document.generated_at
      || timestamp > nowMs + contract.futureToleranceMinutes * 60000) throw new Error('invalid_timestamp')
  const counts = {}
  for (const [target, source] of Object.entries(contract.countFields)) {
    const value = document.counts[source]
    if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) throw new Error('invalid_counts')
    counts[target] = value
  }
  return {
    file,
    source: document.source,
    sourceLabel: document.source,
    generatedAt: document.generated_at,
    stale: nowMs - timestamp > contract.maxAgeMinutes * 60000,
    ...counts,
  }
}

// Compatibility adapter for the external producer's existing review artifacts.
// It returns only the v1 summary fields, never raw candidates or worker state.
function readFoodReviewArtifacts(root, entity, { nowMs = Date.now() } = {}) {
  if (!contract.entities.includes(entity)) throw new Error('Review artifact entity must be pizza or taco')
  const result = {
    contract: { name: contract.name, version: contract.version },
    available: false,
    state: 'not_configured',
    detail: 'External review reports are not configured. Review decisions remain available from the canonical database.',
    totals: emptyTotals(),
    reports: [],
    errors: [],
  }
  if (!root) return result
  if (typeof root !== 'string' || !isAbsolute(root) || !Number.isFinite(nowMs)) {
    return { ...result, state: 'invalid', detail: 'External report configuration is invalid.' }
  }
  let directory
  try {
    const normalizedRoot = resolve(root)
    checkedDirectory(normalizedRoot)
    if (inside(realpathSync(APP_ROOT), normalizedRoot) || inside(normalizedRoot, realpathSync(APP_ROOT))) throw new Error('app_directory')
    directory = checkedDirectory(join(normalizedRoot, contract.directory))
  } catch (error) {
    return { ...result, state: error.code === 'ENOENT' ? 'missing' : 'invalid', detail: 'External review reports could not be safely located.' }
  }
  try {
    const files = readdirSync(directory).filter(file => filenamePattern.test(file)).sort()
    if (files.length > contract.maxReports) throw new Error('too_many_reports')
    let bytesRead = 0
    for (const file of files) {
      try {
        const { text, bytes } = readBoundedJson(join(directory, file), contract.maxTotalBytes - bytesRead)
        bytesRead += bytes
        const report = projectReport(JSON.parse(text), file, entity, nowMs)
        if (!report) continue
        result.reports.push(report)
        for (const key of Object.keys(result.totals)) result.totals[key] += report[key]
      } catch {
        result.errors.push({ file, error: 'Report rejected by the external artifact contract.' })
      }
    }
    return {
      ...result,
      available: result.reports.length > 0,
      state: result.errors.length ? 'partial' : result.reports.length ? 'available' : 'empty',
      detail: 'Historical artifact totals are not the pending review backlog; use the canonical review queue for current decisions.',
    }
  } catch {
    return { ...result, state: 'invalid', detail: 'External review reports could not be safely read.' }
  }
}

module.exports = { readFoodReviewArtifacts }
