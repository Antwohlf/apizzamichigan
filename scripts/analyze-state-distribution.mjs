#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function getStateCounts() {
  // Pizza - paginate to get all
  let pizzaStates = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('pizza_places')
      .select('state')
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    pizzaStates = pizzaStates.concat(data)
    if (data.length < 1000) break
    offset += 1000
  }

  // Taco - paginate to get all
  let tacoStates = []
  offset = 0
  while (true) {
    const { data } = await supabase
      .from('taco_places')
      .select('state')
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    tacoStates = tacoStates.concat(data)
    if (data.length < 1000) break
    offset += 1000
  }

  const pizzaCounts = {}
  const tacoCounts = {}

  pizzaStates.forEach(p => {
    const s = p.state || 'Unknown'
    pizzaCounts[s] = (pizzaCounts[s] || 0) + 1
  })

  tacoStates.forEach(p => {
    const s = p.state || 'Unknown'
    tacoCounts[s] = (tacoCounts[s] || 0) + 1
  })

  console.log('=== PIZZA BY STATE (top 15) ===')
  Object.entries(pizzaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([state, count]) => console.log(`  ${state}: ${count}`))

  console.log('\n=== TACO BY STATE (top 15) ===')
  Object.entries(tacoCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([state, count]) => console.log(`  ${state}: ${count}`))

  const miPizza = pizzaCounts['MI'] || 0
  const miTaco = tacoCounts['MI'] || 0
  const nonMiPizza = Object.entries(pizzaCounts).filter(([s]) => s !== 'MI').reduce((acc, [, c]) => acc + c, 0)
  const nonMiTaco = Object.entries(tacoCounts).filter(([s]) => s !== 'MI').reduce((acc, [, c]) => acc + c, 0)

  console.log('\n=== SUMMARY ===')
  console.log(`Total pizza states: ${Object.keys(pizzaCounts).length}`)
  console.log(`Total taco states: ${Object.keys(tacoCounts).length}`)
  console.log(`MI Pizza: ${miPizza} (${(miPizza / pizzaStates.length * 100).toFixed(1)}%)`)
  console.log(`MI Taco: ${miTaco} (${(miTaco / tacoStates.length * 100).toFixed(1)}%)`)
  console.log(`Non-MI Pizza: ${nonMiPizza} (${(nonMiPizza / pizzaStates.length * 100).toFixed(1)}%)`)
  console.log(`Non-MI Taco: ${nonMiTaco} (${(nonMiTaco / tacoStates.length * 100).toFixed(1)}%)`)
}

getStateCounts().catch(console.error)
