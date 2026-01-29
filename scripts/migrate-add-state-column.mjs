#!/usr/bin/env node
/**
 * Database Migration: Add state column to pizza_places
 *
 * This migration adds a state column (2-letter state code) to support
 * nationwide pizza place data and prevent false duplicate matches at state borders.
 */

import { createClient } from '@supabase/supabase-js'

// Import Supabase config
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0YWh5aXV2cW1hbGZwYmdpaXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4ODcwNDgsImV4cCI6MjA1MzQ2MzA0OH0.OJTKw2TJ8-NEy7fIym0Pe_a8F3cCYPMroNG1fHLGJbA'

const supabase = createClient(supabaseUrl, supabaseKey)

async function runMigration() {
  console.log('Starting database migration: Add state column\n')

  try {
    // Step 1: Check if state column already exists
    console.log('Step 1: Checking if state column exists...')
    const { data: existingData, error: checkError } = await supabase
      .from('pizza_places')
      .select('state')
      .limit(1)

    if (!checkError) {
      console.log('⚠️  State column already exists. Migration may have already been run.')
      console.log('Continuing to verify and backfill Michigan data...\n')
    } else if (checkError.message.includes('column') && checkError.message.includes('does not exist')) {
      console.log('✓ State column does not exist yet. Proceeding with migration.\n')
    } else {
      throw checkError
    }

    // Step 2: Add state column (this will fail gracefully if it already exists)
    console.log('Step 2: Adding state column (VARCHAR(2))...')
    console.log('Note: This requires direct database access. Please run this SQL in Supabase SQL Editor:')
    console.log('----------------------------------------------------------------------')
    console.log('ALTER TABLE pizza_places ADD COLUMN IF NOT EXISTS state VARCHAR(2);')
    console.log('CREATE INDEX IF NOT EXISTS idx_pizza_places_state ON pizza_places(state);')
    console.log('----------------------------------------------------------------------\n')

    // Step 3: Backfill Michigan data
    console.log('Step 3: Backfilling Michigan data (setting state = \'MI\' where NULL)...')
    const { data: updateData, error: updateError } = await supabase
      .from('pizza_places')
      .update({ state: 'MI' })
      .is('state', null)
      .select('id', { count: 'exact', head: true })

    if (updateError) {
      // If this fails, the column might not exist yet
      if (updateError.message.includes('column') && updateError.message.includes('does not exist')) {
        console.log('⚠️  Could not backfill data - state column does not exist yet.')
        console.log('Please run the SQL commands above in the Supabase SQL Editor first.\n')
        return
      }
      throw updateError
    }

    console.log(`✓ Updated ${updateData?.length || 0} records with state = 'MI'\n`)

    // Step 4: Verify migration
    console.log('Step 4: Verifying migration...')
    const { data: verifyData, error: verifyError } = await supabase
      .from('pizza_places')
      .select('state', { count: 'exact', head: false })

    if (verifyError) {
      throw verifyError
    }

    // Count by state
    const stateCounts = verifyData.reduce((acc, row) => {
      const state = row.state || 'NULL'
      acc[state] = (acc[state] || 0) + 1
      return acc
    }, {})

    console.log('State distribution:')
    Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([state, count]) => {
        console.log(`  ${state}: ${count}`)
      })

    console.log('\n✅ Migration completed successfully!')

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message)
    console.error('Details:', error)
    process.exit(1)
  }
}

// Run migration
runMigration()
