#!/usr/bin/env node
/**
 * Migrate State Codes
 *
 * Updates conflicting 2-letter state codes to 3-letter ISO codes
 * for global script data (distinguishes from regional data).
 *
 * Conflicting codes and their migrations:
 *   TH (Thailand/Thuringia) -> THA (records without German-style addresses)
 *   CN (China/Canary Islands) -> CHN (records without Spanish addresses)
 *   TR (Turkey/Trujillo) -> TUR (records without Venezuelan addresses)
 *   PH (Philippines/Paraguay) -> PHL (records without Paraguayan addresses)
 *   SA (Saudi Arabia/LatAm) -> SAU (records without LatAm addresses)
 *   ZA (South Africa/Guatemala) -> ZAF (records without Guatemalan addresses)
 *   IN (India/Indiana) -> IND (records without US addresses)
 *   ID (Indonesia/Idaho) -> IDN (records without US addresses)
 *   SG (Singapore/St. Gallen) -> SGP (records without Swiss addresses)
 *
 * Usage:
 *   node scripts/migrate-state-codes.mjs --dry-run    # Preview changes
 *   node scripts/migrate-state-codes.mjs              # Execute migration
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const DRY_RUN = process.argv.includes('--dry-run')

// Migration rules: [oldCode, newCode, excludeAddressPattern]
// excludeAddressPattern: regex to identify records that should NOT be migrated
const MIGRATIONS = [
  // TH: Thailand vs Thuringia (Germany)
  // German addresses have postal codes like "TH, 99XXX" or ", Germany"
  ['TH', 'THA', /,\s*(TH,?\s*\d{5}|Germany|Deutschland)/i],

  // CN: China vs Canary Islands (Spain)
  // Spanish addresses have ", Spain" or Spanish postal codes
  ['CN', 'CHN', /,\s*(Spain|España|ES,?\s*\d{5}|Las Palmas|Santa Cruz de Tenerife)/i],

  // SG: Singapore vs St. Gallen (Switzerland)
  // Swiss addresses have ", SG, XXXX" format or ", Switzerland"
  ['SG', 'SGP', /,\s*(SG,?\s*\d{4}|Switzerland|Schweiz|CH-)/i],

  // TR: Turkey vs Trujillo (Venezuela)
  // Venezuelan addresses have ", Venezuela" or ", VE"
  ['TR', 'TUR', /,\s*(Venezuela|VE,?\s*\d)/i],

  // PH: Philippines vs Paraguay department
  // Paraguayan addresses have ", Paraguay" or Paraguayan city names
  ['PH', 'PHL', /,\s*(Paraguay|PY,?\s*\d|Asunción|Ciudad del Este)/i],

  // SA: Saudi Arabia vs multiple Latin American regions
  // LatAm addresses have country names or specific patterns
  ['SA', 'SAU', /,\s*(Uruguay|Suriname|Guatemala|El Salvador|UY|SR|GT|SV)/i],

  // ZA: South Africa vs Guatemala department
  // Guatemalan addresses have ", Guatemala" or ", GT"
  ['ZA', 'ZAF', /,\s*(Guatemala|GT,?\s*\d)/i],

  // IN: India vs Indiana (USA)
  // US addresses have ", IN" or ", IN, XXXXX" format
  // Be conservative: exclude if address contains ", IN" anywhere
  ['IN', 'IND', /,\s*IN(\s*,|\s*$|\s+\d)/i],

  // ID: Indonesia vs Idaho (USA)
  // US addresses have ", ID" or ", ID, XXXXX" format
  // Be conservative: exclude if address contains ", ID" anywhere
  ['ID', 'IDN', /,\s*ID(\s*,|\s*$|\s+\d)/i],
]

async function migrateTable(table) {
  console.log(`\n=== Migrating ${table} ===\n`)

  let totalMigrated = 0

  for (const [oldCode, newCode, excludePattern] of MIGRATIONS) {
    // Fetch all records with this state code
    const { data: records, error } = await supabase
      .from(table)
      .select('id, name, address, state')
      .eq('state', oldCode)

    if (error) {
      console.error(`Error fetching ${oldCode}: ${error.message}`)
      continue
    }

    if (!records || records.length === 0) {
      console.log(`${oldCode} -> ${newCode}: 0 records (none found)`)
      continue
    }

    // Filter: only migrate records that DON'T match the exclude pattern
    const toMigrate = records.filter(r => {
      if (!r.address) return true  // No address = likely global script data
      return !excludePattern.test(r.address)
    })

    const excluded = records.length - toMigrate.length

    if (toMigrate.length === 0) {
      console.log(`${oldCode} -> ${newCode}: 0 to migrate (${excluded} excluded by address pattern)`)
      continue
    }

    console.log(`${oldCode} -> ${newCode}: ${toMigrate.length} to migrate (${excluded} excluded)`)

    if (DRY_RUN) {
      // Show samples
      const samples = toMigrate.slice(0, 3)
      samples.forEach(r => console.log(`  - ${r.name} | ${r.address || 'no address'}`))
      if (toMigrate.length > 3) console.log(`  ... and ${toMigrate.length - 3} more`)
    } else {
      // Execute migration
      const ids = toMigrate.map(r => r.id)

      // Batch update in chunks of 500
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        const { error: updateError } = await supabase
          .from(table)
          .update({ state: newCode })
          .in('id', chunk)

        if (updateError) {
          console.error(`  Error updating chunk: ${updateError.message}`)
        }
      }

      console.log(`  ✓ Updated ${toMigrate.length} records`)
    }

    totalMigrated += toMigrate.length
  }

  return totalMigrated
}

async function main() {
  console.log('=== State Code Migration ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (updating database)'}`)

  const pizzaCount = await migrateTable('pizza_places')
  const tacoCount = await migrateTable('taco_places')

  console.log('\n=== Summary ===')
  console.log(`Pizza places: ${pizzaCount} ${DRY_RUN ? 'would be' : ''} migrated`)
  console.log(`Taco places: ${tacoCount} ${DRY_RUN ? 'would be' : ''} migrated`)

  if (DRY_RUN) {
    console.log('\nRun without --dry-run to execute migration.')
  } else {
    console.log('\nMigration complete. Run generate-dashboard-stats.mjs to update stats.')
  }
}

main().catch(console.error)
