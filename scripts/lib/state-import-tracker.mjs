/**
 * State Import Tracker
 *
 * Tracks progress of importing pizza places from all 50 US states.
 * Extends the base ProgressTracker with state-specific functionality.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'

export class StateImportTracker {
  constructor(filePath = 'scripts/.state-import-progress.json') {
    this.filePath = filePath
    this.data = {
      version: 1,
      lastUpdated: null,
      startedAt: null,
      states: {
        completed: [],
        failed: [],
        pending: []
      },
      recordCounts: {},
      retries: {},
      errors: {}
    }
  }

  async load() {
    if (existsSync(this.filePath)) {
      try {
        const content = readFileSync(this.filePath, 'utf-8')
        this.data = JSON.parse(content)
        console.log(`Loaded progress: ${this.data.states.completed.length} states completed`)
        if (this.data.states.failed.length > 0) {
          console.log(`  ${this.data.states.failed.length} states previously failed (will retry)`)
        }
      } catch (err) {
        console.warn(`Could not load progress file: ${err.message}`)
      }
    } else {
      this.data.startedAt = new Date().toISOString()
    }
  }

  async save() {
    this.data.lastUpdated = new Date().toISOString()
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }

  isComplete(stateCode) {
    return this.data.states.completed.includes(stateCode)
  }

  isPermanentlyFailed(stateCode) {
    return (this.data.retries[stateCode] || 0) >= 3
  }

  getRetryCount(stateCode) {
    return this.data.retries[stateCode] || 0
  }

  markStateComplete(stateCode, recordCount) {
    // Remove from failed if it was there
    this.data.states.failed = this.data.states.failed.filter(s => s !== stateCode)

    // Add to completed if not already there
    if (!this.data.states.completed.includes(stateCode)) {
      this.data.states.completed.push(stateCode)
    }

    // Store record count
    this.data.recordCounts[stateCode] = recordCount

    // Clear error for this state
    delete this.data.errors[stateCode]
  }

  markStateFailed(stateCode, error) {
    // Increment retry count
    this.data.retries[stateCode] = (this.data.retries[stateCode] || 0) + 1

    // Store error message
    this.data.errors[stateCode] = {
      message: error.message || String(error),
      attempts: this.data.retries[stateCode],
      lastAttempt: new Date().toISOString()
    }

    // Add to failed list if not already there
    if (!this.data.states.failed.includes(stateCode)) {
      this.data.states.failed.push(stateCode)
    }
  }

  markStatePending(stateCode) {
    if (!this.data.states.pending.includes(stateCode)) {
      this.data.states.pending.push(stateCode)
    }
  }

  getStatesToProcess(allStates, skipMichigan = true) {
    return allStates.filter(state => {
      // Skip Michigan if requested (already imported)
      if (skipMichigan && state.code === 'MI') return false

      // Skip completed states
      if (this.isComplete(state.code)) return false

      // Skip permanently failed states (3+ attempts)
      if (this.isPermanentlyFailed(state.code)) return false

      return true
    })
  }

  getTotalRecordCount() {
    return Object.values(this.data.recordCounts).reduce((sum, count) => sum + count, 0)
  }

  generateReport() {
    const { completed, failed } = this.data.states
    const totalRecords = this.getTotalRecordCount()
    const permanentlyFailed = failed.filter(s => this.isPermanentlyFailed(s))
    const willRetry = failed.filter(s => !this.isPermanentlyFailed(s))

    console.log('\n' + '='.repeat(60))
    console.log('STATE IMPORT SUMMARY')
    console.log('='.repeat(60))
    console.log(`Started: ${this.data.startedAt}`)
    console.log(`Last updated: ${this.data.lastUpdated}`)
    console.log('')
    console.log(`States completed: ${completed.length}`)
    console.log(`States failed (will retry): ${willRetry.length}`)
    console.log(`States permanently failed: ${permanentlyFailed.length}`)
    console.log(`Total pizza places imported: ${totalRecords.toLocaleString()}`)
    console.log('')

    // Top 10 states by record count
    const sortedStates = Object.entries(this.data.recordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    if (sortedStates.length > 0) {
      console.log('Top 10 states by pizza places:')
      sortedStates.forEach(([code, count], i) => {
        console.log(`  ${i + 1}. ${code}: ${count.toLocaleString()}`)
      })
      console.log('')
    }

    // Failed states details
    if (failed.length > 0) {
      console.log('Failed states:')
      for (const stateCode of failed) {
        const error = this.data.errors[stateCode]
        const status = this.isPermanentlyFailed(stateCode) ? '(PERMANENT)' : `(attempt ${error?.attempts || 1}/3)`
        console.log(`  ${stateCode}: ${error?.message || 'Unknown error'} ${status}`)
      }
      console.log('')
    }

    console.log('='.repeat(60))
  }

  getCompletedStates() {
    return this.data.states.completed
  }

  getFailedStates() {
    return this.data.states.failed
  }

  getStats() {
    return {
      completed: this.data.states.completed.length,
      failed: this.data.states.failed.length,
      totalRecords: this.getTotalRecordCount(),
      recordsByState: { ...this.data.recordCounts }
    }
  }
}
