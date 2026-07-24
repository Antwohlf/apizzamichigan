-- Additive repair migration for the low-I/O local-to-Supabase sync path.
--
-- Use this when pizza_places already has lifecycle_status and
-- lifecycle_replaced_by_id but the bulk RPC is still missing. It does not
-- create indexes, alter rows, or enable lifecycle sync.

CREATE OR REPLACE FUNCTION public.apply_pizza_places_sync_batch(p_rows jsonb)
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

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS item
    GROUP BY (item->>'id')::bigint
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'p_rows contains duplicate ids';
  END IF;

  WITH incoming AS (
    SELECT item AS patch, parsed.*
    FROM jsonb_array_elements(p_rows) AS source(item)
    CROSS JOIN LATERAL jsonb_to_record(source.item) AS parsed(
      id bigint,
      created_at timestamptz,
      updated_at timestamptz,
      enrichment_status text,
      last_enriched_at timestamptz,
      enrichment_agent text,
      enrichment_run_id integer,
      address_source text,
      scrape_method text,
      scrape_notes text,
      website_url text,
      menu_url text,
      phone text,
      email text,
      instagram_url text,
      facebook_url text,
      twitter_url text,
      whatsapp text,
      hours jsonb,
      delivery boolean,
      takeaway boolean,
      drive_through boolean,
      outdoor_seating boolean,
      indoor_seating boolean,
      wheelchair text,
      brand text,
      brand_wikidata text,
      operator text,
      operator_wikidata text,
      osm_tags jsonb,
      osm_last_fetched_at timestamptz,
      osm_fetch_status text,
      osm_fetch_error text,
      menu_data jsonb,
      menu_parse_confidence text,
      menu_parse_notes text,
      menu_last_parsed_at timestamptz,
      style text,
      price text,
      price_range text,
      style_confidence text,
      qa_status text,
      qa_schema_version integer,
      lifecycle_status text,
      lifecycle_replaced_by_id bigint
    )
  )
  UPDATE public.pizza_places AS target
  SET
    created_at = CASE WHEN incoming.patch ? 'created_at' THEN incoming.created_at ELSE target.created_at END,
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
    menu_data = CASE WHEN incoming.patch ? 'menu_data' THEN incoming.menu_data ELSE target.menu_data END,
    menu_parse_confidence = CASE WHEN incoming.patch ? 'menu_parse_confidence' THEN incoming.menu_parse_confidence ELSE target.menu_parse_confidence END,
    menu_parse_notes = CASE WHEN incoming.patch ? 'menu_parse_notes' THEN incoming.menu_parse_notes ELSE target.menu_parse_notes END,
    menu_last_parsed_at = CASE WHEN incoming.patch ? 'menu_last_parsed_at' THEN incoming.menu_last_parsed_at ELSE target.menu_last_parsed_at END,
    style = CASE WHEN target.style IS NULL AND incoming.patch ? 'style' THEN incoming.style ELSE target.style END,
    price = CASE WHEN target.price IS NULL AND incoming.patch ? 'price' THEN incoming.price ELSE target.price END,
    price_range = CASE WHEN target.price_range IS NULL AND incoming.patch ? 'price_range' THEN incoming.price_range ELSE target.price_range END,
    style_confidence = CASE WHEN target.style_confidence IS NULL AND incoming.patch ? 'style_confidence' THEN incoming.style_confidence ELSE target.style_confidence END,
    qa_status = CASE WHEN incoming.patch ? 'qa_status' THEN incoming.qa_status ELSE target.qa_status END,
    qa_schema_version = CASE WHEN incoming.patch ? 'qa_schema_version' THEN incoming.qa_schema_version ELSE target.qa_schema_version END,
    lifecycle_status = CASE WHEN incoming.patch ? 'lifecycle_status' THEN incoming.lifecycle_status ELSE target.lifecycle_status END,
    lifecycle_replaced_by_id = CASE WHEN incoming.patch ? 'lifecycle_replaced_by_id' THEN incoming.lifecycle_replaced_by_id ELSE target.lifecycle_replaced_by_id END
  FROM incoming
  WHERE target.id = incoming.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN jsonb_build_object('updated_count', updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pizza_places_sync_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_pizza_places_sync_batch(jsonb) TO service_role;
