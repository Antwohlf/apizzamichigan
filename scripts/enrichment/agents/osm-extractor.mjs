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
const BATCH_SIZE = parseInt(process.env.OSM_BATCH_SIZE || '10', 10)  // Elements per Overpass query
const BATCH_DELAY = parseInt(process.env.OSM_BATCH_DELAY_MS || '10000', 10)  // ms between batches (avoid 429s)

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
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': process.env.OSM_USER_AGENT || 'APizzaMichigan/1.0'
          },
          body: `data=${encodeURIComponent(query)}`
        })

        if (!response.ok) {
          // Back off harder on rate limit.
          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10)
            const backoffMs = Math.max(retryAfter * 1000, BATCH_DELAY)
            console.error(`Endpoint ${endpoint} rate-limited (429). Backing off ${backoffMs}ms`)
            await new Promise(r => setTimeout(r, backoffMs))
            throw new Error(`429 ${response.statusText}`)
          }

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
      menu: tags.menu || tags['contact:menu'],
      phone: tags.phone || tags['contact:phone'],
      email: tags.email || tags['contact:email'],

      instagram: tags['contact:instagram'],
      facebook: tags['contact:facebook'],
      twitter: tags['contact:twitter'],
      whatsapp: tags['contact:whatsapp'],

      delivery: this.parseYesNo(tags.delivery || tags['contact:delivery']),
      takeaway: this.parseYesNo(tags.takeaway || tags['contact:takeaway']),
      driveThrough: this.parseYesNo(tags.drive_through),
      outdoorSeating: this.parseYesNo(tags.outdoor_seating),
      indoorSeating: this.parseYesNo(tags.indoor_seating),
      wheelchair: tags.wheelchair,

      brand: tags.brand,
      brandWikidata: tags['brand:wikidata'],
      operator: tags.operator,
      operatorWikidata: tags['operator:wikidata'],

      address: this.buildAddress(tags),
      hours: tags.opening_hours ? { raw: tags.opening_hours } : null,
      cuisine: tags.cuisine,

      osmTags: this.buildOsmTags(tags)
    }
  }

  /**
   * Parse OSM yes/no-like values into boolean.
   */
  parseYesNo(value) {
    if (value == null) return null
    const v = String(value).trim().toLowerCase()
    if (['yes', 'true', '1'].includes(v)) return true
    if (['no', 'false', '0'].includes(v)) return false
    return null
  }

  /**
   * Store a useful subset of raw OSM tags for future use.
   * (Includes contact:* and payment:* plus a few high-value keys.)
   */
  buildOsmTags(tags) {
    const keep = {}
    for (const [k, v] of Object.entries(tags || {})) {
      if (k.startsWith('contact:') || k.startsWith('payment:')) keep[k] = v
    }

    const also = [
      'website', 'url', 'menu',
      'phone', 'email',
      'opening_hours', 'cuisine',
      'delivery', 'takeaway', 'drive_through',
      'outdoor_seating', 'indoor_seating',
      'wheelchair',
      'brand', 'brand:wikidata', 'operator', 'operator:wikidata',
      'addr:housenumber', 'addr:street', 'addr:city', 'addr:state', 'addr:postcode'
    ]

    for (const k of also) {
      if (tags?.[k] != null) keep[k] = tags[k]
    }

    return keep
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
        menu_url = COALESCE($3, menu_url),
        phone = COALESCE($4, phone),
        email = COALESCE($5, email),
        instagram_url = COALESCE($6, instagram_url),
        facebook_url = COALESCE($7, facebook_url),
        twitter_url = COALESCE($8, twitter_url),
        whatsapp = COALESCE($9, whatsapp),

        delivery = COALESCE($10, delivery),
        takeaway = COALESCE($11, takeaway),
        drive_through = COALESCE($12, drive_through),
        outdoor_seating = COALESCE($13, outdoor_seating),
        indoor_seating = COALESCE($14, indoor_seating),
        wheelchair = COALESCE($15, wheelchair),

        brand = COALESCE($16, brand),
        brand_wikidata = COALESCE($17, brand_wikidata),
        operator = COALESCE($18, operator),
        operator_wikidata = COALESCE($19, operator_wikidata),

        address = COALESCE($20, address),
        address_source = CASE WHEN $20 IS NOT NULL THEN 'osm' ELSE address_source END,
        hours = COALESCE($21, hours),

        osm_tags = COALESCE($22::jsonb, osm_tags),
        osm_last_fetched_at = NOW(),
        osm_fetch_status = 'success',
        osm_fetch_error = NULL,

        last_enriched_at = NOW()
      WHERE google_place_id = $1
      RETURNING id
    `, [
      data.osmId,
      data.website,
      data.menu,
      data.phone,
      data.email,
      data.instagram,
      data.facebook,
      data.twitter,
      data.whatsapp,
      data.delivery,
      data.takeaway,
      data.driveThrough,
      data.outdoorSeating,
      data.indoorSeating,
      data.wheelchair,
      data.brand,
      data.brandWikidata,
      data.operator,
      data.operatorWikidata,
      data.address,
      data.hours ? JSON.stringify(data.hours) : null,
      data.osmTags ? JSON.stringify(data.osmTags) : null
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

            // If we learned a website URL, enqueue a scrape job.
            if (data.website) {
              try {
                this.queue.addJob('scrape', data.osmId, el.job.placeType, el.job.data || null)
              } catch (e) {
                // Non-fatal: scrape enqueue can fail due to contention.
              }
            }
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
    try {
      this.queue.heartbeat(this.workerId)
      if (process.send) {
        process.send({ type: 'heartbeat' })
      }
    } catch (error) {
      console.error(`[${this.workerId}] Heartbeat error:`, error.message)
      // Don't exit on heartbeat errors; they're non-critical
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
      try {
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
