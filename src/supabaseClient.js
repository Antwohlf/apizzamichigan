import { createClient } from '@supabase/supabase-js'

const resolveEnv = (keys = []) => {
  for (const key of keys) {
    if (typeof key === 'string' && key) {
      const value = process.env[key]
      if (value) return value
    }
  }
  return undefined
}

const importMetaEnv = (name) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && name in import.meta.env) {
      return import.meta.env[name]
    }
  } catch (err) {
    // ignore
  }
  return undefined
}

const fallbackUrl = 'https://htahyiuvqmalfpbgiizx.supabase.co'
const fallbackKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0YWh5aXV2cW1hbGZwYmdpaXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4ODcwNDgsImV4cCI6MjA1MzQ2MzA0OH0.OJTKw2TJ8-NEy7fIym0Pe_a8F3cCYPMroNG1fHLGJbA'

const supabaseUrl =
  importMetaEnv('VITE_SUPABASE_URL') ||
  resolveEnv(['REACT_APP_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL']) ||
  fallbackUrl

const supabaseAnonKey =
  importMetaEnv('VITE_SUPABASE_ANON_KEY') ||
  resolveEnv(['REACT_APP_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']) ||
  fallbackKey

export const SUPABASE_URL = supabaseUrl
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
