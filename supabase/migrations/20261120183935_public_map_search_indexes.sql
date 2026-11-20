-- Complete the ILIKE index coverage used by the existing public search API.
-- One unindexed OR operand otherwise forces a scan of the entire place table.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create index if not exists pizza_places_search_metadata_trgm_idx
  on public.pizza_places using gin (
    website_url public.gin_trgm_ops,
    phone public.gin_trgm_ops,
    state public.gin_trgm_ops,
    status public.gin_trgm_ops,
    price_range public.gin_trgm_ops
  );
create index if not exists taco_places_search_metadata_trgm_idx
  on public.taco_places using gin (
    state public.gin_trgm_ops,
    status public.gin_trgm_ops,
    price public.gin_trgm_ops
  );

analyze public.pizza_places;
analyze public.taco_places;
