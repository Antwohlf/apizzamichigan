import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { readFoodReviewArtifacts } = require('../../server/integrations/food-review-artifacts.cjs')
const contract = require('../../contracts/food-review-artifacts.v1.json')
const nowMs = Date.parse('2026-09-11T12:00:00.000Z')
const report = (entity = 'pizza') => ({
  entity, source: 'osm', generated_at: new Date(nowMs).toISOString(),
  counts: { inputRowsInspected: 12, matchedExistingPlaces: 8, ambiguousReviewCandidates: 1, likelyNewUnmatchedCandidates: 2, acceptedForPlaceSourcesImport: 7 },
  input: 'private input path', ambiguous: [{ source_data: { private: 'must not reach the response' } }],
  command: 'do not run', token: 'do not return',
})

function workspace(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'food-review-contract-')))
  mkdirSync(join(root, 'source-review'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function save(root, name, value) {
  writeFileSync(join(root, 'source-review', name), JSON.stringify(value))
}

test('app runtime cannot import pipeline scripts, launch workers, or inspect worker secrets', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
  for (const file of walk(resolve('server')).filter(file => /\.[cm]?js$/.test(file))) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"][^'"]*(?:\/scripts\/|@map-pipeline\/|child_process|better-sqlite3)/, file)
    assert.doesNotMatch(text, /process\.env\.(?:FSQ_PLACES_TOKEN|HF_TOKEN|HUGGINGFACE_HUB_TOKEN|QUEUE_DB_PATH|SOURCE_REVIEW_DIR|SOURCE_REVIEW_QUEUE_CSV)/, file)
  }
  const server = readFileSync('server/index.js', 'utf8')
  assert.doesNotMatch(server, /latestOsmInputIds|readFsqSampleReadiness|readSourceReviewQueueCsv/)
  assert.match(server, /readFoodReviewArtifacts\(process\.env\.FOOD_PIPELINE_REPORT_ROOT/)
  assert.match(server, /stale source record is not evidence of absence/)
  assert.doesNotMatch(server, /unobserved_in_latest_input/)
})

test('unconfigured or invalid roots never fall back to the website checkout', () => {
  for (const entity of contract.entities) {
    assert.equal(readFoodReviewArtifacts('', entity).state, 'not_configured')
    assert.equal(readFoodReviewArtifacts('reports', entity).state, 'invalid')
    assert.equal(readFoodReviewArtifacts(process.cwd(), entity).state, 'invalid')
  }
  assert.throws(() => readFoodReviewArtifacts('', 'burger'), /pizza or taco/)
})

test('existing external report format is projected without cross-entity rows or private fields', t => {
  const root = workspace(t)
  save(root, 'pizza-review.json', report())
  save(root, 'taco-review.json', report('taco'))
  for (const entity of contract.entities) {
    const result = readFoodReviewArtifacts(root, entity, { nowMs })
    assert.equal(result.state, 'available')
    assert.equal(result.reports.length, 1)
    assert.equal(result.reports[0].file, `${entity}-review.json`)
    assert.equal(result.totals.inputRows, 12)
    assert.equal(result.totals.matched, 8)
    assert.deepEqual(result.contract, { name: 'food-review-artifacts', version: 1 })
    assert.doesNotMatch(JSON.stringify(result), /private input|must not reach|do not run|do not return/)
    assert.deepEqual(Object.keys(result.reports[0]).sort(), ['file', 'source', 'sourceLabel', 'generatedAt', 'stale', ...Object.keys(contract.countFields)].sort())
  }
})

test('unlabelled, corrupt, future, and invalid-count reports are unavailable, not zero-work success', t => {
  const root = workspace(t)
  const variants = [
    { ...report(), entity: undefined },
    { ...report(), entity: 'burger' },
    { ...report(), source: 'unknown' },
    { ...report(), generated_at: 'not a date' },
    { ...report(), generated_at: new Date(nowMs + 3600000).toISOString() },
    { ...report(), counts: { ...report().counts, matchedExistingPlaces: -1 } },
    { ...report(), counts: {} },
  ]
  variants.forEach((value, i) => save(root, `bad-${i}-review.json`, value))
  writeFileSync(join(root, 'source-review/corrupt-review.json'), '{private broken data')
  const result = readFoodReviewArtifacts(root, 'pizza', { nowMs })
  assert.equal(result.available, false)
  assert.equal(result.state, 'partial')
  assert.equal(result.errors.length, variants.length + 1)
  assert.doesNotMatch(JSON.stringify(result), /private broken data/)
})

test('historical report counts are labelled stale and never presented as the live backlog', t => {
  const root = workspace(t)
  save(root, 'old-review.json', { ...report(), generated_at: new Date(nowMs - 86400000).toISOString() })
  const result = readFoodReviewArtifacts(root, 'pizza', { nowMs })
  assert.equal(result.reports[0].stale, true)
  assert.match(result.detail, /not the pending review backlog/)
})

test('symlinked roots, directories, and files are rejected', t => {
  const root = workspace(t)
  const other = workspace(t)
  save(other, 'external-review.json', report())
  symlinkSync(join(other, 'source-review/external-review.json'), join(root, 'source-review/link-review.json'))
  assert.equal(readFoodReviewArtifacts(root, 'pizza', { nowMs }).available, false)
  const link = join(root, 'link')
  symlinkSync(other, link)
  assert.equal(readFoodReviewArtifacts(link, 'pizza', { nowMs }).state, 'invalid')
  const directoryRoot = join(root, 'directory-root')
  mkdirSync(directoryRoot)
  symlinkSync(join(other, 'source-review'), join(directoryRoot, 'source-review'))
  assert.equal(readFoodReviewArtifacts(directoryRoot, 'pizza', { nowMs }).state, 'invalid')
})

test('oversized files and excessive report counts fail closed', t => {
  const root = workspace(t)
  writeFileSync(join(root, 'source-review/large-review.json'), ' '.repeat(contract.maxFileBytes + 1))
  assert.equal(readFoodReviewArtifacts(root, 'pizza', { nowMs }).available, false)
  for (let i = 0; i < contract.maxReports; i++) save(root, `report-${i}-review.json`, report())
  assert.equal(readFoodReviewArtifacts(root, 'pizza', { nowMs }).state, 'invalid')
})
