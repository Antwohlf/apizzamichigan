#!/usr/bin/env node
/**
 * OSM Extractor Agent
 *
 * Worker agent that queries Overpass API for restaurant details.
 * Communicates with coordinator via IPC messages.
 *
 * Usage:
 *   node osm-extractor.mjs --worker-id osm-1
 */

import { getQueue } from '../queue.mjs'
import pg from 'pg'
import 'dotenv/config'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const BATCH_SIZE = 30  // Elements per Overpass query
const BATCH_DELAY = 2000  // ms between batches

class OsmExtractor {
  constructor(workerId) {
    this.workerId = workerId
    this.queue = getQueue()
    this.pgClient = null
    this.running = false
    this.stats = { completed: 0, failed: 0 }
    this.pendingBatch = []
  }

  async init() {
    this.pgClient = new pg.Client({
      host: 'localhost',
      database: 'pizza_enrichment',
      user: process.env.PGUSER || process.env.USER,
      password: process.env.PGPASSWORD || ''
    })

    await this.pgClient.connect()
    this.queue.registerWorker(this.workerId, 'osm_extract')
  }

  async shutdown() {
    this.running = false
    this.queue.unregisterWorker(this.workerId)
    this.queue.close()
    if (this.pgClient) await this.pgClient.end()
  }

  /**
   * Parse OSM ID string
   */
  parseOsmId(osmIdString) {
    const match = osmIdString?.match(/^osm:(node|way|relation)\/(\d+)$/)
    if (!match) return null
    return { type: match[1], id: parseInt(match[2], 10) }
  }

  /**
   * Build Overpass query for a batch
   */
  buildOverpassQuery(elements) {
    const parts = elements.map(el => {
      if (el.type === 'node') return `node(${el.id});`
      if (el.type === 'way') return `way(${el.id});`
      if (el.type === 'relation') return `relation(${el.id});`
      return ''
    }).filter(Boolean)

    return `
[out:json][timeout:180];
(
  ${parts.join('\n  ')}
);
out center tags;
`
  }

  /**
   * Query Overpass API
   */
  async queryOverpass(elements) {
    if (!elements.length) return []

    const query = this.buildOverpassQuery(elements)

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`
        })

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }

        const text = await response.text()
        if (text.startsWith('<?xml') || text.startsWith('<')) {
          throw new Error('Received HTML/XML error page')
        }

        const data = JSON.parse(text)
        return data.elements || []
      } catch (error) {
        console.error(`Endpoint ${endpoint} failed: ${error.message}`)
      }
    }

    throw new Error('All Overpass endpoints failed')
  }

  /**
   * Extract enrichment data from OSM element
   */
  extractData(element) {
    const tags = element.tags || {}
    const lat = element.lat ?? element.center?.lat
    const lng = element.lon ?? element.center?.lon

    return {
      osmId: `osm:${element.type}/${element.id}`,
      name: tags.name || tags['name:en'],
      lat,
      lng,
      website: tags.website || tags['contact:website'] || tags.url,
      phone: tags.phone || tags['contact:phone'],
      address: this.buildAddress(tags),
      hours: tags.opening_hours ? { raw: tags.opening_hours } : null,
      cuisine: tags.cuisine
    }
  }

  /**
   * Build address from OSM tags
   */
  buildAddress(tags) {
    const parts = []
    if (tags['addr:housenumber'] && tags['addr:street']) {
      parts.push(`${tags['addr:housenumber']} ${tags['addr:street']}`)
    } else if (tags['addr:street']) {
      parts.push(tags['addr:street'])
    }
    if (tags['addr:city']) parts.push(tags['addr:city'])
    if (tags['addr:state']) parts.push(tags['addr:state'])
    if (tags['addr:postcode']) parts.push(tags['addr:postcode'])
    return parts.length > 0 ? parts.join(', ') : null
  }

  /**
   * Update local database
   */
  async updateDb(placeType, data) {
    const table = placeType === 'pizza' ? 'pizza_places' : 'taco_places'

    const result = await this.pgClient.query(`
      UPDATE ${table}
      SET
        website_url = COALESCE($2, website_url),
        phone = COALESCE($3, phone),
        address = COALESCE($4, address),
        address_source = CASE WHEN $4 IS NOT NULL THEN 'osm' ELSE address_source END,
        hours = COALESCE($5, hours),
        last_enriched_at = NOW()
      WHERE google_place_id = $1
      RETURNING id
    `, [
      data.osmId,
      data.website,
      data.phone,
      data.address,
      data.hours ? JSON.stringify(data.hours) : null
    ])

    return result.rowCount > 0
  }

  /**
   * Process a batch of jobs
   */
  async processBatch(jobs) {
    // Parse OSM IDs
    const elements = jobs.map(job => ({
      ...this.parseOsmId(job.osmId),
      fullId: job.osmId,
      job
    })).filter(el => el.type)

    if (!elements.length) return

    try {
      // Query Overpass
      const osmElements = await this.queryOverpass(elements)

      // Create lookup
      const elementMap = new Map()
      for (const el of osmElements) {
        elementMap.set(`osm:${el.type}/${el.id}`, el)
      }

      // Process each job
      for (const el of elements) {
        const osmEl = elementMap.get(el.fullId)

        if (!osmEl) {
          this.queue.fail(el.job.id, 'Not found in Overpass')
          this.stats.failed++
          this.sendStats()
          continue
        }

        try {
          const data = this.extractData(osmEl)
          const updated = await this.updateDb(el.job.placeType, data)

          if (updated) {
            this.queue.complete(el.job.id, data)
            this.stats.completed++
          } else {
            this.queue.fail(el.job.id, 'No matching record in local DB')
            this.stats.failed++
          }
        } catch (error) {
          this.queue.fail(el.job.id, error.message)
          this.stats.failed++
        }

        this.sendStats()
      }
    } catch (error) {
      // Fail all jobs in batch
      for (const el of elements) {
        this.queue.fail(el.job.id, error.message)
        this.stats.failed++
      }
      this.sendStats()
    }
  }

  /**
   * Send stats to coordinator
   */
  sendStats() {
    if (process.send) {
      process.send({
        type: 'stats',
        stats: {
          status: 'running',
          completed: this.stats.completed,
          failed: this.stats.failed
        }
      })
    }
  }

  /**
   * Send heartbeat
   */
  sendHeartbeat() {
    this.queue.heartbeat(this.workerId)
    if (process.send) {
      process.send({ type: 'heartbeat' })
    }
  }

  /**
   * Main run loop
   */
  async run() {
    await this.init()
    this.running = true

    console.log(`[${this.workerId}] OSM Extractor started`)

    if (process.send) {
      process.send({ type: 'ready' })
    }

    // Heartbeat interval
    const heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 30000)

    // Process messages from coordinator
    process.on('message', async (msg) => {
      if (msg.type === 'shutdown') {
        this.running = false
      }
    })

    // Main processing loop
    while (this.running) {
      // Claim jobs for a batch
      const batch = []
      while (batch.length < BATCH_SIZE) {
        const job = this.queue.claim('osm_extract', this.workerId)
        if (!job) break
        batch.push(job)
      }

      if (batch.length > 0) {
        console.log(`[${this.workerId}] Processing batch of ${batch.length} jobs`)
        await this.processBatch(batch)
        await new Promise(r => setTimeout(r, BATCH_DELAY))
      } else {
        // No jobs available, wait
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    clearInterval(heartbeatInterval)
    await this.shutdown()
    console.log(`[${this.workerId}] OSM Extractor stopped`)
  }
}

// Parse args and run
const args = process.argv.slice(2)
const workerIdIdx = args.indexOf('--worker-id')
const workerId = workerIdIdx >= 0 ? args[workerIdIdx + 1] : `osm-${Date.now()}`

const extractor = new OsmExtractor(workerId)
extractor.run().catch(console.error)
