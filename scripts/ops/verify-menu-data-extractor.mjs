#!/usr/bin/env node
import { extractMenuData } from '../lib/menu-data-extractor.mjs'
import { readFileSync } from 'node:fs'

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

const worker = readFileSync('scripts/enrichment/slowlane/menu-parse-worker.mjs', 'utf8')
assert(worker.includes("queue.claim('menu_parse'"), 'worker must claim only menu_parse jobs')
assert(!worker.includes('ollama'), 'deterministic worker must not call Ollama')
assert(worker.includes('--max-jobs'), 'worker must be bounded by an explicit job limit')

console.log('# Menu Data Extractor Verification')
console.log('structured_items=2')
console.log('status=ok')
