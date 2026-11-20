-- Serve one small public summary instead of one full-table count per state.
-- These covering indexes also keep existing state/status count queries cheap.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create index if not exists pizza_places_map_summary_idx
  on public.pizza_places (state, status, lifecycle_status, rating);
create index if not exists taco_places_map_summary_idx
  on public.taco_places (state, status, lifecycle_status, rating);

create or replace function public.public_map_summary(p_entity text default 'pizza')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_entity = 'pizza' then
    return (
      select coalesce(jsonb_agg(to_jsonb(summary)), '[]'::jsonb)
      from (
        select p.state, p.status, p.lifecycle_status, p.rating, count(*) as place_count
        from public.pizza_places p
        group by p.state, p.status, p.lifecycle_status, p.rating
      ) summary
    );
  elsif p_entity = 'taco' then
    return (
      select coalesce(jsonb_agg(to_jsonb(summary)), '[]'::jsonb)
      from (
        select p.state, p.status, p.lifecycle_status, p.rating, count(*) as place_count
        from public.taco_places p
        group by p.state, p.status, p.lifecycle_status, p.rating
      ) summary
    );
  end if;
  raise exception 'Unsupported map entity' using errcode = '22023';
end;
$function$;

-- The invoker keeps the caller's existing column grants and row policies.
-- JSONB avoids PostgREST's row limit silently truncating the grouped counts.
revoke all on function public.public_map_summary(text) from public;
grant execute on function public.public_map_summary(text) to anon, authenticated, service_role;
comment on function public.public_map_summary(text) is
  'Public map totals grouped by existing public fields; respects caller RLS and grants.';

notify pgrst, 'reload schema';
