#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAddresses() {
  // Pizza
  const { count: pizzaTotal } = await supabase.from('pizza_places').select('*', { count: 'exact', head: true })
  const { count: pizzaNoAddr } = await supabase.from('pizza_places').select('*', { count: 'exact', head: true }).is('address', null)

  // Taco
  const { count: tacoTotal } = await supabase.from('taco_places').select('*', { count: 'exact', head: true })
  const { count: tacoNoAddr } = await supabase.from('taco_places').select('*', { count: 'exact', head: true }).is('address', null)

  // Style/type coverage
  const { count: pizzaNoStyle } = await supabase.from('pizza_places').select('*', { count: 'exact', head: true }).is('style', null)
  const { count: tacoNoStyle } = await supabase.from('taco_places').select('*', { count: 'exact', head: true }).is('style', null)

  console.log('=== DATA COVERAGE REPORT ===\n')

  console.log('PIZZA PLACES:')
  console.log(`  Total: ${pizzaTotal}`)
  console.log(`  With address: ${pizzaTotal - pizzaNoAddr} (${Math.round((1 - pizzaNoAddr/pizzaTotal)*100)}%)`)
  console.log(`  Missing address: ${pizzaNoAddr}`)
  console.log(`  With style: ${pizzaTotal - pizzaNoStyle} (${Math.round((1 - pizzaNoStyle/pizzaTotal)*100)}%)`)
  console.log(`  Missing style: ${pizzaNoStyle}`)

  console.log('\nTACO PLACES:')
  console.log(`  Total: ${tacoTotal}`)
  console.log(`  With address: ${tacoTotal - tacoNoAddr} (${Math.round((1 - tacoNoAddr/tacoTotal)*100)}%)`)
  console.log(`  Missing address: ${tacoNoAddr}`)
  console.log(`  With style: ${tacoTotal - tacoNoStyle} (${Math.round((1 - tacoNoStyle/tacoTotal)*100)}%)`)
  console.log(`  Missing style: ${tacoNoStyle}`)
}

checkAddresses().catch(console.error)
