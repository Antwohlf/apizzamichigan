/**
 * Progress tracker with checkpoint/resume support
 */

import { writeFileSync } from 'node:fs'
import { privatePipelineStatePath, readPrivateJson } from './private-pipeline-state.mjs'

export class ProgressTracker {
  constructor(filePath = 'scripts/.pizza-metadata-progress.json') {
    this.fileName = filePath.split(/[\\/]/).pop()
    this.filePath = privatePipelineStatePath(this.fileName)
    this.loaded = false
    this.data = {
      version: 1,
      lastUpdated: null,
      stats: {
        total: 0,
        processed: 0,
        styleInferred: 0,
        priceInferred: 0,
        needsReview: 0,
      },
      results: {},
    }
  }

  async load() {
    this.loaded = false
    const { value } = readPrivateJson(this.fileName, data => (
      data && data.version === 1 && data.stats && typeof data.stats === 'object' &&
      data.results && typeof data.results === 'object' && !Array.isArray(data.results)
    ))
    this.data = value
    this.loaded = true
    console.log(`Loaded progress: ${this.data.stats.processed} places already processed`)
  }

  async save() {
    if (!this.loaded) throw new Error(`Refusing to save ${this.fileName} before a valid private checkpoint has loaded`)
    this.data.lastUpdated = new Date().toISOString()
    this.updateStats()
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }

  updateStats() {
    const results = Object.values(this.data.results)
    this.data.stats.processed = results.length
    this.data.stats.styleInferred = results.filter(r => r.style).length
    this.data.stats.priceInferred = results.filter(r => r.price).length
    this.data.stats.needsReview = results.filter(r => r.needsReview).length
  }

  setTotal(count) {
    this.data.stats.total = count
  }

  markProcessed(placeId, result) {
    this.data.results[placeId] = {
      ...this.data.results[placeId],
      ...result,
      processedAt: new Date().toISOString(),
    }
  }

  getResult(placeId) {
    return this.data.results[placeId] || null
  }

  getAllResults() {
    return this.data.results
  }

  getUnprocessed(places) {
    return places.filter(p => !this.data.results[p.id])
  }

  getProcessedCount() {
    return Object.keys(this.data.results).length
  }

  getSummary() {
    this.updateStats()
    return this.data.stats
  }

  exportForReview() {
    const results = Object.entries(this.data.results).map(([id, data]) => ({
      id,
      ...data,
    }))

    return {
      highConfidence: results.filter(r => r.styleConfidence === 'high' || r.priceConfidence === 'high'),
      mediumConfidence: results.filter(r =>
        (r.styleConfidence === 'medium' || r.priceConfidence === 'medium') &&
        r.styleConfidence !== 'high' && r.priceConfidence !== 'high'
      ),
      lowConfidence: results.filter(r => r.needsReview),
      unknown: results.filter(r => !r.style && !r.price),
    }
  }
}
