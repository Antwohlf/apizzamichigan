#!/usr/bin/env node
import pg from 'pg';

const hours = Number(process.argv[2] || 2);
const client = new pg.Client({ host: 'localhost', database: 'pizza_enrichment', user: process.env.PGUSER || process.env.USER });
await client.connect();
const result = await client.query(`
  INSERT INTO place_sources (entity_type, place_id, source, source_id, source_url, license, attribution, data, match_confidence, match_method, retrieved_at, updated_at)
  SELECT 'pizza', id, 'official_website', CONCAT('place:', id), website_url, 'first-party-factual-evidence', 'official restaurant website',
         jsonb_build_object('website', website_url, 'phone', phone, 'menu_url', menu_url, 'email', email, 'hours', hours,
                            'delivery', delivery, 'takeaway', takeaway, 'scrape_method', scrape_method),
         1.0, 'scraped_first_party', COALESCE(last_enriched_at, NOW()), NOW()
  FROM pizza_places
  WHERE scrape_method = 'fetch'
    AND website_url IS NOT NULL
    AND COALESCE(last_enriched_at, updated_at, NOW()) >= NOW() - ($1::text || ' hours')::interval
  ON CONFLICT (entity_type, source, source_id) DO UPDATE SET
    place_id = EXCLUDED.place_id,
    source_url = EXCLUDED.source_url,
    data = EXCLUDED.data,
    retrieved_at = EXCLUDED.retrieved_at,
    updated_at = NOW()
  RETURNING id
`, [String(hours)]);
console.log(`official_website provenance rows upserted: ${result.rowCount}`);
await client.end();
