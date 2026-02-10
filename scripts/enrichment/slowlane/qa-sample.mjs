#!/usr/bin/env node
/**
 * Pull a sample of recently classified pizza places for QA review.
 * Output JSON array.
 */

import pg from 'pg'

const LIMIT = parseInt(process.env.QA_SAMPLE_LIMIT || '75', 10)

const client = new pg.Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
  database: process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || ''
})

async function main() {
  await client.connect()
  const res = await client.query(`
    SELECT
      id,
      name,
      state,
      website_url,
      brand,
      style,
      style_confidence,
      price_range,
      scrape_method,
      scrape_notes,
      osm_tags
    FROM pizza_places
    WHERE (style IS NOT NULL OR price_range IS NOT NULL)
    ORDER BY last_enriched_at DESC NULLS LAST
    LIMIT $1
  `, [LIMIT])

  await client.end()

  // Keep payload size down
  const rows = res.rows.map(r => ({
    id: r.id,
    name: r.name,
    state: r.state,
    website_url: r.website_url,
    brand: r.brand,
    style: r.style,
    style_confidence: r.style_confidence,
    price_range: r.price_range,
    scrape_method: r.scrape_method,
    // these can be huge; keep them but agent should treat as optional
    scrape_notes: r.scrape_notes,
    osm_tags: r.osm_tags
  }))

  console.log(JSON.stringify(rows))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
