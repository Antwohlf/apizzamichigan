/**
 * Rate limiter with exponential backoff for web scraping
 */

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export class RateLimiter {
  constructor(options = {}) {
    this.minDelay = options.minDelay || 2000 // 2 seconds minimum
    this.maxDelay = options.maxDelay || 60000 // 60 seconds maximum
    this.currentDelay = this.minDelay
    this.backoffFactor = options.backoffFactor || 2
    this.lastRequest = 0
    this.consecutiveErrors = 0
  }

  async throttle() {
    const now = Date.now()
    const elapsed = now - this.lastRequest
    const waitTime = Math.max(0, this.currentDelay - elapsed)

    // Add jitter (10-20% random variation)
    const jitter = waitTime * (0.1 + Math.random() * 0.1)

    if (waitTime + jitter > 0) {
      await sleep(waitTime + jitter)
    }
    this.lastRequest = Date.now()
  }

  reportSuccess() {
    this.consecutiveErrors = 0
    // Slowly reduce delay on success
    this.currentDelay = Math.max(this.minDelay, this.currentDelay * 0.9)
  }

  reportError(statusCode) {
    this.consecutiveErrors++

    if (statusCode === 429 || statusCode === 503) {
      // Rate limited - aggressive backoff
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * this.backoffFactor)
    } else if (this.consecutiveErrors >= 3) {
      // Multiple errors - moderate backoff
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 1.5)
    }
  }

  getStatus() {
    return {
      currentDelay: this.currentDelay,
      consecutiveErrors: this.consecutiveErrors,
    }
  }
}
