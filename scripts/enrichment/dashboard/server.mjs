#!/usr/bin/env node
/**
 * Express server for enrichment dashboard
 * Serves enhanced + classic dashboards with comprehensive metrics
 *
 * Usage:
 *   node server.mjs
 *   # Then open http://localhost:3456 (enhanced)
 *   # Or http://localhost:3456/classic (classic)
 */

import express from 'express'
import { getStatus } from './api.mjs'
import { getEnhancedStatus } from './api-enhanced.mjs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { getQueue } from '../queue.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.DASHBOARD_PORT || 3456

const app = express()
app.use(express.json())

// Serve enhanced dashboard by default
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index-enhanced.html'))
})

// Serve classic dashboard at /classic
app.get('/classic', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'))
})

// Original API endpoint (backward compatibility)
app.get('/api/status', async (req, res) => {
  try {
    const status = await getStatus()
    res.json(status)
  } catch (err) {
    console.error('API error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Enhanced API endpoint
app.get('/api/status/enhanced', async (req, res) => {
  try {
    const status = await getEnhancedStatus()
    res.json(status)
  } catch (err) {
    console.error('Enhanced API error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Control endpoints (pause/resume)
app.post('/api/control/pause/:workerType', (req, res) => {
  try {
    const { workerType } = req.params
    const validTypes = ['osm_extract', 'scrape', 'classify', 'menu_parse']

    if (!validTypes.includes(workerType)) {
      return res.status(400).json({ error: 'Invalid worker type' })
    }

    const queue = getQueue()
    queue.pause(workerType)

    res.json({ success: true, workerType, action: 'paused' })
  } catch (err) {
    console.error('Pause error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/control/resume/:workerType', (req, res) => {
  try {
    const { workerType } = req.params
    const validTypes = ['osm_extract', 'scrape', 'classify', 'menu_parse']

    if (!validTypes.includes(workerType)) {
      return res.status(400).json({ error: 'Invalid worker type' })
    }

    const queue = getQueue()
    queue.resume(workerType)

    res.json({ success: true, workerType, action: 'resumed' })
  } catch (err) {
    console.error('Resume error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/control/status', (req, res) => {
  try {
    const queue = getQueue()
    const status = queue.getPauseStatus()
    res.json(status)
  } catch (err) {
    console.error('Control status error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`🍕 Dashboard running at http://localhost:${PORT}`)
  console.log(`   Enhanced: http://localhost:${PORT}`)
  console.log(`   Classic:  http://localhost:${PORT}/classic`)
  console.log(`   API:      http://localhost:${PORT}/api/status/enhanced`)
})
