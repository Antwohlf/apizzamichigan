#!/usr/bin/env node
import { extractMenuData } from '../lib/menu-data-extractor.mjs'
import { existsSync, readFileSync } from 'node:fs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const result = extractMenuData({
  website_url: 'https://example.com',
  jsonld: [{
    '@type': 'Restaurant',
    menu: '/menu',
    hasMenu: {
      hasMenuSection: [{
        hasMenuItem: [
          { name: 'Margherita', price: '18' },
          { name: 'Pepperoni', price: '20' },
        ],
      }],
    },
  }],
})

assert(result?.has_menu === true, 'structured menu should be detected')
assert(result.confidence === 'high', 'structured menu should have high confidence')
assert(result.menu_urls[0] === 'https://example.com/menu', 'relative menu URL should be normalized')
assert(result.items.length === 2, 'structured menu items should be preserved')
assert(result.items[0].name === 'Margherita', 'menu item name should be preserved')
assert(extractMenuData({ text_excerpt: 'No menu link here' }) === null, 'weak text must not invent a menu')

const boundary = JSON.parse(readFileSync('config/food-runtime-boundary.json', 'utf8'))
assert(boundary.runtimeRepository === 'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline', 'menu runtime owner changed')
assert(boundary.runtimePackage === 'packages/food-runtime', 'menu runtime package changed')
assert(boundary.scheduledJobsOwnedBySite.length === 0, 'site must not schedule the menu worker')
assert(!existsSync('scripts/enrichment/slowlane/menu-parse-worker.mjs'), 'menu worker implementation must remain external')

const claim = readFileSync('scripts/enrichment/slowlane/menu-parse-claim.mjs', 'utf8')
assert(claim.includes("queue.claim('menu_parse'"), 'compatibility claim must select only menu_parse jobs')
assert(claim.includes("job.placeType === 'pizza' ? 'pizza_places' : 'taco_places'"), 'compatibility claim must keep Pizza/Taco table routing')
assert(claim.includes('extractMenuData'), 'compatibility claim must use the app-owned deterministic extractor')

console.log('# Menu Data Extractor Verification')
console.log('structured_items=2')
console.log('worker_owner=external-runtime')
console.log('status=ok')
