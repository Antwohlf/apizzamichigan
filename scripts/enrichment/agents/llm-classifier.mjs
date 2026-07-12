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
const OLLAMA_TIMEOUT_MS = process.env.OLLAMA_TIMEOUT_MS ? parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) : 300000

// Performance tuning: cap per-request threads.
// Ollama supports passing "options" in /api/generate.
// On 4-core machines: 4 threads allows full utilization per request while leaving room for OS/other workers.
const OLLAMA_NUM_THREADS = process.env.OLLAMA_NUM_THREADS ? parseInt(process.env.OLLAMA_NUM_THREADS, 10) : 4

const OLLAMA_HEALTHCHECK_INTERVAL_MS = process.env.OLLAMA_HEALTHCHECK_INTERVAL_MS
  ? parseInt(process.env.OLLAMA_HEALTHCHECK_INTERVAL_MS, 10)
  : 30000

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

async function ollamaGenerate(prompt, { onController } = {}) {
  const controller = new AbortController()
  if (typeof onController === 'function') onController(controller)
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: {
          num_thread: Number.isFinite(OLLAMA_NUM_THREADS) && OLLAMA_NUM_THREADS > 0 ? OLLAMA_NUM_THREADS : 2
        }
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
      const secs = Math.round(OLLAMA_TIMEOUT_MS / 1000)
      throw new Error(`Ollama request timeout (${secs}s)`)
    }
    throw err
  } finally {
    if (typeof onController === 'function') onController(null)
  }
}

async function ollamaIsHealthy() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal })
    if (!res.ok) return { ok: false, error: `ollama HTTP ${res.status}` }
    return { ok: true, error: null }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'ollama healthcheck timeout' }
    return { ok: false, error: err.message || String(err) }
  } finally {
    clearTimeout(timeout)
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
  constructor(workerId, { maxJobs = 0 } = {}) {
    this.workerId = workerId
    this.queue = getQueue()
    this.pgClient = null
    this.running = false
    this.stopping = false
    this.currentJob = null
    this.activeOllamaController = null
    this.maxJobs = maxJobs
    this.stats = { completed: 0, failed: 0, overridden: 0, retried: 0 }

    this.ollamaHealth = {
      ok: false,
      lastCheckedAt: 0,
      lastError: null
    }
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
    this.stopping = true
    if (this.activeOllamaController) {
      this.activeOllamaController.abort()
      this.activeOllamaController = null
    }
    this.queue.unregisterWorker(this.workerId)
    this.queue.close()
    if (this.pgClient) await this.pgClient.end()
  }

  requestShutdown(signal = 'shutdown') {
    if (this.stopping) return
    console.log(`[${this.workerId}] ${signal} received; stopping after current operation`)
    this.running = false
    this.stopping = true
    if (this.activeOllamaController) {
      this.activeOllamaController.abort()
    }
  }

  sendStats(status = 'running') {
    if (!process.send) return
    process.send({
      type: 'stats',
      stats: {
        status,
        completed: this.stats.completed,
        failed: this.stats.failed,
        retried: this.stats.retried
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

    let resp
    try {
      resp = await ollamaGenerate(prompt, {
        onController: controller => {
          this.activeOllamaController = controller
        }
      })
    } catch (err) {
      const msg = err?.message || String(err)
      // Transient infra failure: requeue without burning attempts
      const isTransient =
        msg.includes('fetch failed') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('ollama HTTP 5') ||
        msg.includes('Ollama request timeout') ||
        msg.includes('Classifier shutdown')

      if (isTransient) {
        this.queue.retry(job.id, msg, { refundAttempt: true })
        this.stats.retried++
        return
      }

      throw err
    }

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
      try {
        this.queue.heartbeat(this.workerId)
        if (process.send) process.send({ type: 'heartbeat' })
      } catch (error) {
        console.error(`[${this.workerId}] Heartbeat error:`, error.message)
        // Don't exit on heartbeat errors; they're non-critical
      }
    }, 30000)

    process.on('message', (msg) => {
      if (msg.type === 'shutdown') this.requestShutdown('shutdown message')
    })

    const stop = signal => this.requestShutdown(signal)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    try {
      while (this.running) {
        try {
          // Preflight Ollama so we don't claim jobs (and increment attempts) when it's down.
          const now = Date.now()
          if (now - this.ollamaHealth.lastCheckedAt > OLLAMA_HEALTHCHECK_INTERVAL_MS || !this.ollamaHealth.ok) {
            const health = await ollamaIsHealthy()
            this.ollamaHealth = {
              ok: health.ok,
              lastCheckedAt: now,
              lastError: health.error
            }

            if (!health.ok) {
              console.error(`[${this.workerId}] Ollama unhealthy (${health.error}); backing off before claiming jobs...`)
              await new Promise(r => setTimeout(r, 15000))
              continue
            }
          }

          const job = this.queue.claim('classify', this.workerId)

          if (!job) {
            await new Promise(r => setTimeout(r, 5000))
            continue
          }

          this.currentJob = job
          console.log(`[${this.workerId}] Claimed classify job ${job.id} (${job.osmId})`)

          try {
            await this.processJob(job)
          } catch (e) {
            this.queue.fail(job.id, e.message)
            this.stats.failed++
          } finally {
            this.currentJob = null
          }

          this.sendStats('running')
          if (this.maxJobs > 0 && this.stats.completed + this.stats.failed + this.stats.retried >= this.maxJobs) {
            console.log(`[${this.workerId}] Reached max jobs (${this.maxJobs}); stopping`)
            this.running = false
            break
          }
          // rate limit LLM calls
          await new Promise(r => setTimeout(r, 750))
        } catch (error) {
          // Handle transient SQLite errors (SQLITE_BUSY, SQLITE_LOCKED) gracefully
          if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
            console.error(`[${this.workerId}] Database contention (${error.code}), backing off...`)
            await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000)) // 10-15s backoff
          } else {
            console.error(`[${this.workerId}] Unexpected error in main loop:`, error)
            await new Promise(r => setTimeout(r, 5000))
          }
        }
      }
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)

      if (this.currentJob) {
        try {
          this.queue.retry(this.currentJob.id, 'Classifier stopped before completing job', { refundAttempt: true })
          console.log(`[${this.workerId}] Requeued in-flight job ${this.currentJob.id} during shutdown`)
        } catch (error) {
          console.error(`[${this.workerId}] Failed to requeue in-flight job ${this.currentJob.id}:`, error.message)
        } finally {
          this.currentJob = null
        }
      }

      clearInterval(heartbeatInterval)
      await this.shutdown()
      console.log(`[${this.workerId}] LLM Classifier stopped`)
    }
  }
}

const args = process.argv.slice(2)
const workerIdIdx = args.indexOf('--worker-id')
const workerId = workerIdIdx >= 0 ? args[workerIdIdx + 1] : `classify-${Date.now()}`
const maxJobsIdx = args.indexOf('--max-jobs')
const maxJobs = maxJobsIdx >= 0 ? parseInt(args[maxJobsIdx + 1], 10) : parseInt(process.env.CLASSIFY_MAX_JOBS || '0', 10)

const worker = new LlmClassifier(workerId, {
  maxJobs: Number.isFinite(maxJobs) && maxJobs > 0 ? maxJobs : 0
})
worker.run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
