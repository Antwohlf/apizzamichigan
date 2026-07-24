-- Read-only post-migration verification for the guarded Supabase bulk RPC.
-- Run this in the Supabase SQL Editor after applying either production
-- migration. It does not update place rows.

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_pizza_places_sync_batch'
  AND pg_get_function_identity_arguments(p.oid) = 'p_rows jsonb';

SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pizza_places'
  AND column_name IN ('lifecycle_status', 'lifecycle_replaced_by_id');

-- The empty array must return {"updated_count": 0} and write no place rows.
SELECT public.apply_pizza_places_sync_batch('[]'::jsonb) AS zero_row_probe;
