-- Additive hardening for the existing food application schema, not a bootstrap.
-- Filename matches the version recorded by the production migration service.
-- Keep trusted service_role / direct pipeline publisher privileges unchanged.
-- Public place columns match config/canonical-contract.json.
begin;

revoke all on table public.pizza_places, public.taco_places,
  public.frozen_pizzas, public.latin_markets, public."review-photos",
  public.pizza_places_backup, public.pizza_suggestions, public.taco_suggestions
  from public, anon, authenticated;

-- Table REVOKE does not remove separate column grants. Remove those too so
-- legacy grants cannot accidentally preserve access to private columns.
do $$
declare target record;
begin
  for target in
    select c.relname, string_agg(quote_ident(a.attname), ', ' order by a.attnum) as columns
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relname in (
      'pizza_places', 'taco_places', 'frozen_pizzas', 'latin_markets',
      'review-photos', 'pizza_places_backup', 'pizza_suggestions', 'taco_suggestions'
    )
    group by c.relname
  loop
    execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',
      target.columns, target.columns, target.columns, target.columns, target.relname);
    execute format('alter table public.%I enable row level security', target.relname);
  end loop;
end $$;

grant select (
  id, name, lat, lng, address, google_place_id, state, status, style, price,
  rating, website_url, menu_url, phone, hours, price_range, brand, operator,
  lifecycle_status, lifecycle_replaced_by_id
) on public.pizza_places, public.taco_places to anon, authenticated;

-- These small editorial tables contain only fields already displayed by the
-- directories. Future columns are NOT automatically granted to public roles.
grant select (id, "Brand", "Type", "Price", "Rating", "Notes")
  on public.frozen_pizzas to anon, authenticated;
grant select (id, created_at, name, address, phone_number, website, type, notes, visited)
  on public.latin_markets to anon, authenticated;
grant select (id, place_id, storage_path, sort_order, created_at, entity_type)
  on public."review-photos" to anon, authenticated;

-- Preserve the existing insert-only Pizza suggestion form. No SELECT, UPDATE,
-- DELETE, identity/timestamp override, or new Taco write policy is introduced.
grant insert (name, location, "order") on public.pizza_suggestions to anon, authenticated;

revoke execute on function public.apply_pizza_places_sync_batch(jsonb),
  public.apply_taco_places_sync_batch(jsonb) from public, anon, authenticated;

-- Explicit opt-in for future application objects. Do not alter managed
-- Supabase schemas or the service_role defaults needed by trusted publishers.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
-- Function creation must explicitly revoke PUBLIC/anon/authenticated EXECUTE
-- in the creating migration. A schema-scoped default cannot undo PostgreSQL's
-- global PUBLIC function grant, so do not imply that it can here.

-- Abort the transaction if a role inheritance or older grant keeps a private
-- field / write path open. This also catches a missing service-role RPC grant.
do $$
declare role_name text; table_name text; column_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach table_name in array array['pizza_places', 'taco_places'] loop
      if has_table_privilege(role_name, 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'Unexpected table-wide privilege on % for %', table_name, role_name;
      end if;
      foreach column_name in array array['email', 'notes', 'scrape_notes', 'enrichment_agent', 'osm_tags'] loop
        if has_column_privilege(role_name, 'public.' || table_name, column_name, 'SELECT') then
          raise exception 'Private column exposed: %.% to %', table_name, column_name, role_name;
        end if;
      end loop;
      if has_function_privilege(role_name, 'public.apply_' || table_name || '_sync_batch(jsonb)', 'EXECUTE') then
        raise exception 'Public sync execution on % for %', table_name, role_name;
      end if;
      if not has_function_privilege('service_role', 'public.apply_' || table_name || '_sync_batch(jsonb)', 'EXECUTE') then
        raise exception 'Trusted publisher lacks sync execution on %', table_name;
      end if;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
