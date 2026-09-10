import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('legacy admin form sends mutations only through the authenticated server route', async () => {
  const source = await readFile(new URL('../../src/AdminForm.js', import.meta.url), 'utf8')
  assert.match(source, /fetch\('\/api\/admin\/submitPlace'/)
  assert.doesNotMatch(source, /from ['"]\.\/supabaseClient['"]/)
  assert.doesNotMatch(source, /uploadReviewPhoto/)
  assert.doesNotMatch(source, /supabase\.(?:from|storage)/)
  assert.match(source, /google_place_id: payload\.googlePlaceId/)
  assert.match(source, /state: stateFromFormattedAddress\(nextAddress\)/)
})

test('the submission route is guarded by the full admin auth middleware', async () => {
  const source = await readFile(new URL('../../server/index.js', import.meta.url), 'utf8')
  assert.match(source, /app\.post\('\/api\/admin\/submitPlace', requireAdminAuth,/)
  assert.match(source, /normalizeAdminPlaceSubmission\(req\.body\)/)
  assert.match(source, /normalizePreparedPhoto\(req\.body\?\.photo\)/)
  assert.match(source, /from\(REVIEW_PHOTO_TABLE\)\.insert\(\{[\s\S]*entity_type: entity,/)
  assert.match(source, /entity === 'frozen' && photo/)
  assert.doesNotMatch(source, /attachLegacyPhotoToRow/)
  assert.match(source, /entity_type: entityType/)
  assert.match(source, /\.eq\('entity_type', entityType\)/)
})
