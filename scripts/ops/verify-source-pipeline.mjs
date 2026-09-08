#!/usr/bin/env node
/** Verify app-owned source/review declarations after runtime extraction. */

import { existsSync, readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const readJson = path => JSON.parse(read(path))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const config = readJson('config/source-pipeline.json')
const policy = readJson('config/source-policy.json')
const boundary = readJson('config/food-runtime-boundary.json')
const lifecycleQuality = read('scripts/ops/lifecycle-quality-report.mjs')
const sourceQuality = read('scripts/ops/source-quality-report.mjs')
const scopeHelper = read('scripts/lib/source-pipeline-scope.mjs')
const autoLinkPolicy = read('scripts/lib/source-auto-link-policy.mjs')
const autoLink = read('scripts/ops/auto-link-source-review-queue.mjs')
const websiteProvenance = read('scripts/ops/record-website-provenance.mjs')

const required = ['osm', 'fsq_os_places', 'all_the_places', 'overture_places', 'wikidata', 'official_website']
const capabilities = ['discover', 'match_existing', 'enrich_evidence', 'promote_contact']
const removedRuntimeFiles = [
  'scripts/enrichment/agents/llm-classifier.mjs',
  'scripts/enrichment/agents/web-scraper.mjs',
  'scripts/enrichment/agents/coordinator.mjs',
  'scripts/enrichment/slowlane/menu-parse-worker.mjs',
  'scripts/ops/run-source-pipeline.mjs',
  'scripts/ops/process-reviewed-new-batch.mjs',
  'scripts/ops/classifier-batch-report.mjs',
]

assert(boundary.runtimeRepository === 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline', 'food runtime repository ownership changed')
assert(boundary.runtimePackage === 'packages/food-runtime', 'food runtime package ownership changed')
assert(Array.isArray(boundary.products)
  && boundary.products.includes('apizzamichigan')
  && boundary.products.includes('tacoboutmichigan'), 'food runtime must own both product profiles')
assert(Array.isArray(boundary.scheduledJobsOwnedBySite) && boundary.scheduledJobsOwnedBySite.length === 0, 'site must not own scheduled food jobs')
for (const path of removedRuntimeFiles) assert(!existsSync(path), `external runtime implementation remains in app: ${path}`)

const missing = required.filter(key => !config.sources?.[key]?.enabled)
assert(missing.length === 0, `missing enabled source declarations: ${missing.join(', ')}`)
for (const key of required) {
  const declared = config.sources[key]?.capabilities
  assert(Array.isArray(declared)
    && declared.length > 0
    && declared.every(value => capabilities.includes(value)), `${key} must declare valid source capabilities`)
  assert(!config.sources[key].auto_create || declared.includes('discover'), `${key} cannot auto-create without discover capability`)
  assert(declared.includes('enrich_evidence'), `${key} must contribute enrichment evidence or be disabled`)
}
assert(config.sources.official_website.capabilities.includes('promote_contact'), 'official_website must be the explicit contact-promotion source')
assert(required.filter(key => config.sources[key].capabilities.includes('promote_contact')).length === 1, 'exactly one source may promote contact fields automatically')
assert(!config.sources.wikidata.auto_create && !config.sources.official_website.auto_create, 'enrichment-only sources cannot auto-create places')

assert(config.limits.new_places_per_run === 50
  && config.limits.new_places_per_day === 250
  && config.limits.classify_queue_jobs_per_region_per_run === 50
  && config.limits.classify_partial_retry_jobs_per_region_per_run === 0, 'review/import and classifier feeder caps must remain bounded')
assert(config.classifier_retry_feeder?.enabled === true
  && config.classifier_retry_feeder.high_water === 2
  && config.classifier_retry_feeder.batch_per_run === 2
  && JSON.stringify(config.classifier_retry_feeder.states) === JSON.stringify(['MI', 'NY']), 'classifier retry declaration must remain bounded to two MI/NY jobs')
assert(Array.isArray(config.operational_regions)
  && config.operational_regions.length > 0
  && scopeHelper.includes('config.operational_regions'), 'source review scope must default to configured operational regions')

assert(policy.version === 1 && required.every(key => policy.sources?.[key]?.freshness_days), 'source policy must define freshness for every declared source')
assert(lifecycleQuality.includes('config/source-policy.json') && lifecycleQuality.includes('sourceFreshnessCase'), 'lifecycle review must derive freshness windows from source policy')

assert(autoLinkPolicy.includes("source === 'wikidata'")
  && autoLinkPolicy.includes("source === 'all_the_places'")
  && autoLinkPolicy.includes('return []'), 'source-specific auto-link identity contracts changed')
assert(autoLink.includes('includeScoreDistance && !args.exactIdentifiers && !args.exactSourceId && !args.sourceIdentity')
  && autoLink.includes('Exact-match automation must not inherit')
  && autoLink.includes('args.minExactIdentifiers !== 3')
  && autoLink.includes('sourceAddress')
  && autoLink.includes('sourcePhone')
  && autoLink.includes('sourceWebsite')
  && autoLink.includes('exactSourceIdReason')
  && autoLink.includes('sourceIdentityReason'), 'exact-identifier review linking must exclude broad spatial/name matches')
assert(autoLink.includes("source_data->>'full_address'")
  && autoLink.includes("source_data->>'phone_number'")
  && autoLink.includes("source_data->>'website_url'"), 'exact-identifier review linking must accept normalized source aliases')
assert(autoLink.includes('--exact-source-id') && autoLink.includes('exactSourceId'), 'exact-source-id review linking must remain available')
assert(websiteProvenance.includes("CONCAT('place:', id)"), 'website provenance identities must remain location-scoped')
assert(sourceQuality.includes("source_data->>'latitude'")
  && sourceQuality.includes("source_data->>'lon'")
  && sourceQuality.includes("source_data->>'longitude'"), 'source review coordinate checks must accept normalized aliases')

console.log(JSON.stringify({
  status: 'ok',
  sources: required,
  caps: { per_run: config.limits.new_places_per_run, per_day: config.limits.new_places_per_day },
  policy_version: policy.version,
  capabilities: Object.fromEntries(required.map(key => [key, config.sources[key].capabilities])),
  runtime_owner: `${boundary.runtimeRepository}/tree/main/${boundary.runtimePackage}`,
  scope: 'app-owned source/review declarations; active execution verified externally',
}))
