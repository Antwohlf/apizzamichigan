-- Review photo storage and metadata for APizzaMichigan/TacoBoutMichigan.
-- Run this once in the Supabase SQL editor for the project.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'review-photos',
  'review-photos',
  true,
  8388608,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public."review-photos" (
  id uuid primary key default gen_random_uuid(),
  place_id bigint not null,
  storage_path text not null unique,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  constraint review_photos_storage_path_webp
    check (
      storage_path ~ '^[A-Za-z0-9/_-]+\.webp$'
      and storage_path not like '/%'
      and storage_path not like '%..%'
    ),
  constraint review_photos_sort_order_positive check (sort_order > 0)
);

create index if not exists review_photos_place_order_idx
  on public."review-photos" (place_id, sort_order, created_at);

alter table public."review-photos" enable row level security;

drop policy if exists "Review photos are publicly readable" on public."review-photos";
create policy "Review photos are publicly readable"
  on public."review-photos"
  for select
  using (true);

drop policy if exists "Review photo objects are publicly readable" on storage.objects;
create policy "Review photo objects are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'review-photos');

-- Do not add public insert/update/delete policies here.
-- The admin API writes through SUPABASE_SERVICE_ROLE_KEY after checking the admin cookie.
