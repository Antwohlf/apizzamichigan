import { supabase } from '../supabaseClient'
import { publicPlaceSelectForTable } from './publicPlaceFields'
import { entityConfig } from '../config/entityConfig'

export async function fetchTacoPlaces() {
  const table = entityConfig('taco').table
  return supabase.from(table).select(publicPlaceSelectForTable(table)).order('name', { ascending: true })
}
