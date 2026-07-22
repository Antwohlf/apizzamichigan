#!/usr/bin/env node
/**
 * One-off sample LLM classification run (local-only).
 *
 * Selects a small sample of scraped pizza places (default: MI) and asks Ollama
 * to classify into the existing UI taxonomy.
 *
 * Writes results back to local Postgres ONLY.
 *
 * Usage:
 *   node scripts/enrichment/run-llm-classify-sample.mjs
 *   node scripts/enrichment/run-llm-classify-sample.mjs --state MI --limit 20
 */

import pg from 'pg'
import 'dotenv/config'

import { PIZZA_STYLES, normalizePizzaStyle } from '../lib/pizza-style-taxonomy.mjs'

function parseArgs() {
  const args = process.argv.slice(2)
  const state = args.includes('--state') ? args[args.indexOf('--state') + 1] : 'MI'
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 20
  return { state, limit }
}

function safeJsonParse(text) {
  // try raw
  try { return JSON.parse(text) } catch {}
  // try first json object in text
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try { return JSON.parse(m[0]) } catch {}
  }
  return null
}

function normalizeStyle(style) {
  return normalizePizzaStyle(style)
}

function normalizePrice(price) {
  if (!price) return null
  const p = String(price).trim()
  return ['$', '$$', '$$$', '$$$$'].includes(p) ? p : null
}

async function ollamaGenerate(model, prompt) {
  const url = process.env.OLLAMA_URL || 'http://localhost:11434'
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json'
    })
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ollama HTTP ${res.status}: ${t.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.response
}

function buildPrompt(row) {
  const scrapeNotes = row.scrape_notes ? JSON.stringify(row.scrape_notes) : ''
  const osmTags = row.osm_tags ? JSON.stringify(row.osm_tags) : ''

  return `You are classifying a pizza restaurant into a fixed taxonomy.\n\nReturn ONLY valid JSON with this schema:\n{\n  \"style\": string|null,\n  \"price_range\": \"$\"|\"$$\"|\"$$$\"|\"$$$$\"|null,\n  \"style_confidence\": \"confirmed\"|\"inferred\"\n}\n\nRules:\n- style must be exactly one of: ${PIZZA_STYLES.map(s => `\"${s}\"`).join(', ')}\n- If unsure, use null for style and/or price_range (do not guess).\n- Use style_confidence=confirmed only if the source explicitly states the style (e.g. \"Detroit-style\"). Otherwise inferred.\n\nRestaurant:\n- name: ${row.name}\n- state: ${row.state || ''}\n- website_url: ${row.website_url || ''}\n\nOSM tags (subset):\n${osmTags}\n\nScrape notes (extracted hints):\n${scrapeNotes}\n`
}

async function main() {
  const { state, limit } = parseArgs()

  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await client.connect()

  const model = process.env.OLLAMA_MODEL || 'llama3.2:latest'

  const { rows } = await client.query(
    `SELECT id, name, state, google_place_id, website_url, scrape_notes, osm_tags
     FROM pizza_places
     WHERE state = $1
       AND scrape_method IN ('fetch', 'browser')
     ORDER BY id ASC
     LIMIT $2`,
    [state, limit]
  )

  console.log(`Classifying ${rows.length} rows (state=${state}) using model=${model}`)

  let ok = 0
  let skipped = 0

  for (const row of rows) {
    const prompt = buildPrompt(row)

    try {
      const resp = await ollamaGenerate(model, prompt)
      const parsed = safeJsonParse(resp)

      if (!parsed) {
        skipped++
        console.log(`- id=${row.id} parse-fail`)
        continue
      }

      const style = normalizeStyle(parsed.style)
      const priceRange = normalizePrice(parsed.price_range)
      const styleConfidence = parsed.style_confidence === 'confirmed' ? 'confirmed' : 'inferred'

      await client.query(
        `UPDATE pizza_places
         SET style = COALESCE($2, style),
             price_range = COALESCE($3, price_range),
             style_confidence = COALESCE($4, style_confidence),
             last_enriched_at = NOW()
         WHERE id = $1`,
        [row.id, style, priceRange, styleConfidence]
      )

      ok++
      console.log(`- id=${row.id} style=${style ?? 'null'} price_range=${priceRange ?? 'null'} conf=${styleConfidence}`)
    } catch (e) {
      skipped++
      console.log(`- id=${row.id} error=${e.message}`)
    }
  }

  console.log(`Done. updated=${ok} skipped=${skipped}`)
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
