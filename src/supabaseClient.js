import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://htahyiuvqmalfpbgiizx.supabase.co'; 
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0YWh5aXV2cW1hbGZwYmdpaXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4ODcwNDgsImV4cCI6MjA1MzQ2MzA0OH0.OJTKw2TJ8-NEy7fIym0Pe_a8F3cCYPMroNG1fHLGJbA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);