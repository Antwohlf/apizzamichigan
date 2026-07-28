-- Additive TacoBoutMichigan publication contract.
-- Run this in the Supabase SQL editor before enabling the taco sync launchd job.
-- It adds enrichment fields and a guarded low-I/O batch RPC; it does not write
-- or delete any existing taco rows.

ALTER TABLE IF EXISTS public.taco_places
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_agent TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_run_id INTEGER,
  ADD COLUMN IF NOT EXISTS address_source TEXT,
  ADD COLUMN IF NOT EXISTS scrape_method TEXT,
  ADD COLUMN IF NOT EXISTS scrape_notes TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS menu_url TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS hours JSONB,
  ADD COLUMN IF NOT EXISTS delivery BOOLEAN,
  ADD COLUMN IF NOT EXISTS takeaway BOOLEAN,
  ADD COLUMN IF NOT EXISTS drive_through BOOLEAN,
  ADD COLUMN IF NOT EXISTS outdoor_seating BOOLEAN,
  ADD COLUMN IF NOT EXISTS indoor_seating BOOLEAN,
  ADD COLUMN IF NOT EXISTS wheelchair TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS brand_wikidata TEXT,
  ADD COLUMN IF NOT EXISTS operator TEXT,
  ADD COLUMN IF NOT EXISTS operator_wikidata TEXT,
  ADD COLUMN IF NOT EXISTS osm_tags JSONB,
  ADD COLUMN IF NOT EXISTS osm_last_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS osm_fetch_status TEXT,
  ADD COLUMN IF NOT EXISTS osm_fetch_error TEXT,
  ADD COLUMN IF NOT EXISTS style_confidence TEXT,
  ADD COLUMN IF NOT EXISTS price_range TEXT;

CREATE OR REPLACE FUNCTION public.apply_taco_places_sync_batch(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'p_rows cannot contain more than 500 rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS item
    GROUP BY (item->>'id')::bigint HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'p_rows contains duplicate ids';
  END IF;

  WITH incoming AS (
    SELECT item AS patch, parsed.*
    FROM jsonb_array_elements(p_rows) AS source(item)
    CROSS JOIN LATERAL jsonb_to_record(source.item) AS parsed(
      id bigint, created_at timestamptz, updated_at timestamptz,
      enrichment_status text, last_enriched_at timestamptz,
      enrichment_agent text, enrichment_run_id integer, address_source text,
      scrape_method text, scrape_notes text,
      website_url text, menu_url text, phone text, email text,
      instagram_url text, facebook_url text, twitter_url text, whatsapp text,
      hours jsonb, delivery boolean, takeaway boolean, drive_through boolean,
      outdoor_seating boolean, indoor_seating boolean, wheelchair text,
      brand text, brand_wikidata text, operator text, operator_wikidata text,
      osm_tags jsonb, osm_last_fetched_at timestamptz,
      osm_fetch_status text, osm_fetch_error text,
      style text, price text, price_range text, style_confidence text,
      lifecycle_status text, lifecycle_replaced_by_id bigint
    )
  )
  UPDATE public.taco_places AS target
  SET
    updated_at = CASE WHEN incoming.patch ? 'updated_at' THEN incoming.updated_at ELSE target.updated_at END,
    enrichment_status = CASE WHEN incoming.patch ? 'enrichment_status' THEN incoming.enrichment_status ELSE target.enrichment_status END,
    last_enriched_at = CASE WHEN incoming.patch ? 'last_enriched_at' THEN incoming.last_enriched_at ELSE target.last_enriched_at END,
    enrichment_agent = CASE WHEN incoming.patch ? 'enrichment_agent' THEN incoming.enrichment_agent ELSE target.enrichment_agent END,
    enrichment_run_id = CASE WHEN incoming.patch ? 'enrichment_run_id' THEN incoming.enrichment_run_id ELSE target.enrichment_run_id END,
    address_source = CASE WHEN incoming.patch ? 'address_source' THEN incoming.address_source ELSE target.address_source END,
    scrape_method = CASE WHEN incoming.patch ? 'scrape_method' THEN incoming.scrape_method ELSE target.scrape_method END,
    scrape_notes = CASE WHEN incoming.patch ? 'scrape_notes' THEN incoming.scrape_notes ELSE target.scrape_notes END,
    website_url = CASE WHEN incoming.patch ? 'website_url' THEN incoming.website_url ELSE target.website_url END,
    menu_url = CASE WHEN incoming.patch ? 'menu_url' THEN incoming.menu_url ELSE target.menu_url END,
    phone = CASE WHEN incoming.patch ? 'phone' THEN incoming.phone ELSE target.phone END,
    email = CASE WHEN incoming.patch ? 'email' THEN incoming.email ELSE target.email END,
    instagram_url = CASE WHEN incoming.patch ? 'instagram_url' THEN incoming.instagram_url ELSE target.instagram_url END,
    facebook_url = CASE WHEN incoming.patch ? 'facebook_url' THEN incoming.facebook_url ELSE target.facebook_url END,
    twitter_url = CASE WHEN incoming.patch ? 'twitter_url' THEN incoming.twitter_url ELSE target.twitter_url END,
    whatsapp = CASE WHEN incoming.patch ? 'whatsapp' THEN incoming.whatsapp ELSE target.whatsapp END,
    hours = CASE WHEN incoming.patch ? 'hours' THEN incoming.hours ELSE target.hours END,
    delivery = CASE WHEN incoming.patch ? 'delivery' THEN incoming.delivery ELSE target.delivery END,
    takeaway = CASE WHEN incoming.patch ? 'takeaway' THEN incoming.takeaway ELSE target.takeaway END,
    drive_through = CASE WHEN incoming.patch ? 'drive_through' THEN incoming.drive_through ELSE target.drive_through END,
    outdoor_seating = CASE WHEN incoming.patch ? 'outdoor_seating' THEN incoming.outdoor_seating ELSE target.outdoor_seating END,
    indoor_seating = CASE WHEN incoming.patch ? 'indoor_seating' THEN incoming.indoor_seating ELSE target.indoor_seating END,
    wheelchair = CASE WHEN incoming.patch ? 'wheelchair' THEN incoming.wheelchair ELSE target.wheelchair END,
    brand = CASE WHEN incoming.patch ? 'brand' THEN incoming.brand ELSE target.brand END,
    brand_wikidata = CASE WHEN incoming.patch ? 'brand_wikidata' THEN incoming.brand_wikidata ELSE target.brand_wikidata END,
    operator = CASE WHEN incoming.patch ? 'operator' THEN incoming.operator ELSE target.operator END,
    operator_wikidata = CASE WHEN incoming.patch ? 'operator_wikidata' THEN incoming.operator_wikidata ELSE target.operator_wikidata END,
    osm_tags = CASE WHEN incoming.patch ? 'osm_tags' THEN incoming.osm_tags ELSE target.osm_tags END,
    osm_last_fetched_at = CASE WHEN incoming.patch ? 'osm_last_fetched_at' THEN incoming.osm_last_fetched_at ELSE target.osm_last_fetched_at END,
    osm_fetch_status = CASE WHEN incoming.patch ? 'osm_fetch_status' THEN incoming.osm_fetch_status ELSE target.osm_fetch_status END,
    osm_fetch_error = CASE WHEN incoming.patch ? 'osm_fetch_error' THEN incoming.osm_fetch_error ELSE target.osm_fetch_error END,
    style = CASE WHEN incoming.patch ? 'style' THEN incoming.style ELSE target.style END,
    price = CASE WHEN incoming.patch ? 'price' THEN incoming.price ELSE target.price END,
    price_range = CASE WHEN incoming.patch ? 'price_range' THEN incoming.price_range ELSE target.price_range END,
    style_confidence = CASE WHEN incoming.patch ? 'style_confidence' THEN incoming.style_confidence ELSE target.style_confidence END,
    lifecycle_status = CASE WHEN incoming.patch ? 'lifecycle_status' THEN incoming.lifecycle_status ELSE target.lifecycle_status END,
    lifecycle_replaced_by_id = CASE WHEN incoming.patch ? 'lifecycle_replaced_by_id' THEN incoming.lifecycle_replaced_by_id ELSE target.lifecycle_replaced_by_id END
  FROM incoming
  WHERE target.id = incoming.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN jsonb_build_object('updated_count', updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_taco_places_sync_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_taco_places_sync_batch(jsonb) TO service_role;
