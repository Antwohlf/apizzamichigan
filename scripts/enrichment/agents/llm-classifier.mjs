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

const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest'
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
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
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
  const osmTags = row.osm_tags ? JSON.stringify(row.osm_tags) : ''
  const scrapeNotes = row.scrape_notes ? JSON.stringify(row.scrape_notes) : ''

  return `You are classifying a pizza restaurant into a fixed taxonomy.\n\nReturn ONLY valid JSON with this schema:\n{\n  \"style\": string|null,\n  \"price_range\": \"$\"|\"$$\"|\"$$$\"|\"$$$$\"|null,\n  \"style_confidence\": \"confirmed\"|\"inferred\"\n}\n\nRules:\n- style must be exactly one of: ${PIZZA_STYLES.map(s => `\"${s}\"`).join(', ')}\n- If unsure, use null for style and/or price_range (do not guess).\n- Use style_confidence=confirmed only if the source explicitly states the style (e.g. \"Detroit-style\"). Otherwise inferred.\n\nRestaurant:\n- name: ${row.name}\n- state: ${row.state || ''}\n- website_url: ${row.website_url || ''}\n\nOSM tags (subset):\n${osmTags}\n\nScrape notes (extracted hints):\n${scrapeNotes}\n`
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

    const style = normalizeStyle(parsed.style)
    const priceRange = normalizePrice(parsed.price_range)
    const styleConfidence = parsed.style_confidence === 'confirmed' ? 'confirmed' : 'inferred'

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
