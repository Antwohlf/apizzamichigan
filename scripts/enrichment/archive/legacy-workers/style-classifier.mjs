#!/usr/bin/env node
/**
 * Style Classifier Worker
 *
 * Uses Groq API (primary) or Together.ai (fallback) to classify pizza/taco styles.
 * Single LLM call per place to avoid hallucination.
 * Only saves high-confidence classifications.
 *
 * Usage:
 *   node scripts/enrichment/workers/style-classifier.mjs --type pizza --limit 100
 *   node scripts/enrichment/workers/style-classifier.mjs --type taco --dry-run
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATS_FILE = join(__dirname, '../../.enrichment-stats.json')

// Valid styles from the codebase
const PIZZA_STYLES = [
  'Traditional',
  'New York',
  'Chicago',
  'Tavern',
  'Detroit',
  'Neapolitan',
  'Sicilian',
  'Roman',
  'California'
]

const TACO_TYPES = [
  'Al Pastor',
  'Carne Asada',
  'Carnitas',
  'Chorizo',
  'Pollo',
  'Barbacoa',
  'Birria',
  'Lengua',
  'Fish',
  'Shrimp',
  'Ground Beef',
  'Cabeza',
  'Veggie'
]

// Rate limiting (30 req/min for Groq)
const REQUESTS_PER_MINUTE = 30
const REQUEST_DELAY_MS = Math.ceil(60000 / REQUESTS_PER_MINUTE)

/**
 * Build classification prompt for pizza
 */
function buildPizzaPrompt(name, scrapedInfo) {
  const styleList = PIZZA_STYLES.join(', ')

  let context = `Restaurant name: "${name}"`
  if (scrapedInfo) {
    if (scrapedInfo.styleHints?.length) {
      context += `\nStyle hints from website: ${scrapedInfo.styleHints.join(', ')}`
    }
    if (scrapedInfo.description) {
      context += `\nDescription: ${scrapedInfo.description}`
    }
    if (scrapedInfo.avgPrice) {
      context += `\nAverage menu price: $${scrapedInfo.avgPrice.toFixed(2)}`
    }
  }

  return `You are classifying pizza restaurant styles. Based on the information below, determine the pizza style and price range.

${context}

Valid pizza styles (choose exactly one or "unknown"): ${styleList}

Price ranges: $, $$, $$$, $$$$

Respond ONLY with valid JSON in this exact format:
{
  "style": "style name or null",
  "style_confidence": "confirmed or inferred",
  "price_range": "$ or $$ or $$$ or $$$$ or null"
}

Rules:
- Use "confirmed" only if the name or description explicitly mentions the style
- Use "inferred" if you're guessing based on patterns
- Return null for style if you can't determine it (don't guess)
- Return null for price_range if no price info available
- Only use styles from the valid list`
}

/**
 * Build classification prompt for tacos
 */
function buildTacoPrompt(name, scrapedInfo) {
  const typeList = TACO_TYPES.join(', ')

  let context = `Restaurant name: "${name}"`
  if (scrapedInfo) {
    if (scrapedInfo.tacoHints?.length) {
      context += `\nTaco types from website: ${scrapedInfo.tacoHints.join(', ')}`
    }
    if (scrapedInfo.description) {
      context += `\nDescription: ${scrapedInfo.description}`
    }
    if (scrapedInfo.avgPrice) {
      context += `\nAverage menu price: $${scrapedInfo.avgPrice.toFixed(2)}`
    }
  }

  return `You are classifying taco restaurant specialties. Based on the information below, determine the primary taco type and price range.

${context}

Valid taco types (choose exactly one or "unknown"): ${typeList}

Price ranges: $, $$, $$$, $$$$

Respond ONLY with valid JSON in this exact format:
{
  "style": "taco type or null",
  "style_confidence": "confirmed or inferred",
  "price_range": "$ or $$ or $$$ or $$$$ or null"
}

Rules:
- Use "confirmed" only if the name or menu explicitly mentions the taco type
- Use "inferred" if you're guessing based on patterns
- Return null for style if you can't determine it (don't guess)
- Return null for price_range if no price info available
- Only use types from the valid list`
}

/**
 * Call Groq API
 */
async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY not set')

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Groq API error: ${response.status} ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * Call Together.ai API (fallback)
 */
async function callTogether(prompt) {
  const apiKey = process.env.TOGETHER_API_KEY
  if (!apiKey) throw new Error('TOGETHER_API_KEY not set')

  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3-8b-chat-hf',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Together API error: ${response.status} ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * Call LLM with fallback
 */
async function callLLM(prompt) {
  try {
    return await callGroq(prompt)
  } catch (groqError) {
    console.log(`  Groq failed: ${groqError.message}, trying Together...`)
    try {
      return await callTogether(prompt)
    } catch (togetherError) {
      throw new Error(`Both LLMs failed: Groq: ${groqError.message}, Together: ${togetherError.message}`)
    }
  }
}

/**
 * Parse LLM response
 */
function parseLLMResponse(response, placeType) {
  try {
    // Extract JSON from response (may have extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { error: 'No JSON found in response' }
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate style
    const validStyles = placeType === 'pizza' ? PIZZA_STYLES : TACO_TYPES
    if (parsed.style && !validStyles.includes(parsed.style)) {
      // Try case-insensitive match
      const match = validStyles.find(s => s.toLowerCase() === parsed.style?.toLowerCase())
      if (match) {
        parsed.style = match
      } else {
        parsed.style = null  // Invalid style, discard
      }
    }

    // Validate confidence
    if (parsed.style_confidence && !['confirmed', 'inferred'].includes(parsed.style_confidence)) {
      parsed.style_confidence = 'inferred'
    }

    // Validate price
    if (parsed.price_range && !['$', '$$', '$$$', '$$$$'].includes(parsed.price_range)) {
      parsed.price_range = null
    }

    return parsed
  } catch (error) {
    return { error: `Failed to parse: ${error.message}` }
  }
}

/**
 * Get places to classify
 */
async function getPlacesToClassify(client, placeType, limit) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  const result = await client.query(`
    SELECT google_place_id, name, scrape_notes
    FROM ${table}
    WHERE scrape_method = 'fetch'
      AND (style IS NULL OR style = '')
      AND google_place_id LIKE 'osm:%'
    ORDER BY random()
    LIMIT $1
  `, [limit])

  return result.rows
}

/**
 * Update local PostgreSQL with classification
 */
async function updateLocalDb(client, placeType, osmId, classification) {
  const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

  // Only update if we have high-confidence results
  if (!classification.style && !classification.price_range) {
    return false
  }

  await client.query(`
    UPDATE ${table}
    SET
      style = COALESCE($2, style),
      style_confidence = COALESCE($3, style_confidence),
      price_range = COALESCE($4, price_range),
      enrichment_status = 'enriched',
      last_enriched_at = NOW()
    WHERE google_place_id = $1
  `, [
    osmId,
    classification.style || null,
    classification.style_confidence || null,
    classification.price_range || null
  ])

  return true
}

/**
 * Log enrichment attempt
 */
async function logEnrichment(client, osmId, placeType, phase, status, errorMessage, durationMs) {
  await client.query(`
    INSERT INTO enrichment_log (osm_id, place_type, phase, status, error_message, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [osmId, placeType, phase, status, errorMessage, durationMs])
}

/**
 * Update stats file
 */
function updateStats(processed, success, failed) {
  let stats = {}
  if (existsSync(STATS_FILE)) {
    try {
      stats = JSON.parse(readFileSync(STATS_FILE, 'utf-8'))
    } catch {}
  }

  if (!stats.phases) stats.phases = {}
  if (!stats.phases.classify) stats.phases.classify = { processed: 0, success: 0, failed: 0 }

  stats.phases.classify.processed += processed
  stats.phases.classify.success += success
  stats.phases.classify.failed += failed
  stats.lastUpdated = new Date().toISOString()

  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'pizza'
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 100
  const dryRun = args.includes('--dry-run')

  return { type, limit, dryRun }
}

/**
 * Main function
 */
async function main() {
  const { type, limit, dryRun } = parseArgs()

  console.log(`=== Style Classifier ===`)
  console.log(`Type: ${type}`)
  console.log(`Limit: ${limit}`)
  console.log(`Dry run: ${dryRun}`)
  console.log(`Rate limit: ${REQUESTS_PER_MINUTE} req/min (${REQUEST_DELAY_MS}ms between requests)`)
  console.log()

  // Check API keys
  if (!process.env.GROQ_API_KEY && !process.env.TOGETHER_API_KEY) {
    console.error('Error: Set GROQ_API_KEY or TOGETHER_API_KEY in environment')
    process.exit(1)
  }

  // Connect to local PostgreSQL
  const client = new pg.Client({
    host: 'localhost',
    database: 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()
    console.log('Connected to local PostgreSQL')

    // Get places to classify
    const places = await getPlacesToClassify(client, type, limit)
    console.log(`Found ${places.length} places to classify\n`)

    if (dryRun) {
      console.log('Dry run - would classify:')
      for (const place of places.slice(0, 10)) {
        console.log(`  ${place.name}`)
      }
      if (places.length > 10) {
        console.log(`  ... and ${places.length - 10} more`)
      }
      return
    }

    let totalSuccess = 0
    let totalFailed = 0
    let totalSkipped = 0

    for (let i = 0; i < places.length; i++) {
      const place = places[i]
      const startTime = Date.now()

      console.log(`[${i + 1}/${places.length}] ${place.name}`)

      try {
        // Parse scraped info
        let scrapedInfo = null
        if (place.scrape_notes) {
          try {
            scrapedInfo = JSON.parse(place.scrape_notes)
          } catch {}
        }

        // Build prompt
        const prompt = type === 'pizza'
          ? buildPizzaPrompt(place.name, scrapedInfo)
          : buildTacoPrompt(place.name, scrapedInfo)

        // Call LLM
        const response = await callLLM(prompt)
        const classification = parseLLMResponse(response, type)
        const duration = Date.now() - startTime

        if (classification.error) {
          console.log(`  ✗ Parse error: ${classification.error}`)
          totalFailed++
          await logEnrichment(client, place.google_place_id, type, 'classify', 'failed', classification.error, duration)
        } else if (!classification.style && !classification.price_range) {
          console.log(`  ○ No classification (unknown)`)
          totalSkipped++
          await logEnrichment(client, place.google_place_id, type, 'classify', 'skipped', 'No confident classification', duration)
        } else {
          console.log(`  ✓ Style: ${classification.style || 'unknown'} (${classification.style_confidence || 'n/a'}), Price: ${classification.price_range || 'unknown'}`)
          await updateLocalDb(client, type, place.google_place_id, classification)
          totalSuccess++
          await logEnrichment(client, place.google_place_id, type, 'classify', 'success', null, duration)
        }

        // Rate limit
        if (i < places.length - 1) {
          await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS))
        }
      } catch (error) {
        console.log(`  ✗ Error: ${error.message}`)
        totalFailed++
        await logEnrichment(client, place.google_place_id, type, 'classify', 'failed', error.message, 0)
      }
    }

    // Update stats
    updateStats(places.length, totalSuccess, totalFailed)

    console.log('\n=== Summary ===')
    console.log(`Processed: ${places.length}`)
    console.log(`Classified: ${totalSuccess}`)
    console.log(`Skipped (unknown): ${totalSkipped}`)
    console.log(`Failed: ${totalFailed}`)

  } finally {
    await client.end()
  }
}

main().catch(console.error)
