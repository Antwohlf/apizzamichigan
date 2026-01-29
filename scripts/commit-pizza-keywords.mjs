#!/usr/bin/env node
/**
 * Commit pizza keyword matches, excluding address-based ones (like places in Chicago, IL)
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import { ProgressTracker } from './lib/progress-tracker.mjs'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const commit = args.includes('--commit')

async function main() {
  console.log('Pizza Keyword Commit Script')
  console.log('===========================')
  if (dryRun) console.log('MODE: Dry Run')

  const tracker = new ProgressTracker()
  await tracker.load()

  const results = tracker.getAllResults()

  // Find keyword matches that are NOT from address_keyword source
  const validKeywordMatches = Object.entries(results).filter(([_, data]) => {
    // Must have style from keyword source (not chain_map, not address_keyword)
    return data.style &&
           data.styleSource === 'keyword' &&
           !data.isKnownChain
  })

  // Also get address_keyword matches to report separately
  const addressKeywordMatches = Object.entries(results).filter(([_, data]) => {
    return data.style && data.styleSource === 'address_keyword'
  })

  console.log(`\nFound ${validKeywordMatches.length} valid keyword matches (name-based)`)
  console.log(`Found ${addressKeywordMatches.length} address-based matches (EXCLUDED)`)

  // Group by style
  const byStyle = {}
  validKeywordMatches.forEach(([_, data]) => {
    if (!byStyle[data.style]) byStyle[data.style] = []
    byStyle[data.style].push(data)
  })

  console.log('\nValid keyword matches by style:')
  Object.entries(byStyle)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([style, matches]) => {
      console.log(`  ${style}: ${matches.length}`)
    })

  // Show address-based exclusions
  const addressByStyle = {}
  addressKeywordMatches.forEach(([_, data]) => {
    if (!addressByStyle[data.style]) addressByStyle[data.style] = []
    addressByStyle[data.style].push(data)
  })

  console.log('\nExcluded address-based matches:')
  Object.entries(addressByStyle)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([style, matches]) => {
      console.log(`  ${style}: ${matches.length} (e.g., "${matches[0].name}")`)
    })

  if (!commit) {
    console.log('\nRun with --commit to update the database')
    return
  }

  console.log('\n=== Committing to Database ===')

  let updated = 0
  let errors = 0

  for (const [id, data] of validKeywordMatches) {
    const { error } = await supabase
      .from('pizza_places')
      .update({ style: data.style })
      .eq('id', id)

    if (error) {
      console.error(`Error updating id ${id}:`, error.message)
      errors++
      continue
    }

    updated++
    if (updated % 100 === 0) {
      console.log(`Updated ${updated}/${validKeywordMatches.length}`)
    }
  }

  console.log(`\nCommitted ${updated} updates (${errors} errors)`)
}

main().catch(console.error)
