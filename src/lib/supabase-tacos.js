import { supabase } from '../supabaseClient'

export async function fetchTacoPlaces() {
  return supabase.from('taco_places').select('*').order('name', { ascending: true })
}
