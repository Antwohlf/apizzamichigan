#!/usr/bin/env node
import { readFileSync } from 'fs'

const data = JSON.parse(readFileSync('./scripts/pizza-metadata-review.json', 'utf8'))

console.log('=== PIZZA METADATA REVIEW ===')
console.log(JSON.stringify(data.summary, null, 2))

console.log('\n=== KEYWORD MATCHES BY KEYWORD ===')
const byKeyword = {}
data.keywordMatches.forEach(m => {
  const key = m.styleMatch || 'unknown'
  if (!byKeyword[key]) byKeyword[key] = []
  byKeyword[key].push({ name: m.name, style: m.style, source: m.styleSource })
})

Object.entries(byKeyword)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([keyword, matches]) => {
    console.log(`\n"${keyword}" → ${matches[0].style} (${matches.length} matches, source: ${matches[0].source}):`)
    matches.slice(0, 6).forEach(m => console.log(`  - ${m.name}`))
    if (matches.length > 6) console.log(`  ... and ${matches.length - 6} more`)
  })
