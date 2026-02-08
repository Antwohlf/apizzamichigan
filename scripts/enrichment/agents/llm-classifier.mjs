#!/usr/bin/env node
/**
 * LLM Classifier Agent (local-only)
 *
 * Claims `classify` jobs from the SQLite queue and writes structured fields
 * back into local Postgres.
 *
 * Guardrails:
 * - Deterministic chain overrides first (style-inference.mjs)
 * - Otherwise, call Ollama with strict JSON output
 * - Only write values that match the known taxonomy
 * - Prefer null over guessing
 */

import { getQueue } from '../queue.mjs'
import pg from 'pg'
import 'dotenv/config'
import { inferStyleFromName, inferPriceFromChain, isKnownChain } from '../../lib/style-inference.mjs'

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

const PRICE_RANGES = ['$', '$$', '$$$', '$$$$']

const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {}
  const m = text?.match(/\{[\s\S]*\}/)
  if (m) {
    try { return JSON.parse(m[0]) } catch {}
  }
  return null
}

function normalizeStyle(style) {
  if (!style) return null
  const s = String(style).trim()
  return PIZZA_STYLES.includes(s) ? s : null
}

function normalizePrice(price) {
  if (!price) return null
  const p = String(price).trim()
  return PRICE_RANGES.includes(p) ? p : null
}

async function ollamaGenerate(prompt) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000) // 180s timeout (3 min)

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: 'json'
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`ollama HTTP ${res.status}: ${t.slice(0, 200)}`)
    }

    const data = await res.json()
    return data.response
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      throw new Error('Ollama request timeout (60s)')
    }
    throw err
  }
}

function buildPrompt(row) {
  const osmTags = row.osm_tags ? JSON.stringify(row.osm_tags) : ''
  
  // Build a pruned scrape_notes: prioritize JSON-LD, include text_excerpt only if needed
  let scrapeData = {}
  if (row.scrape_notes) {
    const notes = typeof row.scrape_notes === 'string' ? JSON.parse(row.scrape_notes) : row.scrape_notes
    
    // Always include jsonld if present (high signal)
    if (notes.jsonld) scrapeData.jsonld = notes.jsonld
    
    // Include other hints (small)
    if (notes.style_hints) scrapeData.style_hints = notes.style_hints
    if (notes.price_hint) scrapeData.price_hint = notes.price_hint
    if (notes.menu_url) scrapeData.menu_url = notes.menu_url
    
    // Only include text_excerpt if we have little other signal (keep prompt small)
    const hasSignal = notes.jsonld?.length || notes.style_hints?.length
    if (!hasSignal && notes.text_excerpt) {
      scrapeData.text_excerpt = notes.text_excerpt.slice(0, 4000) // further cap
    }
  }
  
  const scrapeNotes = Object.keys(scrapeData).length ? JSON.stringify(scrapeData) : ''

  return `You are classifying a pizza restaurant into a fixed taxonomy.\n\nReturn ONLY valid JSON with this schema:\n{\n  \"style\": string|null,\n  \"price_range\": \"$\"|\"$$\"|\"$$$\"|\"$$$$\"|null,\n  \"style_confidence\": \"confirmed\"|\"inferred\"\n}\n\nRules:\n- style must be exactly one of: ${PIZZA_STYLES.map(s => `\"${s}\"`).join(', ')}\n- If unsure, use null for style and/or price_range (do not guess).\n- Use style_confidence=confirmed only if the source explicitly states the style (e.g. \"Detroit-style\"). Otherwise inferred.\n- Prefer high-signal evidence first: JSON-LD structured data, then style_hints, then text excerpts.\n\nRestaurant:\n- name: ${row.name}\n- state: ${row.state || ''}\n- website_url: ${row.website_url || ''}\n\nOSM tags (subset):\n${osmTags}\n\nScrape hints (prioritized):\n${scrapeNotes}\n`
}

class LlmClassifier {
  constructor(workerId) {
    this.workerId = workerId
    this.queue = getQueue()
    this.pgClient = null
    this.running = false
    this.stats = { completed: 0, failed: 0, overridden: 0 }
  }

  async init() {
    this.pgClient = new pg.Client({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      database: process.env.PGDATABASE || 'pizza_enrichment',
      user: process.env.PGUSER || process.env.USER,
      password: process.env.PGPASSWORD || ''
    })

    await this.pgClient.connect()
    this.queue.registerWorker(this.workerId, 'classify')
  }

  async shutdown() {
    this.running = false
    this.queue.unregisterWorker(this.workerId)
    this.queue.close()
    if (this.pgClient) await this.pgClient.end()
  }

  sendStats(status = 'running') {
    if (!process.send) return
    process.send({
      type: 'stats',
      stats: {
        status,
        completed: this.stats.completed,
        failed: this.stats.failed
      }
    })
  }

  async updatePizzaRow(id, patch) {
    const cols = []
    const vals = [id]
    let i = 2
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = $${i}`)
      vals.push(v)
      i++
    }

    if (!cols.length) return

    await this.pgClient.query(
      `UPDATE pizza_places SET ${cols.join(', ')}, last_enriched_at = NOW() WHERE id = $1`,
      vals
    )
  }

  async processJob(job) {
    // pizza-only for now
    const { rows } = await this.pgClient.query(
      `SELECT id, name, state, website_url, osm_tags, scrape_notes, scrape_method
       FROM pizza_places
       WHERE google_place_id = $1
       LIMIT 1`,
      [job.osmId]
    )

    const row = rows[0]
    if (!row) {
      this.queue.fail(job.id, 'No matching local row')
      this.stats.failed++
      return
    }

    // Chain override layer
    const chainStyle = inferStyleFromName(row.name, '')
    const chainPrice = inferPriceFromChain(row.name)
    const hasBrandSignal = Boolean(row.osm_tags?.['brand:wikidata'] || row.osm_tags?.['operator:wikidata'])

    if (isKnownChain(row.name) || hasBrandSignal) {
      const style = chainStyle?.style || null
      const priceRange = chainPrice?.price || null

      await this.updatePizzaRow(row.id, {
        style,
        price_range: priceRange,
        style_confidence: style ? 'confirmed' : null
      })

      this.queue.complete(job.id, { overridden: true, style, price_range: priceRange })
      this.stats.completed++
      this.stats.overridden++
      return
    }

    // Require scraped signal for LLM (avoid guessing from name only)
    if (row.scrape_method !== 'fetch' && !row.osm_tags) {
      this.queue.complete(job.id, { skipped: 'no_signal' })
      this.stats.completed++
      return
    }

    const prompt = buildPrompt(row)

    const resp = await ollamaGenerate(prompt)
    const parsed = safeJsonParse(resp)

    if (!parsed) {
      this.queue.fail(job.id, 'LLM output parse failed')
      this.stats.failed++
      return
    }

    let style = normalizeStyle(parsed.style)
    const priceRange = normalizePrice(parsed.price_range)
    let styleConfidence = parsed.style_confidence === 'confirmed' ? 'confirmed' : 'inferred'

    // Extra guardrail: if the LLM says a specific style but only "inferred",
    // require that we actually see evidence in the scraped/OSM text.
    if (style && styleConfidence === 'inferred') {
      const haystack = `${JSON.stringify(row.osm_tags || {})} ${JSON.stringify(row.scrape_notes || {})}`.toLowerCase()
      const evidence = {
        Detroit: ['detroit'],
        Chicago: ['chicago', 'deep dish', 'deep-dish', 'stuffed'],
        'New York': ['new york', 'ny style', 'ny-style', 'brooklyn'],
        Neapolitan: ['neapolitan', 'wood fired', 'wood-fired', 'brick oven', 'coal fired', 'napoletana'],
        Sicilian: ['sicilian', 'grandma'],
        Roman: ['roman', 'al taglio', 'taglio'],
        Tavern: ['tavern', 'party cut'],
        California: ['california'],
      }[style] || []

      const hasEvidence = evidence.length ? evidence.some(k => haystack.includes(k)) : false
      if (!hasEvidence) {
        style = null
        styleConfidence = null
      }
    }

    // Conservative write: nulls allowed; never write unknown values
    await this.updatePizzaRow(row.id, {
      style,
      price_range: priceRange,
      style_confidence: style ? styleConfidence : null
    })

    this.queue.complete(job.id, { style, price_range: priceRange, style_confidence: styleConfidence })
    this.stats.completed++
  }

  async run() {
    await this.init()
    this.running = true

    console.log(`[${this.workerId}] LLM Classifier started (model=${MODEL})`)
    if (process.send) process.send({ type: 'ready' })

    const heartbeatInterval = setInterval(() => {
      this.queue.heartbeat(this.workerId)
      if (process.send) process.send({ type: 'heartbeat' })
    }, 30000)

    process.on('message', (msg) => {
      if (msg.type === 'shutdown') this.running = false
    })

    while (this.running) {
      const job = this.queue.claim('classify', this.workerId)

      if (!job) {
        await new Promise(r => setTimeout(r, 5000))
        continue
      }

      try {
        await this.processJob(job)
      } catch (e) {
        this.queue.fail(job.id, e.message)
        this.stats.failed++
      }

      this.sendStats('running')
      // rate limit LLM calls
      await new Promise(r => setTimeout(r, 750))
    }

    clearInterval(heartbeatInterval)
    await this.shutdown()
    console.log(`[${this.workerId}] LLM Classifier stopped`)
  }
}

const args = process.argv.slice(2)
const workerIdIdx = args.indexOf('--worker-id')
const workerId = workerIdIdx >= 0 ? args[workerIdIdx + 1] : `classify-${Date.now()}`

const worker = new LlmClassifier(workerId)
worker.run().catch(console.error)
